import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  allowedTools, buildPrompt, findService, guardText, initialState, respondOffline, searchKb, type DialogState, type KbSnapshot,
} from "@all/dialog";
import type { Session } from "../auth";
import { env, llmConfig } from "../env";
import { toE164 } from "../format";
import { createServerSupabase } from "../supabase/server";
import { publishedSnapshot } from "../data/sb/kb";
import { callLlm, LlmError, type Block, type Msg, type ToolDef } from "./llm";
import {
  HANDOFF_LABEL, companyFacts, extractPhone, hoursLine, leadTitle, mvpRules, priceInfo, resolveDate, toLlmHistory, type LeadKind,
} from "./helpers";

/**
 * Один ход диалога с AI-ассистентом из кабинета («Протестировать AI»).
 * - Отвечает по последней ОПУБЛИКОВАННОЙ версии базы знаний.
 * - Диалог и состояние хранятся в conversations/messages (не в памяти процесса).
 * - Лимиты частоты и токенов — атомарно в базе (RPC ai_begin_request).
 * - Внешняя LLM — если задан ключ; иначе локальный движок @all/dialog, и ответ помечается как «локальный движок».
 * - Заявка создаётся только на сервере через RPC create_lead под JWT пользователя.
 */

export class TurnError extends Error {}

export interface TurnReply {
  conversationId: string;
  text: string;
  engine: "llm" | "offline";
  model?: string;
  /** Почему ответил локальный движок: нет ключа или ошибка внешней LLM */
  fallback?: "no_key" | "llm_error";
  tools: string[];
  lead?: { id: string; number: number; title: string };
  limited?: "rate_user" | "rate_company" | "budget";
  state: DialogState;
}

interface LeadRequest { type: LeadKind; priority: "normal" | "urgent"; fields: Record<string, string | undefined> }
interface CreatedLead { id: string; number: number; title: string; contactId?: string }

const LIMIT_TEXT = {
  rate_user: "Слишком много сообщений подряд. Подождите минуту и продолжите.",
  rate_company: "Дневной лимит AI-запросов демо-компании исчерпан. Попробуйте завтра.",
  budget: "Дневной бюджет внешней LLM исчерпан. Попробуйте завтра.",
} as const;

function check<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}
function one<T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  const d = check(r, what);
  if (d === null || d === undefined) throw new Error(`${what}: not found`);
  return d as NonNullable<T>;
}

async function openConversation(sb: SupabaseClient, s: Session, id: string | undefined, greeting: string) {
  if (id) {
    const row = check(await sb.from("conversations").select("id, dialog_state").eq("company_id", s.companyId).eq("id", id).maybeSingle(), "conversation");
    if (!row) throw new TurnError("Диалог не найден. Начните новый тест.");
    return { id: String(row.id), state: { ...initialState(), ...(row.dialog_state as Partial<DialogState>) } as DialogState, fresh: false };
  }
  const ch = check(await sb.from("channels").select("id").eq("company_id", s.companyId).eq("type", "widget").order("created_at").limit(1).maybeSingle(), "channel");
  if (!ch) throw new TurnError("Тестовый канал не настроен. Запустите provisioning демо-компании.");
  const row = one(await sb.from("conversations").insert({
    company_id: s.companyId, channel_id: ch.id, external_id: `test:${randomUUID()}`, state: "ai", dialog_state: initialState(),
    last_message_at: new Date().toISOString(), tags: ["test", "web_demo"],
  }).select("id").single(), "conversation insert");
  if (greeting) await sb.from("messages").insert({ company_id: s.companyId, conversation_id: row.id, direction: "out", author: "ai", body: greeting, status: "sent" });
  return { id: String(row.id), state: initialState(), fresh: true };
}

