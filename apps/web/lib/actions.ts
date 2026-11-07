"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  completeness, initialState, missingRequired, respondOffline, type DialogState, type EngineReply,
} from "@all/dialog";
import type { AiMode, Faq, Lead, MemberRole, Service, StaffMember } from "@all/db";
import { requireSession, startMockSession, endSession, type Session } from "./auth";
import { can, type Action } from "./permissions";
import { toE164 } from "./format";
import { db, emit, draftSnapshot, newPublishedSnapshot, patchLead, addLeadEvent, setAiModeInternal } from "./data/mock/store";

export type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string; fields?: string[] };

const rid = () => Math.random().toString(36).slice(2, 10);

async function guard(action: Action): Promise<Session> {
  const s = await requireSession();
  if (!can(s.member.role, action, s.member.permissions)) throw new Forbidden();
  return s;
}
class Forbidden extends Error { constructor() { super("forbidden"); } }

function audit(s: Session, action: string, entity: string, detail?: string) {
  db.audit.unshift({ id: rid(), actorName: s.supportMode ? `Поддержка (${s.member.name})` : s.member.name, action, entity, detail, createdAt: new Date().toISOString() });
}

/** Обёртка: zod-валидация на сервере, понятные ошибки, request_id для поддержки */
async function run<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof Forbidden) return { ok: false, error: "Недостаточно прав. Обратитесь к собственнику компании." };
    if (e instanceof z.ZodError) return { ok: false, error: "Проверьте заполнение полей.", fields: e.issues.map((i) => i.path.join(".")) };
    if (e instanceof UserError) return { ok: false, error: e.message };
    const requestId = rid();
    console.error(`[action] request_id=${requestId}`, e instanceof Error ? e.message : "unknown");
    return { ok: false, error: `Не получилось сохранить. Повторите или напишите в поддержку, код ${requestId}.` };
  }
}
class UserError extends Error {}

// ───────────── Переключатель AI ─────────────
const aiMode = z.enum(["on", "leads_only", "all_human", "off"]);
export async function setAiMode(mode: AiMode) {
  return run(async () => {
    const s = await guard("toggle_ai");
    const m = aiMode.parse(mode);
    const before = db.company.aiMode;
    setAiModeInternal(m);
    audit(s, "ai_mode", "Компания", `${before} → ${m}`);
    revalidatePath("/app", "layout");
  });
}

// ───────────── Заявки ─────────────
const leadPatch = z.object({
  status: z.enum(["new", "in_progress", "waiting", "won", "lost"]).optional(),
  assigneeId: z.string().nullable().optional(),
  priority: z.enum(["normal", "urgent"]).optional(),
  tags: z.array(z.enum(["complaint", "urgent", "missed", "vip"])).optional(),
  lostReason: z.string().min(2).max(300).optional(),
  payload: z.record(z.string(), z.string().max(500)).optional(),
  title: z.string().min(2).max(200).optional(),
}).refine((p) => p.status !== "lost" || !!p.lostReason, { message: "lost_reason_required", path: ["lostReason"] });

export async function updateLead(id: string, patch: z.input<typeof leadPatch>) {
  return run(async () => {
    const s = await guard("edit_leads");
    const p = leadPatch.parse(patch);
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) throw new UserError("Заявка не найдена или недоступна.");
    if (s.member.role === "staff" && lead.assigneeId && lead.assigneeId !== s.userId) throw new Forbidden();
    const next: Partial<Lead> = { ...p, assigneeId: p.assigneeId === null ? undefined : p.assigneeId ?? lead.assigneeId };
    if (!("assigneeId" in p)) delete next.assigneeId;
    return patchLead(id, next, s.userId);
  });
}

export async function bulkUpdateLeads(ids: string[], patch: z.input<typeof leadPatch>) {
  return run(async () => {
    const s = await guard("edit_leads");
    const p = leadPatch.parse(patch);
    z.array(z.string()).max(500).parse(ids);
    for (const id of ids) {
      const lead = db.leads.find((l) => l.id === id);
      if (!lead) continue;
      const next: Partial<Lead> = { ...p, assigneeId: p.assigneeId === null ? undefined : p.assigneeId ?? lead.assigneeId };
      if (!("assigneeId" in p)) delete next.assigneeId;
      if (p.tags) next.tags = Array.from(new Set([...lead.tags, ...p.tags]));
      patchLead(id, next, s.userId);
    }
    return ids.length;
  });
}

