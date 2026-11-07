import "server-only";
import { BLOCKS, missingRequired, type FieldValues } from "@all/dialog";
import type { AiMode, Lead } from "@all/db";
import type { Session } from "../../auth";
import { createServerSupabase } from "../../supabase/server";
import type { AssistantSettings } from "../types";
import { LEAD_COLS, CONTACT_COLS, toContact, toLead } from "./map";
import { counts, draftId, loadBranches, loadQuestionnaire, snapshotFrom } from "./kb";

/**
 * Мутации кабинета в Supabase. Все — под JWT пользователя: RLS и проверки внутри RPC
 * не дают писать в чужую компанию или выполнять действия не своей роли.
 * Входы уже провалидированы zod в server actions (lib/actions.ts).
 */
export class MutationError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

type PgError = { message: string; code?: string } | null;
function fail(e: PgError, fallback?: string): never {
  if (e?.code === "42501") throw new MutationError("forbidden", "42501");
  if (e?.code === "23505") throw new MutationError(fallback ?? "Такая запись уже есть.", "23505");
  throw new MutationError(e?.message ?? "db_error", e?.code ?? "db");
}

const sbc = () => createServerSupabase();

// ───────────── Заявки ─────────────
export interface LeadPatch { status?: Lead["status"]; assigneeId?: string | null; priority?: Lead["priority"]; tags?: Lead["tags"]; lostReason?: string; payload?: Record<string, string>; title?: string }

export async function updateLead(s: Session, id: string, p: LeadPatch, mergeTags = false): Promise<Lead | null> {
  const sb = await sbc();
  const cur = await sb.from("leads").select("tags, payload, status").eq("company_id", s.companyId).eq("id", id).maybeSingle();
  if (cur.error) fail(cur.error);
  if (!cur.data) return null;
  if (p.assigneeId) {
    const m = await sb.from("memberships").select("id").eq("company_id", s.companyId).eq("user_id", p.assigneeId).is("disabled_at", null).maybeSingle();
    if (!m.data) throw new MutationError("Сотрудник не найден в компании.");
  }
  const row: Record<string, unknown> = {};
  if (p.status) row.status = p.status;
  if (p.status === "lost") row.lost_reason = p.lostReason;
  if (p.assigneeId !== undefined) row.assignee_id = p.assigneeId;
  if (p.priority) row.priority = p.priority;
  if (p.tags) row.tags = mergeTags ? Array.from(new Set([...((cur.data.tags as string[]) ?? []), ...p.tags])) : p.tags;
  if (p.payload) row.payload = { ...((cur.data.payload as object) ?? {}), ...p.payload };
  if (p.title) row.title = p.title;
  const r = await sb.from("leads").update(row).eq("company_id", s.companyId).eq("id", id).select(LEAD_COLS).maybeSingle();
  if (r.error) fail(r.error);
  // RLS: строка не обновилась (сотрудник — чужая заявка)
  if (!r.data) throw new MutationError("forbidden", "42501");
  return toLead(r.data);
}

export async function commentLead(s: Session, id: string, body: string) {
  const sb = await sbc();
  const r = await sb.from("lead_events").insert({ company_id: s.companyId, lead_id: id, actor_id: s.userId, actor_kind: "user", action: "comment", comment: body });
  if (r.error) fail(r.error);
}

export async function createLead(s: Session, v: { type: Lead["type"]; title: string; phone: string; name?: string; priority: Lead["priority"]; comment?: string; sourceCallId?: string }): Promise<Lead> {
  const sb = await sbc();
  const fields: Record<string, string> = { phone: v.phone };
  if (v.name) fields.name = v.name;
  if (v.comment) fields.comment = v.comment;
  const id = await sb.rpc("create_lead", {
    p_company_id: s.companyId,
    p_payload: { type: v.type, title: v.title, priority: v.priority, source: v.sourceCallId ? "call" : "manual", source_id: v.sourceCallId ?? null, channel: "phone", fields },
  });
  if (id.error) fail(id.error);
  const r = await sb.from("leads").update({ assignee_id: s.userId }).eq("id", id.data as string).select(LEAD_COLS).single();
  if (r.error) fail(r.error);
  return toLead(r.data);
}