async function createDialogLead(sb: SupabaseClient, s: Session, conversationId: string, req: LeadRequest, tz: string): Promise<CreatedLead> {
  const phone = req.fields.phone ? toE164(req.fields.phone) : null;
  if (!phone) throw new TurnError("invalid_phone");
  const fields: Record<string, string> = { phone };
  for (const k of ["name", "service", "preferred_time", "comment"] as const) {
    const v = req.fields[k]?.toString().trim();
    if (v) fields[k] = v.slice(0, 300);
  }
  const date = resolveDate(fields.preferred_time, tz);
  if (date) fields.preferred_date = date;
  fields.dialog = "Тест AI в кабинете (веб-демо)";
  const title = leadTitle(req.type, fields);
  const id = check(await sb.rpc("create_lead", {
    p_company_id: s.companyId,
    p_payload: { type: req.type, title, priority: req.priority, source: "chat", source_id: conversationId, channel: "web_demo", actor_kind: "ai", fields },
    p_idempotency_key: `dialog:${conversationId}:${req.type}`,
  }), "create_lead") as string;
  const lead = one(await sb.from("leads").select("id, number, title, contact_id").eq("id", id).single(), "lead");
  await sb.from("conversations").update({ contact_id: lead.contact_id }).eq("id", conversationId);
  return { id: String(lead.id), number: Number(lead.number), title: String(lead.title), contactId: (lead.contact_id as string | null) ?? undefined };
}

function confirmText(req: LeadRequest, lead: CreatedLead): string {
  if (req.type === "callback") return `Передала ваш вопрос администратору — заявка №${lead.number}. Вам перезвонят по номеру ${req.fields.phone}.`;
  const what = [req.fields.service, req.fields.preferred_time].filter(Boolean).join(", ");
  return `Готово, оформила заявку №${lead.number}${what ? `: ${what}` : ""}. Это заявка, а не подтверждённая запись — администратор свяжется с вами и подтвердит время.`;
}

// ───────────── Локальный движок ─────────────
async function offlineTurn(snap: KbSnapshot, message: string, prev: DialogState, channel: "voice" | "chat", makeLead: (r: LeadRequest) => Promise<CreatedLead>) {
  const r = respondOffline(snap, message, prev, { channel, mode: "consult", phase: "1a" });
  const state = r.state;
  // В веб-демо соединения со звонком нет: «соединяю» заменяем на честное «передам»
  let text = r.text.replace(/соединяю с администратором\.?/i, "передам ваш вопрос администратору.");
  let lead: CreatedLead | undefined;
  let req: LeadRequest | undefined;
  const leadCall = r.toolCalls.find((t) => t.name === "create_lead" && t.status === "ok");

  if (r.handoff) {
    if (state.fields.phone) req = { type: "callback", priority: "urgent", fields: { ...state.fields, comment: HANDOFF_LABEL[r.handoff.reason] ?? r.handoff.reason } };
    else { state.handoffReason = r.handoff.reason; text = `${text} Оставьте, пожалуйста, номер телефона — администратор перезвонит.`; }
  } else if (prev.handoffReason && state.fields.phone) {
    req = { type: "callback", priority: "urgent", fields: { ...state.fields, comment: HANDOFF_LABEL[prev.handoffReason] ?? prev.handoffReason } };
  } else if (leadCall && state.leadCreated && !prev.leadCreated) {
    const t = (leadCall.arguments.type as LeadKind | undefined) ?? "booking";
    req = { type: t, priority: "normal", fields: { ...state.fields } };
  }
  if (req) {
    try {
      lead = await makeLead(req);
      text = confirmText(req, lead);
      state.leadCreated = true;
      state.handoffReason = undefined;
    } catch (e) {
      state.leadCreated = false;
      if (e instanceof TurnError && e.message === "invalid_phone") {
        state.fields.phone = undefined;
        text = "Похоже, номер указан с ошибкой. Назовите его полностью, например +996 555 123 456.";
      } else throw e;
    }
  }
  return { text, state, tools: r.toolCalls.map((t) => t.name), lead, usage: { input: 0, output: 0 } };
}