export async function commentLead(id: string, text: string) {
  return run(async () => {
    const s = await guard("edit_leads");
    const body = z.string().trim().min(1).max(2000).parse(text);
    const mentions = db.members.filter((m) => body.includes(`@${m.name.split(" ")[0]}`)).map((m) => m.userId);
    addLeadEvent({ leadId: id, actorId: s.userId, actorKind: "user", action: "comment", comment: body });
    for (const uid of mentions) {
      db.notifications.unshift({ id: rid(), kind: "lead_new", title: `${s.member.name} упомянул(а) вас в заявке`, body: body.slice(0, 80), href: `/app/leads?open=${id}`, createdAt: new Date().toISOString() });
      void uid;
    }
  });
}

const newLead = z.object({
  type: z.enum(["booking", "consultation", "order", "complaint", "reschedule", "callback", "other"]),
  title: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(5),
  name: z.string().trim().max(100).optional(),
  priority: z.enum(["normal", "urgent"]).default("normal"),
  sourceCallId: z.string().optional(),
  comment: z.string().max(1000).optional(),
});
export async function createLead(input: z.input<typeof newLead>) {
  return run(async () => {
    const s = await guard("edit_leads");
    const v = newLead.parse(input);
    const phone = toE164(v.phone);
    if (!phone) throw new UserError("Телефон указан неверно. Пример: +996 555 123 456");
    let contact = db.contacts.find((c) => c.phone === phone);
    if (!contact) {
      contact = { id: `ct_${rid()}`, phone, name: v.name, channels: ["phone"], tags: [], lastSeenAt: new Date().toISOString(), interactionsCount: 0, createdAt: new Date().toISOString() };
      db.contacts.unshift(contact);
    }
    const number = db.leads.reduce((m, l) => Math.max(m, l.number), 0) + 1;
    const now = new Date();
    const lead: Lead = {
      id: `ld_${number}`, number, source: v.sourceCallId ? "call" : "manual", sourceId: v.sourceCallId, type: v.type, title: v.title, status: "new",
      priority: v.priority, tags: [], contactId: contact.id, contactName: contact.name, contactPhone: phone, assigneeId: s.userId,
      dueAt: new Date(now.getTime() + (v.priority === "urgent" ? 15 : 120) * 60_000).toISOString(),
      payload: v.comment ? { comment: v.comment } : {}, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    db.leads.unshift(lead);
    addLeadEvent({ leadId: lead.id, actorId: s.userId, actorKind: "user", action: "created" });
    emit({ type: "lead.created", lead });
    return lead;
  });
}

// ───────────── Звонки ─────────────
export async function rateCall(id: string, rating: -1 | 1, reason?: string) {
  return run(async () => {
    await guard("listen_audio");
    const c = db.calls.find((x) => x.id === id);
    if (!c) throw new UserError("Звонок не найден.");
    c.rating = z.union([z.literal(-1), z.literal(1)]).parse(rating);
    c.ratingReason = rating === -1 ? z.string().min(2).max(200).parse(reason) : undefined;
    if (rating === -1 && reason) {
      const map: Record<string, typeof c.flags[number]> = { "Неверная цена": "wrong_price", "Не понял": "misunderstood", "Грубо": "rude", "Долго отвечал": "slow" };
      const flag = map[reason];
      if (flag && !c.flags.includes(flag)) c.flags.push(flag);
    }
  });
}

export async function markCallback(id: string) {
  return run(async () => {
    await guard("edit_leads");
    const c = db.calls.find((x) => x.id === id);
    if (!c) throw new UserError("Звонок не найден.");
    c.callbackDoneAt = new Date().toISOString();
  });
}

// ───────────── Контакты ─────────────
const contactPatch = z.object({ name: z.string().trim().max(100).optional(), phone: z.string().optional(), notes: z.string().max(2000).optional(), tags: z.array(z.string().max(30)).max(20).optional() });
export async function updateContact(id: string, patch: z.input<typeof contactPatch>) {
  return run(async () => {
    await guard("edit_leads");
    const p = contactPatch.parse(patch);
    const c = db.contacts.find((x) => x.id === id);
    if (!c) throw new UserError("Контакт не найден.");
    if (p.phone !== undefined) {
      const e = toE164(p.phone);
      if (!e) throw new UserError("Телефон указан неверно.");
      const dupe = db.contacts.find((x) => x.phone === e && x.id !== id);
      if (dupe) throw new UserError(`Номер уже есть у контакта «${dupe.name ?? dupe.phone}». Объедините карточки.`);
      p.phone = e;
    }
    Object.assign(c, p);
    return c;
  });
}

export async function createContact(input: { name?: string; phone: string }) {
  return run(async () => {
    await guard("edit_leads");
    const e = toE164(z.string().parse(input.phone));
    if (!e) throw new UserError("Телефон указан неверно. Пример: +996 555 123 456");
    const dupe = db.contacts.find((x) => x.phone === e);
    if (dupe) return dupe;
    const c = { id: `ct_${rid()}`, phone: e, name: input.name?.trim() || undefined, channels: ["phone"], tags: [], lastSeenAt: new Date().toISOString(), interactionsCount: 0, createdAt: new Date().toISOString() };
    db.contacts.unshift(c);
    return c;
  });
}

export async function mergeContacts(primaryId: string, otherIds: string[]) {
  return run(async () => {
    const s = await guard("edit_leads");
    const primary = db.contacts.find((c) => c.id === primaryId);
    if (!primary) throw new UserError("Контакт не найден.");
    for (const oid of otherIds) {
      const o = db.contacts.find((c) => c.id === oid);
      if (!o || o.id === primaryId) continue;
      for (const c of db.calls) if (c.contactId === oid) { c.contactId = primaryId; c.contactName = primary.name; }
      for (const l of db.leads) if (l.contactId === oid) { l.contactId = primaryId; l.contactName = primary.name; }
      primary.tags = Array.from(new Set([...primary.tags, ...o.tags]));
      primary.channels = Array.from(new Set([...primary.channels, ...o.channels]));
      primary.interactionsCount += o.interactionsCount;
      primary.name ??= o.name;
      db.contacts.splice(db.contacts.indexOf(o), 1);
    }
    audit(s, "merge", "Контакты", `${otherIds.length} → ${primary.name ?? primary.phone}`);
  });
}

/** Удаление данных контакта по запросу: аудио, расшифровки, сообщения; запись в аудит */
export async function eraseContact(id: string) {
  return run(async () => {
    const s = await guard("export_delete");
    const c = db.contacts.find((x) => x.id === id);
    if (!c) throw new UserError("Контакт не найден.");
    for (const call of db.calls.filter((x) => x.contactId === id)) {
      db.callTurns.delete(call.id);
      call.summary = undefined; call.caller = "+0000000"; call.contactId = undefined; call.contactName = undefined;
    }
    for (const l of db.leads.filter((x) => x.contactId === id)) { l.contactId = undefined; l.contactName = undefined; l.contactPhone = undefined; }
    db.contacts.splice(db.contacts.indexOf(c), 1);
    audit(s, "erase", "Контакт", `${c.phone?.slice(0, 7)}****`);
  });
}

// ───────────── Анкета ─────────────
async function guardKb() {
  return guard("edit_questionnaire");
}

export async function setField(key: string, value: unknown) {
  return run(async () => {
    await guardKb();
    z.string().regex(/^[a-z_]+\.[a-z_]+$/).parse(key);
    const v = z.union([z.string().max(5000), z.record(z.string(), z.unknown()), z.array(z.string()), z.null()]).parse(value);
    if (v === null || v === "") delete db.fields[key];
    else db.fields[key] = v;
    db.fieldSources[key] = "manual";
    return { completeness: completeness(db.fields, counts()) };
  });
}

function counts() {
  return { services: db.services.filter((s) => s.active).length, staff: db.staff.length, faq: db.faq.filter((f) => f.active).length };
}

const serviceSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(120),
  synonyms: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  priceType: z.enum(["exact", "range", "after_inspection"]),
  priceMin: z.number().int().nonnegative().optional(),
  priceMax: z.number().int().nonnegative().optional(),
  currency: z.enum(["KGS", "KZT", "RUB", "USD"]).default("KGS"),
  durationMin: z.number().int().positive().max(1440).optional(),
  staffIds: z.array(z.string()).default([]),
  branchIds: z.array(z.string()).default([]),
  active: z.boolean().default(true),
}).superRefine((s, ctx) => {
  if (s.priceType === "after_inspection" && (s.priceMin != null || s.priceMax != null)) ctx.addIssue({ code: "custom", path: ["priceMin"], message: "after_inspection_no_price" });
  if (s.priceType !== "after_inspection" && s.priceMin == null) ctx.addIssue({ code: "custom", path: ["priceMin"], message: "price_required" });
  if (s.priceType === "range" && s.priceMax != null && s.priceMin != null && s.priceMax < s.priceMin) ctx.addIssue({ code: "custom", path: ["priceMax"], message: "max_lt_min" });
});