// ───────────── Звонки ─────────────
export async function updateCall(s: Session, id: string, row: Record<string, unknown>) {
  const sb = await sbc();
  const r = await sb.from("calls").update(row).eq("company_id", s.companyId).eq("id", id).select("id").maybeSingle();
  if (r.error) fail(r.error);
  if (!r.data) throw new MutationError("Звонок не найден.");
}

// ───────────── Контакты ─────────────
export async function createContact(s: Session, phone: string, name?: string) {
  const sb = await sbc();
  const dupe = await sb.from("contacts").select(CONTACT_COLS).eq("company_id", s.companyId).eq("phone", phone).maybeSingle();
  if (dupe.data) return toContact(dupe.data);
  const r = await sb.from("contacts").insert({ company_id: s.companyId, phone, name: name || null, channels: { phone: true } }).select(CONTACT_COLS).single();
  if (r.error) fail(r.error, "Контакт с таким номером уже есть.");
  return toContact(r.data);
}

export async function updateContact(s: Session, id: string, p: { name?: string; phone?: string; notes?: string; tags?: string[] }) {
  const sb = await sbc();
  if (p.phone) {
    const dupe = await sb.from("contacts").select("id, name, phone").eq("company_id", s.companyId).eq("phone", p.phone).neq("id", id).maybeSingle();
    if (dupe.data) throw new MutationError(`Номер уже есть у контакта «${dupe.data.name ?? dupe.data.phone}».`);
  }
  const row: Record<string, unknown> = {};
  if (p.name !== undefined) row.name = p.name || null;
  if (p.phone !== undefined) row.phone = p.phone;
  if (p.notes !== undefined) row.notes = p.notes || null;
  if (p.tags !== undefined) row.tags = p.tags;
  const r = await sb.from("contacts").update(row).eq("company_id", s.companyId).eq("id", id).select(CONTACT_COLS).maybeSingle();
  if (r.error) fail(r.error, "Контакт с таким номером уже есть.");
  if (!r.data) throw new MutationError("Контакт не найден.");
  return toContact(r.data);
}

export async function eraseContact(s: Session, id: string) {
  const sb = await sbc();
  const r = await sb.rpc("erase_contact", { p_company_id: s.companyId, p_contact_id: id });
  if (r.error) fail(r.error);
}

// ───────────── AI и ассистент ─────────────
export async function setAiMode(s: Session, mode: AiMode) {
  const sb = await sbc();
  const r = await sb.rpc("set_ai_mode", { p_company_id: s.companyId, p_mode: mode });
  if (r.error) fail(r.error);
}

export async function updateAssistant(s: Session, patch: Partial<AssistantSettings>) {
  const sb = await sbc();
  const cur = await sb.from("assistant_settings").select("settings").eq("company_id", s.companyId).maybeSingle();
  const settings = { ...((cur.data?.settings as object) ?? {}), ...patch };
  const r = await sb.from("assistant_settings").upsert({ company_id: s.companyId, settings }, { onConflict: "company_id" }).select("id").maybeSingle();
  if (r.error) fail(r.error);
  if (!r.data) throw new MutationError("forbidden", "42501");
}

export async function markNotificationsRead(s: Session, ids?: string[]) {
  const sb = await sbc();
  let q = sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", s.userId).is("read_at", null);
  if (ids) q = q.in("id", ids);
  const r = await q;
  if (r.error) fail(r.error);
}

// ───────────── База знаний (черновик) ─────────────
const blockOf = (key: string) => BLOCKS.find((b) => b.fields.some((f) => f.key === key))?.id ?? BLOCKS.find((b) => key.startsWith(`${b.key}.`))?.id ?? 1;

export async function setField(s: Session, key: string, value: unknown) {
  const sb = await sbc();
  const qid = await draftId(sb, s.companyId);
  const r = value === null || value === ""
    ? await sb.from("questionnaire_fields").delete().eq("questionnaire_id", qid).eq("field_key", key)
    : await sb.from("questionnaire_fields").upsert({ company_id: s.companyId, questionnaire_id: qid, block: blockOf(key), field_key: key, value, source: "manual" }, { onConflict: "questionnaire_id,field_key" });
  if (r.error) fail(r.error);
  return qid;
}