// ───────────── Внешняя LLM ─────────────
async function llmTurn(cfg: NonNullable<ReturnType<typeof llmConfig>>, snap: KbSnapshot, history: Msg[], message: string, prev: DialogState,
  opts: { tz: string; channel: "voice" | "chat"; greeting: string }, makeLead: (r: LeadRequest) => Promise<CreatedLead>) {
  const state: DialogState = structuredClone(prev);
  const phone = extractPhone(message);
  if (phone) state.fields.phone = phone;
  const tools: ToolDef[] = allowedTools("consult", "1a").map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const system = [
    buildPrompt(snap, { channel: opts.channel, mode: "consult", phase: "1a" }),
    "ФАКТЫ О КОМПАНИИ",
    companyFacts(snap),
    mvpRules({ tz: opts.tz, voice: opts.channel === "voice", state }),
    opts.greeting ? `Ты уже поздоровался фразой: «${opts.greeting}». Не здоровайся повторно.` : "",
  ].filter(Boolean).join("\n\n");

  const used: string[] = [];
  let lead: CreatedLead | undefined;
  const usage = { input: 0, output: 0 };

  const exec = async (name: string, input: Record<string, unknown>): Promise<unknown> => {
    used.push(name);
    if (name === "search_kb") {
      const hits = searchKb(snap, String(input.query ?? ""), 4);
      return hits.length ? { results: hits.map((h) => ({ source: h.source, text: h.text })) } : { results: [], note: "В базе знаний нет ответа — скажи, что уточнит администратор, и предложи заявку." };
    }
    if (name === "get_service") {
      const sv = findService(snap, String(input.name ?? "")) ?? snap.services.find((x) => x.name.toLowerCase().includes(String(input.name ?? "").toLowerCase().trim()));
      return sv ? { found: true, name: sv.name, price: priceInfo(sv), duration_min: sv.durationMin ?? null } : { found: false, available: snap.services.map((x) => x.name) };
    }
    if (name === "get_hours") return { branches: snap.branches.map((b) => ({ name: b.name, address: b.address, hours: hoursLine(b.hours) })) };
    if (name === "end_call") return { ok: true };
    if (name === "create_lead" || name === "transfer_to_human") {
      if (state.leadCreated && lead) return { ok: true, already_created: true, lead_number: lead.number };
      const f = (name === "create_lead" ? (input.fields ?? {}) : {}) as Record<string, string | undefined>;
      const fields = { ...state.fields, ...Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === "string" && v.trim())) } as Record<string, string | undefined>;
      if (!fields.phone) return { ok: false, error: "phone_required", note: "Спроси номер телефона клиента." };
      if (name === "create_lead" && !fields.name) return { ok: false, error: "name_required", note: "Спроси, как обращаться к клиенту." };
      const type: LeadKind = name === "transfer_to_human" ? "callback" : (["booking", "consultation", "order", "complaint", "reschedule", "callback", "other"].includes(String(input.type)) ? input.type as LeadKind : "booking");
      const req: LeadRequest = {
        type, priority: name === "transfer_to_human" || input.priority === "urgent" ? "urgent" : "normal",
        fields: name === "transfer_to_human" ? { ...fields, comment: HANDOFF_LABEL[String(input.reason)] ?? String(input.reason ?? "клиент попросил администратора") } : fields,
      };
      try {
        lead = await makeLead(req);
      } catch (e) {
        if (e instanceof TurnError && e.message === "invalid_phone") { state.fields.phone = undefined; return { ok: false, error: "invalid_phone", note: "Номер некорректен, попроси повторить полностью." }; }
        throw e;
      }
      state.leadCreated = true;
      state.fields = { ...state.fields, name: fields.name, phone: fields.phone, service: fields.service, preferred_time: fields.preferred_time };
      return { ok: true, lead_number: lead.number, status: "new", note: name === "transfer_to_human" ? "Соединение в веб-демо недоступно; создана срочная заявка на перезвон." : "Это заявка, а не подтверждённая запись: администратор свяжется и подтвердит время." };
    }
    return { ok: false, error: "unknown_tool" };
  };

  const msgs: Msg[] = [...history, { role: "user", content: message }];
  let text = "";
  for (let i = 0; i < 5; i++) {
    const res = await callLlm(cfg, { system, messages: msgs, tools, maxTokens: env.AI_MAX_OUTPUT_TOKENS });
    usage.input += res.usage.input; usage.output += res.usage.output;
    if (!res.toolUses.length) { text = res.text; break; }
    msgs.push({ role: "assistant", content: res.content });
    const results: Block[] = [];
    for (const tu of res.toolUses) results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(await exec(tu.name, tu.input)) });
    msgs.push({ role: "user", content: results });
  }
  if (!text) text = lead ? confirmText({ type: "booking", priority: "normal", fields: state.fields }, lead) : "Давайте я передам вопрос администратору — оставьте, пожалуйста, номер телефона.";
  // Охрана ответа: цены, которых нет в базе знаний, стоп-темы, «я человек»
  const guarded = guardText(text, snap).text;
  return { text: guarded, state, tools: used, lead, usage };
}