export async function upsertServices(rows: z.input<typeof serviceSchema>[]) {
  return run(async () => {
    const s = await guardKb();
    const parsed = z.array(serviceSchema).max(500).parse(rows);
    const out: Service[] = [];
    for (const row of parsed) {
      const existing = row.id ? db.services.find((x) => x.id === row.id) : undefined;
      // «после осмотра» не хранит чисел, чтобы AI не мог их назвать
      const clean: Service = { ...row, id: existing?.id ?? `sv_${rid()}`, priceMin: row.priceType === "after_inspection" ? undefined : row.priceMin, priceMax: row.priceType === "exact" || row.priceType === "after_inspection" ? undefined : row.priceMax };
      if (existing) Object.assign(existing, clean); else db.services.push(clean);
      out.push(clean);
    }
    if (parsed.length > 1) audit(s, "import", "Услуги", `${parsed.length} строк`);
    return out;
  });
}

export async function deleteRows(table: "services" | "staff" | "faq", ids: string[]) {
  return run(async () => {
    await guardKb();
    const list = db[table] as { id: string }[];
    for (const id of ids) { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1); }
  });
}

export async function bulkPrice(ids: string[], pct: number) {
  return run(async () => {
    const s = await guardKb();
    const p = z.number().min(-90).max(500).parse(pct);
    for (const sv of db.services.filter((x) => ids.includes(x.id))) {
      if (sv.priceMin != null) sv.priceMin = Math.round((sv.priceMin * (100 + p)) / 100 / 100) * 100;
      if (sv.priceMax != null) sv.priceMax = Math.round((sv.priceMax * (100 + p)) / 100 / 100) * 100;
    }
    audit(s, "bulk_price", "Услуги", `${ids.length} услуг, ${p > 0 ? "+" : ""}${p}%`);
  });
}

const staffSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(100),
  specialties: z.array(z.string().max(60)).default([]),
  serviceIds: z.array(z.string()).default([]),
  branchId: z.string().optional(),
  hours: z.record(z.string(), z.array(z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)]))).default({}),
  languages: z.array(z.string()).default(["ru"]),
  transferPhone: z.string().optional(),
  bookable: z.boolean().default(true),
});
export async function upsertStaff(rows: z.input<typeof staffSchema>[]) {
  return run(async () => {
    await guardKb();
    const parsed = z.array(staffSchema).max(200).parse(rows);
    for (const row of parsed) {
      const phone = row.transferPhone ? toE164(row.transferPhone) : undefined;
      if (row.transferPhone && !phone) throw new UserError(`Телефон перевода у «${row.name}» указан неверно.`);
      const existing = row.id ? db.staff.find((x) => x.id === row.id) : undefined;
      const clean = { ...row, transferPhone: phone ?? undefined, id: existing?.id ?? `st_${rid()}` } as StaffMember;
      if (existing) Object.assign(existing, clean); else db.staff.push(clean);
    }
  });
}

const faqSchema = z.object({
  id: z.string().optional(),
  question: z.string().trim().min(3).max(300),
  synonyms: z.array(z.string().max(200)).default([]),
  shortAnswer: z.string().trim().min(2).max(400),
  longAnswer: z.string().max(3000).optional(),
  source: z.string().default("manual"),
  active: z.boolean().default(true),
});
export async function upsertFaq(rows: z.input<typeof faqSchema>[]) {
  return run(async () => {
    await guardKb();
    const parsed = z.array(faqSchema).max(500).parse(rows);
    const out: Faq[] = [];
    for (const row of parsed) {
      const existing = row.id ? db.faq.find((x) => x.id === row.id) : undefined;
      const clean = { ...row, id: existing?.id ?? `fq_${rid()}` } as Faq;
      if (existing) Object.assign(existing, clean); else db.faq.push(clean);
      out.push(clean);
    }
    return out;
  });
}

export async function answerUnanswered(id: string, shortAnswer: string) {
  return run(async () => {
    await guardKb();
    const uq = db.unanswered.find((u) => u.id === id);
    if (!uq) throw new UserError("Вопрос не найден.");
    const f: Faq = { id: `fq_${rid()}`, question: uq.text, synonyms: [], shortAnswer: z.string().trim().min(2).max(400).parse(shortAnswer), source: "unanswered", active: true };
    db.faq.push(f);
    uq.resolved = true;
  });
}