const isUuid = (v?: string) => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Обновляет строки черновика с uuid, остальные вставляет. Возвращает строки в порядке входа. */
async function upsertRows(table: "services" | "staff" | "faq", s: Session, rows: ({ id?: string } & Record<string, unknown>)[]) {
  const sb = await sbc();
  const qid = await draftId(sb, s.companyId);
  const out: Record<string, unknown>[] = [];
  for (const { id, ...row } of rows) {
    const full = { ...row, company_id: s.companyId, questionnaire_id: qid };
    const r = isUuid(id)
      ? await sb.from(table).update(full).eq("questionnaire_id", qid).eq("id", id!).select("*").maybeSingle()
      : await sb.from(table).insert(full).select("*").single();
    if (r.error) fail(r.error);
    if (!r.data) throw new MutationError("Строка не найдена в черновике. Обновите страницу.");
    out.push(r.data);
  }
  return out;
}
export const upsertServiceRows = (s: Session, rows: ({ id?: string } & Record<string, unknown>)[]) => upsertRows("services", s, rows);
export const upsertStaffRows = (s: Session, rows: ({ id?: string } & Record<string, unknown>)[]) => upsertRows("staff", s, rows);
export const upsertFaqRows = (s: Session, rows: ({ id?: string } & Record<string, unknown>)[]) => upsertRows("faq", s, rows);

export async function deleteRows(s: Session, table: "services" | "staff" | "faq", ids: string[]) {
  const sb = await sbc();
  const qid = await draftId(sb, s.companyId);
  const r = await sb.from(table).delete().eq("questionnaire_id", qid).in("id", ids.filter(isUuid));
  if (r.error) fail(r.error);
}

export async function bulkPrice(s: Session, ids: string[], pct: number) {
  const sb = await sbc();
  const qid = await draftId(sb, s.companyId);
  const list = await sb.from("services").select("id, price_min, price_max").eq("questionnaire_id", qid).in("id", ids.filter(isUuid));
  if (list.error) fail(list.error);
  const round = (v: number) => Math.round((v * (100 + pct)) / 100 / 100) * 100;
  for (const sv of list.data ?? []) {
    const r = await sb.from("services").update({
      price_min: sv.price_min == null ? null : round(Number(sv.price_min)),
      price_max: sv.price_max == null ? null : round(Number(sv.price_max)),
    }).eq("id", sv.id);
    if (r.error) fail(r.error);
  }
}

export async function answerUnanswered(s: Session, id: string, shortAnswer: string) {
  const sb = await sbc();
  const uq = await sb.from("unanswered_questions").select("text").eq("company_id", s.companyId).eq("id", id).maybeSingle();
  if (!uq.data) throw new MutationError("Вопрос не найден.");
  const [faq] = await upsertFaqRows(s, [{ question: uq.data.text, synonyms: [], short_answer: shortAnswer, source: "unanswered", active: true }]);
  const r = await sb.from("unanswered_questions").update({ resolved: true, resolved_faq_id: faq!.id }).eq("id", id);
  if (r.error) fail(r.error);
}

/** Публикация: обязательные поля → снимок черновика → RPC (новая версия + новый черновик) */
export async function publish(s: Session): Promise<{ version?: number; missing: string[] }> {
  const sb = await sbc();
  const qid = await draftId(sb, s.companyId);
  const [content, branches, q] = await Promise.all([
    loadQuestionnaire(sb, qid), loadBranches(sb, s.companyId), sb.from("questionnaires").select("version").eq("id", qid).single(),
  ]);
  const missing = missingRequired(content.fields as FieldValues, counts(content)).map((m) => m.label);
  if (missing.length) return { missing };
  if (q.error) fail(q.error);
  const version = Number(q.data.version);
  const snapshot = snapshotFrom(content, branches, version);
  const r = await sb.rpc("publish_questionnaire", { p_company_id: s.companyId, p_payload: snapshot, p_missing: [] });
  if (r.error) fail(r.error);
  return { version: Number(r.data), missing: [] };
}