export async function assistantTurn(s: Session, input: { conversationId?: string; message: string; channel: "voice" | "chat"; greeting: string }): Promise<TurnReply> {
  const sb = await createServerSupabase();
  const [snap, company] = await Promise.all([
    publishedSnapshot(sb, s.companyId),
    sb.from("companies").select("timezone").eq("id", s.companyId).single(),
  ]);
  if (!snap) throw new TurnError("База знаний ещё не опубликована. Опубликуйте её в разделе «База знаний».");
  const tz = String(one(company, "company").timezone);
  const conv = await openConversation(sb, s, input.conversationId, input.greeting);
  const cfg = llmConfig();

  const gate = check(await sb.rpc("ai_begin_request", {
    p_company_id: s.companyId, p_conversation_id: conv.id, p_engine: cfg ? "llm" : "offline",
    p_per_user_minute: env.AI_RATE_PER_USER_MINUTE, p_per_company_day: env.AI_RATE_PER_COMPANY_DAY,
    p_company_day_tokens: env.AI_DAILY_TOKEN_BUDGET, p_model: cfg?.model ?? null,
  }), "ai_begin_request") as { allowed: boolean; reason?: keyof typeof LIMIT_TEXT; request_id?: string };
  if (!gate.allowed) {
    const reason = gate.reason ?? "rate_user";
    return { conversationId: conv.id, text: LIMIT_TEXT[reason], engine: cfg ? "llm" : "offline", tools: [], limited: reason, state: conv.state };
  }

  const historyRows = conv.fresh ? [] : (check(await sb.from("messages").select("author, body").eq("conversation_id", conv.id).order("created_at").limit(40), "history") ?? []);
  await sb.from("messages").insert({ company_id: s.companyId, conversation_id: conv.id, direction: "in", author: "client", body: input.message, status: "delivered" });

  const makeLead = (r: LeadRequest) => createDialogLead(sb, s, conv.id, r, tz);
  let out: Awaited<ReturnType<typeof offlineTurn>>;
  let engine: TurnReply["engine"] = "offline";
  let fallback: TurnReply["fallback"];
  if (cfg) {
    try {
      out = await llmTurn(cfg, snap, toLlmHistory(historyRows.map((m) => ({ author: String(m.author), body: String(m.body ?? "") }))), input.message, conv.state, { tz, channel: input.channel, greeting: input.greeting }, makeLead);
      engine = "llm";
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      console.error(`[ai] llm_error ${e.message}`);
      fallback = "llm_error";
      out = await offlineTurn(snap, input.message, conv.state, input.channel, makeLead);
    }
  } else {
    fallback = "no_key";
    out = await offlineTurn(snap, input.message, conv.state, input.channel, makeLead);
  }

  await Promise.all([
    sb.from("messages").insert({ company_id: s.companyId, conversation_id: conv.id, direction: "out", author: "ai", body: out.text, status: "sent" }),
    sb.from("conversations").update({ dialog_state: out.state, last_message_at: new Date().toISOString(), needs_human: !!out.state.handoffReason }).eq("id", conv.id),
    gate.request_id && (out.usage.input || out.usage.output) ? sb.rpc("ai_finish_request", { p_request_id: gate.request_id, p_tokens_in: out.usage.input, p_tokens_out: out.usage.output }) : Promise.resolve(),
  ]);

  return {
    conversationId: conv.id, text: out.text, engine, model: engine === "llm" ? cfg?.model : undefined, fallback, tools: out.tools,
    lead: out.lead ? { id: out.lead.id, number: out.lead.number, title: out.lead.title } : undefined, state: out.state,
  };
}