/** Публикация: проверка обязательных → новая версия → снимок для голоса. Текущие звонки доигрывают на старой версии. */
export async function publishQuestionnaire() {
  return run(async () => {
    const s = await guard("publish");
    const missing = missingRequired(db.fields, counts());
    if (missing.length) throw new UserError(`Заполните обязательные поля: ${missing.map((m) => m.label).join(", ")}`);
    const version = db.draftVersion;
    db.published.push({ version, publishedAt: new Date().toISOString(), snapshot: newPublishedSnapshot(version), fields: structuredClone(db.fields) });
    db.draftVersion = version + 1;
    audit(s, "publish", "Анкета", `Версия ${version}`);
    const n = { id: rid(), kind: "kb_published" as const, title: `Анкета опубликована, версия ${version}`, href: "/app/knowledge", createdAt: new Date().toISOString() };
    db.notifications.unshift(n);
    emit({ type: "notification", notification: n });
    revalidatePath("/app", "layout");
    return version;
  });
}

export async function rollbackQuestionnaire(version: number) {
  return run(async () => {
    const s = await guard("publish");
    const target = db.published.find((p) => p.version === version);
    if (!target) throw new UserError("Версия не найдена.");
    const next = db.draftVersion;
    db.published.push({ version: next, publishedAt: new Date().toISOString(), snapshot: { ...target.snapshot, version: next }, fields: structuredClone(target.fields) });
    db.fields = structuredClone(target.fields);
    db.draftVersion = next + 1;
    audit(s, "rollback", "Анкета", `К версии ${version} (как ${next})`);
    revalidatePath("/app", "layout");
    return next;
  });
}

/** Тестовый чат «Как ответит AI» — по ТЕКУЩЕМУ ЧЕРНОВИКУ, не по опубликованной версии */
export async function testChat(message: string, state?: DialogState): Promise<Result<EngineReply>> {
  return run(async () => {
    await requireSession();
    const text = z.string().trim().min(1).max(1000).parse(message);
    const mode = db.assistant.mode === "booking" || db.assistant.mode === "semi" ? "consult" : db.assistant.mode;
    return respondOffline(draftSnapshot(), text, state ?? initialState(), { channel: "chat", mode });
  });
}

/** Демо-линия в браузере (фаза 0): без входа, по снимку демо-роли, с ограничителем по IP */
const demoHits = new Map<string, { n: number; at: number }>();
export async function demoChat(message: string, state?: DialogState): Promise<Result<EngineReply>> {
  return run(async () => {
    const { headers } = await import("next/headers");
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const h = demoHits.get(ip);
    const now = Date.now();
    if (h && now - h.at < 86400_000 && h.n >= 120) throw new UserError("Лимит демо на сегодня исчерпан. Позвоните на демо-линию или оставьте заявку.");
    demoHits.set(ip, { n: h && now - h.at < 86400_000 ? h.n + 1 : 1, at: h && now - h.at < 86400_000 ? h.at : now });
    const { DEMO_SNAPSHOT } = await import("@all/dialog");
    return respondOffline(DEMO_SNAPSHOT, z.string().trim().min(1).max(500).parse(message), state ?? initialState(), { channel: "voice", mode: "demo", phase: "0" });
  });
}

/** Проверка вопросами: 30 типовых вопросов сферы по черновику */
export async function runQuestionCheck() {
  return run(async () => {
    await requireSession();
    const { SPHERE_QUESTIONS } = await import("./sphere-questions");
    const snap = draftSnapshot();
    return (SPHERE_QUESTIONS.autoservice ?? []).map((q) => {
      const r = respondOffline(snap, q.text, initialState(), { channel: "chat", mode: "consult" });
      const cannot = !!r.unanswered || /уточнит администратор/i.test(r.text);
      return { question: q.text, answer: r.text, source: r.sources[0]?.source ?? r.toolCalls[0]?.name ?? "", cannot, field: q.field };
    });
  });
}

// ───────────── Ассистент ─────────────
const assistantSchema = z.object({
  voice: z.string().optional(), speed: z.number().min(0.8).max(1.3).optional(),
  pronunciation: z.array(z.object({ word: z.string().min(1).max(60), say: z.string().min(1).max(60) })).max(100).optional(),
  name: z.string().trim().min(2).max(40).optional(),
  greeting: z.string().trim().min(10).max(300).refine((g) => /виртуальн|ассистент|помощник|бот|AI|ИИ/i.test(g), "ai_disclosure").optional(),
  farewell: z.string().max(200).optional(),
  mode: z.enum(["leads", "consult", "booking", "semi"]).optional(),
  handoffRules: z.string().max(2000).optional(), handoffQueue: z.array(z.string()).optional(),
  handoffTimeoutS: z.number().int().min(10).max(60).optional(), noAnswerPhrase: z.string().max(300).optional(),
  maxCallMinutes: z.number().int().min(2).max(60).optional(), onLimit: z.enum(["leads_only", "all_human"]).optional(),
});
export async function updateAssistant(patch: z.input<typeof assistantSchema>) {
  return run(async () => {
    const s = await guard("publish");
    const p = assistantSchema.parse(patch);
    const plan = db.plans.find((x) => x.key === db.usage.planKey)!;
    if (p.mode && !plan.modes.includes(p.mode)) throw new UserError("Режим недоступен на вашем тарифе.");
    if (p.mode && (p.mode === "booking" || p.mode === "semi")) throw new UserError("Режим станет доступен в следующих обновлениях.");
    Object.assign(db.assistant, p);
    audit(s, "update", "Ассистент", Object.keys(p).join(", "));
  });
}

export async function updateNumber(id: string, patch: { receive?: "always" | "no_answer" | "schedule"; noAnswerSeconds?: number }) {
  return run(async () => {
    const s = await guard("publish");
    const n = db.numbers.find((x) => x.id === id);
    if (!n) throw new UserError("Номер не найден.");
    const p = z.object({ receive: z.enum(["always", "no_answer", "schedule"]).optional(), noAnswerSeconds: z.number().int().min(5).max(60).optional() }).parse(patch);
    Object.assign(n, p);
    audit(s, "update", "Номер", n.e164);
  });
}

// ───────────── Команда ─────────────
const inviteSchema = z.object({ contact: z.string().trim().min(5).max(120), role: z.enum(["admin", "staff", "accountant"]) });
export async function inviteMember(input: z.input<typeof inviteSchema>) {
  return run(async () => {
    const s = await guard("manage_team");
    const v = inviteSchema.parse(input);
    const isEmail = v.contact.includes("@");
    const phone = isEmail ? undefined : toE164(v.contact);
    if (!isEmail && !phone) throw new UserError("Укажите email или телефон в формате +996…");
    const m = { id: `m_${rid()}`, userId: `u_${rid()}`, name: isEmail ? v.contact.split("@")[0]! : phone!, email: isEmail ? v.contact : undefined, phone: phone ?? undefined, role: v.role as MemberRole, permissions: {}, branchIds: [], telegramLinked: false, invitedAt: new Date().toISOString() };
    db.members.push(m);
    audit(s, "invite", "Команда", `${v.contact} — ${v.role}`);
    return m;
  });
}

export async function updateMember(id: string, patch: { role?: MemberRole; permissions?: Record<string, boolean>; branchIds?: string[]; transferPhone?: string }) {
  return run(async () => {
    const s = await guard("manage_team");
    const m = db.members.find((x) => x.id === id);
    if (!m) throw new UserError("Сотрудник не найден.");
    if (m.role === "owner" && patch.role && patch.role !== "owner") throw new UserError("Роль собственника меняется только через передачу прав.");
    const p = z.object({ role: z.enum(["admin", "staff", "accountant"]).optional(), permissions: z.record(z.string(), z.boolean()).optional(), branchIds: z.array(z.string()).optional(), transferPhone: z.string().optional() }).parse(patch);
    if (p.transferPhone) { const e = toE164(p.transferPhone); if (!e) throw new UserError("Телефон перевода указан неверно."); p.transferPhone = e; }
    Object.assign(m, p);
    audit(s, "update", "Команда", `${m.name}: ${Object.keys(p).join(", ")}`);
  });
}

/** Отключение: доступ теряется сразу (JWT короткоживущий), заявки предлагается переназначить */
export async function disableMember(id: string, reassignTo?: string) {
  return run(async () => {
    const s = await guard("manage_team");
    const m = db.members.find((x) => x.id === id);
    if (!m || m.role === "owner") throw new UserError("Этого сотрудника нельзя отключить.");
    m.disabledAt = new Date().toISOString();
    let moved = 0;
    for (const l of db.leads.filter((x) => x.assigneeId === m.userId && x.status !== "won" && x.status !== "lost")) {
      patchLead(l.id, { assigneeId: reassignTo }, s.userId);
      moved++;
    }
    audit(s, "disable", "Команда", `${m.name}, заявок переназначено: ${moved}`);
    return moved;
  });
}

// ───────────── Тариф ─────────────
export async function setOverage(policy: "pay" | "stop_ai", capMinor?: number) {
  return run(async () => {
    const s = await guard("view_billing");
    if (s.member.role !== "owner") throw new Forbidden();
    db.usage.overagePolicy = z.enum(["pay", "stop_ai"]).parse(policy);
    db.usage.overageCapMinor = capMinor != null ? z.number().int().nonnegative().parse(capMinor) : 0;
    audit(s, "update", "Тариф", `Перерасход: ${policy}`);
  });
}

export async function buyMinutes(pack: 100 | 500 | 1000) {
  return run(async () => {
    const s = await guard("view_billing");
    const p = z.union([z.literal(100), z.literal(500), z.literal(1000)]).parse(pack);
    db.usage.extraMinutes += p;
    const number = `ALL-2026-${String(200 + db.invoices.length).padStart(4, "0")}`;
    db.invoices.unshift({ id: rid(), number, periodStart: new Date().toISOString().slice(0, 10), periodEnd: new Date().toISOString().slice(0, 10), amountMinor: p * 1500, currency: "KGS", status: "issued" });
    audit(s, "buy", "Тариф", `+${p} минут, счёт ${number}`);
    return number;
  });
}

// ───────────── Уведомления ─────────────
export async function markNotificationsRead(ids?: string[]) {
  return run(async () => {
    await requireSession();
    const now = new Date().toISOString();
    for (const n of db.notifications) if (!ids || ids.includes(n.id)) n.readAt ??= now;
  });
}

export async function setNotificationPref(userId: string, kind: string, channel: "app" | "telegram" | "email" | "push", on: boolean) {
  return run(async () => {
    const s = await requireSession();
    if (userId !== s.userId && s.member.role !== "owner") throw new Forbidden();
    const list = (db.notificationPrefs[userId] ??= []);
    let p = list.find((x) => x.kind === kind);
    if (!p) { p = { kind, channels: [] }; list.push(p); }
    p.channels = on ? Array.from(new Set([...p.channels, channel])) : p.channels.filter((c) => c !== channel);
  });
}

// ───────────── Настройки ─────────────
const companySchema = z.object({ name: z.string().trim().min(2).max(120).optional(), timezone: z.string().optional(), currency: z.enum(["KGS", "KZT", "RUB", "USD"]).optional() });
export async function updateCompany(patch: z.input<typeof companySchema>) {
  return run(async () => {
    const s = await guard("manage_team");
    Object.assign(db.company, companySchema.parse(patch));
    audit(s, "update", "Компания", Object.keys(patch).join(", "));
    revalidatePath("/app", "layout");
  });
}

export async function setLocale(locale: "ru" | "ky" | "en") {
  const store = await cookies();
  store.set("locale", z.enum(["ru", "ky", "en"]).parse(locale), { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

export async function createApiKey(name: string, scopes: string[]) {
  return run(async () => {
    const s = await guard("export_delete");
    const key = `all_live_${rid()}${rid()}${rid()}`;
    db.apiKeys.unshift({ id: rid(), name: z.string().min(2).max(60).parse(name), prefix: key.slice(0, 12), scopes: z.array(z.string()).min(1).parse(scopes), createdAt: new Date().toISOString() });
    audit(s, "create", "API-ключ", name);
    return key; // показывается один раз
  });
}

export async function revokeApiKey(id: string) {
  return run(async () => {
    const s = await guard("export_delete");
    const k = db.apiKeys.find((x) => x.id === id);
    if (k) { k.revokedAt = new Date().toISOString(); audit(s, "revoke", "API-ключ", k.name); }
  });
}

export async function requestExport() {
  return run(async () => {
    const s = await guard("export_delete");
    audit(s, "export", "Данные", "Полный экспорт поставлен в очередь");
  });
}

export async function eraseByPhone(phone: string) {
  return run(async () => {
    await guard("export_delete");
    const e = toE164(phone);
    if (!e) throw new UserError("Телефон указан неверно.");
    const c = db.contacts.find((x) => x.phone === e);
    if (!c) throw new UserError("Данных по этому номеру нет.");
    const r = await eraseContact(c.id);
    if (!r.ok) throw new UserError(r.error);
  });
}

// ───────────── Интеграции ─────────────
export async function retryIntegrationEvent(key: string, logId: string) {
  return run(async () => {
    await guard("manage_integrations");
    const log = db.integrationLogs[key]?.find((x) => x.id === logId);
    if (!log) throw new UserError("Событие не найдено.");
    db.integrationLogs[key]!.unshift({ ...log, id: rid(), at: new Date().toISOString(), status: "ok", error: undefined, ms: 210 });
  });
}

export async function linkTelegram(memberId: string) {
  return run(async () => {
    await requireSession();
    const token = rid() + rid();
    return `https://t.me/all_manager_bot?start=${memberId}_${token}`;
  });
}

// ───────────── Вход ─────────────
const contactSchema = z.string().trim().min(5).max(120);
const MAX_ATTEMPTS = 5;
const LOCK_MS = 10 * 60_000;

export async function requestCode(contact: string) {
  return run(async () => {
    const c = normalizeContact(contactSchema.parse(contact));
    const prev = db.otp.get(c);
    if (prev?.lockedUntil && prev.lockedUntil > Date.now()) throw new UserError("Слишком много попыток. Повторите через 10 минут.");
    if (prev && Date.now() - prev.sentAt < 60_000) throw new UserError("Код уже отправлен. Повторить можно через минуту.");
    // В mock-режиме код всегда 000000; в supabase — signInWithOtp
    db.otp.set(c, { code: "000000", attempts: 0, sentAt: Date.now() });
    return { channel: c.includes("@") ? "email" : "sms" };
  });
}

export async function verifyCode(contact: string, code: string) {
  return run(async () => {
    const c = normalizeContact(contactSchema.parse(contact));
    const entry = db.otp.get(c);
    if (!entry) throw new UserError("Код истёк. Запросите новый.");
    if (entry.lockedUntil && entry.lockedUntil > Date.now()) throw new UserError("Слишком много попыток. Повторите через 10 минут.");
    if (Date.now() - entry.sentAt > 10 * 60_000) throw new UserError("Код истёк. Запросите новый.");
    if (z.string().regex(/^\d{6}$/).parse(code) !== entry.code) {
      entry.attempts++;
      if (entry.attempts >= MAX_ATTEMPTS) { entry.lockedUntil = Date.now() + LOCK_MS; throw new UserError("Слишком много попыток. Повторите через 10 минут."); }
      throw new UserError(`Неверный код. Осталось попыток: ${MAX_ATTEMPTS - entry.attempts}.`);
    }
    db.otp.delete(c);
    const member = db.members.find((m) => m.email === c || m.phone === c) ?? db.members[0]!;
    if (member.disabledAt) throw new UserError("Доступ отключён. Обратитесь к собственнику компании.");
    // 2FA для собственника: TOTP после кода
    if (member.role === "owner") {
      db.otp.set(`totp:${c}`, { code: "000000", attempts: 0, sentAt: Date.now() });
      return { next: "", twofa: true };
    }
    await startMockSession(member.userId);
    return { next: "/app", twofa: false };
  });
}

export async function verifyTotp(contact: string, code: string) {
  return run(async () => {
    const c = normalizeContact(contactSchema.parse(contact));
    const entry = db.otp.get(`totp:${c}`);
    if (!entry || Date.now() - entry.sentAt > 5 * 60_000) throw new UserError("Сессия входа истекла. Начните заново.");
    if (z.string().regex(/^\d{6}$/).parse(code) !== entry.code) {
      entry.attempts++;
      if (entry.attempts >= MAX_ATTEMPTS) { db.otp.delete(`totp:${c}`); throw new UserError("Слишком много попыток. Начните вход заново."); }
      throw new UserError(`Неверный код из приложения. Осталось попыток: ${MAX_ATTEMPTS - entry.attempts}.`);
    }
    db.otp.delete(`totp:${c}`);
    const member = db.members.find((m) => m.email === c || m.phone === c) ?? db.members[0]!;
    await startMockSession(member.userId);
    return { next: "/app" };
  });
}

function normalizeContact(c: string) {
  return c.includes("@") ? c.toLowerCase() : toE164(c) ?? c;
}

export async function devLoginAs(userId: string) {
  if (process.env.DATA_SOURCE === "supabase") return { ok: false as const, error: "Недоступно" };
  await startMockSession(z.string().parse(userId));
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function logout() {
  await endSession();
  revalidatePath("/", "layout");
}

export async function acceptInvite(token: string) {
  return run(async () => {
    z.string().min(6).parse(token);
    const staff = db.members.find((m) => m.role === "staff")!;
    await startMockSession(staff.userId);
    return { next: "/app" };
  });
}

/** Вход поддержки в кабинет клиента — по согласию в тикете, с аудитом */
export async function supportLogin(companyId: string, ticket: string) {
  return run(async () => {
    z.string().min(3).parse(ticket);
    const store = await cookies();
    store.set("support", "1", { path: "/", httpOnly: true, maxAge: 60 * 60 });
    await startMockSession(db.members[0]!.userId);
    db.audit.unshift({ id: rid(), actorName: "Поддержка ALL", action: "support_login", entity: "Кабинет", detail: `Тикет ${ticket}, компания ${companyId}`, createdAt: new Date().toISOString() });
    return { next: "/app" };
  });
}

export async function endSupport() {
  const store = await cookies();
  store.delete("support");
  revalidatePath("/", "layout");
}
