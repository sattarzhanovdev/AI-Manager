"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  completeness, initialState, missingRequired, respondOffline, type DialogState, type EngineReply, demoSnapshot, detectDemoRole, DEMO_ROLE_KEYS, type DemoRole,
} from "@all/dialog";
import type { AiMode, Faq, Lead, MemberRole, Service, StaffMember } from "@all/db";
import { requireSession, startMockSession, endSession, type Session } from "./auth";
import { can, type Action } from "./permissions";
import { toE164 } from "./format";
import { isSupabase, mockAuthAllowed, isDjango } from "./env";
import { db, emit, draftSnapshot, newPublishedSnapshot, patchLead, addLeadEvent, setAiModeInternal, publishedSnapshot } from "./data/mock/store";
import * as sbm from "./data/sb/mutations";
import { KbError, draftSnapshot as sbDraftSnapshot } from "./data/sb/kb";
import { createServerSupabase } from "./supabase/server";
import { assistantTurn, TurnError, type TurnReply } from "./ai/turn";

import { djangoAction, djangoFetch, DJANGO_COOKIE, DjangoError } from "./django";
import type { Contact, Member } from "@all/db";

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
    if (e instanceof DjangoError || e instanceof UserError || e instanceof KbError || e instanceof TurnError) return { ok: false, error: e.message };
    if (e instanceof sbm.MutationError) {
      if (e.code === "42501") return { ok: false, error: "Недостаточно прав. Обратитесь к собственнику компании." };
      if (!e.code || e.code === "23505") return { ok: false, error: e.message };
    }
    const requestId = rid();
    console.error(`[action] request_id=${requestId}`, e instanceof Error ? e.message : "unknown");
    return { ok: false, error: `Не получилось сохранить. Повторите или напишите в поддержку, код ${requestId}.` };
  }
}
class UserError extends Error {}

/** Разделы, не подключённые к базе в Hackathon MVP, не изображают успех */
function notInMvp() {
  if (isSupabase) throw new UserError("Недоступно в демо-версии MVP: раздел не подключён к базе.");
}

// ───────────── Переключатель AI ─────────────
const aiMode = z.enum(["on", "leads_only", "all_human", "off"]);
export async function setAiMode(mode: AiMode) {
  if (isDjango) return djangoAction("setAiMode", [mode]);
  return run(async () => {
    const s = await guard("toggle_ai");
    const m = aiMode.parse(mode);
    if (isSupabase) { await sbm.setAiMode(s, m); revalidatePath("/app", "layout"); return; }
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
  if (isDjango) return djangoAction<Lead>("updateLead", [id, patch]);
  return run(async () => {
    const s = await guard("edit_leads");
    const p = leadPatch.parse(patch);
    if (isSupabase) {
      if (s.member.role === "staff" && p.assigneeId && p.assigneeId !== s.userId) throw new Forbidden();
      const l = await sbm.updateLead(s, z.string().uuid().parse(id), p);
      if (!l) throw new UserError("Заявка не найдена или недоступна.");
      return l;
    }
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) throw new UserError("Заявка не найдена или недоступна.");
    if (s.member.role === "staff" && lead.assigneeId && lead.assigneeId !== s.userId) throw new Forbidden();
    const next: Partial<Lead> = { ...p, assigneeId: p.assigneeId === null ? undefined : p.assigneeId ?? lead.assigneeId };
    if (!("assigneeId" in p)) delete next.assigneeId;
    return patchLead(id, next, s.userId);
  });
}

export async function bulkUpdateLeads(ids: string[], patch: z.input<typeof leadPatch>) {
  if (isDjango) return djangoAction<number>("bulkUpdateLeads", [ids, patch]);
  return run(async () => {
    const s = await guard("edit_leads");
    const p = leadPatch.parse(patch);
    z.array(z.string()).max(500).parse(ids);
    if (isSupabase) {
      if (s.member.role === "staff" && p.assigneeId && p.assigneeId !== s.userId) throw new Forbidden();
      let n = 0;
      for (const id of z.array(z.string().uuid()).parse(ids)) if (await sbm.updateLead(s, id, p, true)) n++;
      return n;
    }
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
  if (isDjango) return djangoAction("commentLead", [id, text]);
  return run(async () => {
    const s = await guard("edit_leads");
    const body = z.string().trim().min(1).max(2000).parse(text);
    if (isSupabase) { await sbm.commentLead(s, z.string().uuid().parse(id), body); return; }
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
  if (isDjango) return djangoAction<Lead>("createLead", [input]);
  return run(async () => {
    const s = await guard("edit_leads");
    const v = newLead.parse(input);
    const phone = toE164(v.phone);
    if (!phone) throw new UserError("Телефон указан неверно. Пример: +996 555 123 456");
    if (isSupabase) return sbm.createLead(s, { ...v, phone, sourceCallId: v.sourceCallId ? z.string().uuid().parse(v.sourceCallId) : undefined });
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
  if (isDjango) return djangoAction("rateCall", [id, rating, reason]);
  return run(async () => {
    const s = await guard("listen_audio");
    if (isSupabase) {
      const r = z.union([z.literal(-1), z.literal(1)]).parse(rating);
      await sbm.updateCall(s, z.string().uuid().parse(id), { rating: r, rating_reason: r === -1 ? z.string().min(2).max(200).parse(reason) : null });
      return;
    }
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
  if (isDjango) return djangoAction("markCallback", [id]);
  return run(async () => {
    const s = await guard("edit_leads");
    if (isSupabase) { await sbm.updateCall(s, z.string().uuid().parse(id), { callback_done_at: new Date().toISOString() }); return; }
    const c = db.calls.find((x) => x.id === id);
    if (!c) throw new UserError("Звонок не найден.");
    c.callbackDoneAt = new Date().toISOString();
  });
}

// ───────────── Контакты ─────────────
const contactPatch = z.object({ name: z.string().trim().max(100).optional(), phone: z.string().optional(), notes: z.string().max(2000).optional(), tags: z.array(z.string().max(30)).max(20).optional() });
export async function updateContact(id: string, patch: z.input<typeof contactPatch>) {
  if (isDjango) return djangoAction<Contact>("updateContact", [id, patch]);
  return run(async () => {
    const s = await guard("edit_leads");
    const p = contactPatch.parse(patch);
    if (isSupabase) {
      if (p.phone !== undefined) { const e = toE164(p.phone); if (!e) throw new UserError("Телефон указан неверно."); p.phone = e; }
      return sbm.updateContact(s, z.string().uuid().parse(id), p);
    }
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
  if (isDjango) return djangoAction<Contact>("createContact", [input]);
  return run(async () => {
    const s = await guard("edit_leads");
    const e = toE164(z.string().parse(input.phone));
    if (!e) throw new UserError("Телефон указан неверно. Пример: +996 555 123 456");
    if (isSupabase) return sbm.createContact(s, e, z.string().trim().max(100).optional().parse(input.name));
    const dupe = db.contacts.find((x) => x.phone === e);
    if (dupe) return dupe;
    const c = { id: `ct_${rid()}`, phone: e, name: input.name?.trim() || undefined, channels: ["phone"], tags: [], lastSeenAt: new Date().toISOString(), interactionsCount: 0, createdAt: new Date().toISOString() };
    db.contacts.unshift(c);
    return c;
  });
}

export async function mergeContacts(primaryId: string, otherIds: string[]) {
  if (isDjango) return djangoAction("mergeContacts", [primaryId, otherIds]);
  return run(async () => {
    const s = await guard("edit_leads");
    notInMvp();
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
  if (isDjango) return djangoAction("eraseContact", [id]);
  return run(async () => {
    const s = await guard("export_delete");
    if (isSupabase) { await sbm.eraseContact(s, z.string().uuid().parse(id)); return; }
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
  if (isDjango) return djangoAction<{ completeness: number }>("setField", [key, value]);
  return run(async () => {
    const s = await guardKb();
    z.string().regex(/^[a-z_]+\.[a-z_]+$/).parse(key);
    const v = z.union([z.string().max(5000), z.record(z.string(), z.unknown()), z.array(z.string()), z.null()]).parse(value);
    if (isSupabase) {
      await sbm.setField(s, key, v);
      const q = await (await import("./data/sb/repo")).getQuestionnaire(s);
      return { completeness: q.draft.completeness };
    }
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
  if (isDjango) return djangoAction<Service[]>("upsertServices", [rows]);
  return run(async () => {
    const s = await guardKb();
    const parsed = z.array(serviceSchema).max(500).parse(rows);
    if (isSupabase) {
      const uuids = (a: string[]) => a.filter((x) => z.string().uuid().safeParse(x).success);
      const saved = await sbm.upsertServiceRows(s, parsed.map((r) => ({
        id: r.id, name: r.name, synonyms: r.synonyms, price_type: r.priceType,
        price_min: r.priceType === "after_inspection" ? null : r.priceMin ?? null,
        price_max: r.priceType === "exact" || r.priceType === "after_inspection" ? null : r.priceMax ?? null,
        currency: r.currency, duration_min: r.durationMin ?? null, staff_ids: uuids(r.staffIds), branch_ids: uuids(r.branchIds), active: r.active,
      })));
      const { toService } = await import("./data/sb/map");
      return saved.map(toService);
    }
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
  if (isDjango) return djangoAction("deleteRows", [table, ids]);
  return run(async () => {
    const s = await guardKb();
    z.enum(["services", "staff", "faq"]).parse(table);
    if (isSupabase) { await sbm.deleteRows(s, table, z.array(z.string()).max(500).parse(ids)); return; }
    const list = db[table] as { id: string }[];
    for (const id of ids) { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1); }
  });
}

export async function bulkPrice(ids: string[], pct: number) {
  if (isDjango) return djangoAction("bulkPrice", [ids, pct]);
  return run(async () => {
    const s = await guardKb();
    const p = z.number().min(-90).max(500).parse(pct);
    if (isSupabase) { await sbm.bulkPrice(s, z.array(z.string()).max(500).parse(ids), p); return; }
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
  if (isDjango) return djangoAction<StaffMember[]>("upsertStaff", [rows]);
  return run(async () => {
    const s = await guardKb();
    const parsed = z.array(staffSchema).max(200).parse(rows);
    if (isSupabase) {
      const isId = (x?: string) => !!x && z.string().uuid().safeParse(x).success;
      await sbm.upsertStaffRows(s, parsed.map((r) => {
        const phone = r.transferPhone ? toE164(r.transferPhone) : null;
        if (r.transferPhone && !phone) throw new UserError(`Телефон перевода у «${r.name}» указан неверно.`);
        return { id: r.id, name: r.name, specialties: r.specialties, services: r.serviceIds.filter(isId), branch_id: isId(r.branchId) ? r.branchId : null, hours: r.hours, languages: r.languages, transfer_phone: phone, bookable: r.bookable };
      }));
      return;
    }
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
  if (isDjango) return djangoAction<Faq[]>("upsertFaq", [rows]);
  return run(async () => {
    const s = await guardKb();
    const parsed = z.array(faqSchema).max(500).parse(rows);
    if (isSupabase) {
      const saved = await sbm.upsertFaqRows(s, parsed.map((r) => ({ id: r.id, question: r.question, synonyms: r.synonyms, short_answer: r.shortAnswer, long_answer: r.longAnswer ?? null, source: r.source, active: r.active })));
      const { toFaq } = await import("./data/sb/map");
      return saved.map(toFaq);
    }
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
  if (isDjango) return djangoAction("answerUnanswered", [id, shortAnswer]);
  return run(async () => {
    const s = await guardKb();
    if (isSupabase) { await sbm.answerUnanswered(s, z.string().uuid().parse(id), z.string().trim().min(2).max(400).parse(shortAnswer)); return; }
    const uq = db.unanswered.find((u) => u.id === id);
    if (!uq) throw new UserError("Вопрос не найден.");
    const f: Faq = { id: `fq_${rid()}`, question: uq.text, synonyms: [], shortAnswer: z.string().trim().min(2).max(400).parse(shortAnswer), source: "unanswered", active: true };
    db.faq.push(f);
    uq.resolved = true;
  });
}

/** Публикация: проверка обязательных → новая версия → снимок для голоса. Текущие звонки доигрывают на старой версии. */
export async function publishQuestionnaire() {
  if (isDjango) return djangoAction<number>("publishQuestionnaire", []);
  return run(async () => {
    const s = await guard("publish");
    if (isSupabase) {
      const r = await sbm.publish(s);
      if (r.missing.length) throw new UserError(`Заполните обязательные поля: ${r.missing.join(", ")}`);
      revalidatePath("/app", "layout");
      return r.version!;
    }
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
  if (isDjango) return djangoAction<number>("rollbackQuestionnaire", [version]);
  return run(async () => {
    const s = await guard("publish");
    notInMvp();
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

/**
 * Тестовый чат «Как ответит AI» — по ТЕКУЩЕМУ ЧЕРНОВИКУ, локальным движком.
 * Это проверка черновика: заявки здесь не создаются, и ответ честно об этом говорит.
 */
export async function testChat(message: string, state?: DialogState): Promise<Result<EngineReply>> {
  return run(async () => {
    const s = await guard("edit_questionnaire");
    const text = z.string().trim().min(1).max(1000).parse(message);
    const snap = isDjango ? (await import("@all/dialog")).buildSnapshot(await (async () => { const q = await (await import("./data/repo")).getQuestionnaire(s); return { ...q, version: q.draft.version, services: q.services.map((x) => ({ ...x, staff: x.staffIds })) }; })()) : isSupabase ? await sbDraftSnapshot(await createServerSupabase(), s.companyId) : draftSnapshot();
    const r = respondOffline(snap, text, state ?? initialState(), { channel: "chat", mode: "consult" });
    if (r.toolCalls.some((t) => t.name === "create_lead" && t.status === "ok")) r.text += " (Проверка черновика: заявка не сохраняется. Настоящую заявку создаёт тест в разделе «Ассистент».)";
    return r;
  });
}

const turnSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(1000),
  channel: z.enum(["voice", "chat"]).default("chat"),
});
export interface AssistantReply extends Pick<TurnReply, "conversationId" | "text" | "engine" | "model" | "fallback" | "tools" | "lead" | "limited"> { mock?: boolean }

/** «Протестировать AI»: ход диалога по ОПУБЛИКОВАННОЙ базе знаний; заявка создаётся в базе по-настоящему */
export async function assistantMessage(input: z.input<typeof turnSchema>): Promise<Result<AssistantReply>> {
  return run(async () => {
    const s = await requireSession();
    if (s.member.role !== "owner" && s.member.role !== "admin") throw new Forbidden();
    const v = turnSchema.parse(input);
    if (isDjango) return (await import("./ai/django-turn")).djangoAssistantTurn(v);
    if (!isSupabase) {
      // Локальная разработка без базы: ответ по опубликованному снимку, заявка не сохраняется
      const r = respondOffline(publishedSnapshot(), v.message, initialState(), { channel: v.channel, mode: "consult" });
      return { conversationId: v.conversationId ?? "00000000-0000-4000-8000-000000000000", text: r.text, engine: "offline", fallback: "no_key", tools: r.toolCalls.map((t) => t.name), mock: true };
    }
    const settings = await (await import("./data/sb/repo")).getAssistant(s);
    const r = await assistantTurn(s, { ...v, greeting: settings.greeting });
    if (r.lead) revalidatePath("/app", "layout");
    return { conversationId: r.conversationId, text: r.text, engine: r.engine, model: r.model, fallback: r.fallback, tools: r.tools, lead: r.lead, limited: r.limited };
  });
}

/** Демо-линия в браузере (фаза 0): без входа, по снимку демо-роли, с ограничителем по IP */
const demoHits = new Map<string, { n: number; at: number }>();
export async function demoChat(message: string, state?: DialogState, role: DemoRole = "autoservice"): Promise<Result<EngineReply>> {
  return run(async () => {
    const { headers } = await import("next/headers");
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const h = demoHits.get(ip);
    const now = Date.now();
    if (h && now - h.at < 86400_000 && h.n >= 120) throw new UserError("Лимит демо на сегодня исчерпан. Позвоните на демо-линию или оставьте заявку.");
    demoHits.set(ip, { n: h && now - h.at < 86400_000 ? h.n + 1 : 1, at: h && now - h.at < 86400_000 ? h.at : now });
    const text = z.string().trim().min(1).max(500).parse(message);
    const nextRole = detectDemoRole(text);
    const switchRole = !!nextRole && (nextRole !== role || /а теперь|дава[йт]|как будто|роль|^[1-6]$/i.test(text));
    const snapshot = demoSnapshot(nextRole ?? z.enum(DEMO_ROLE_KEYS).parse(role));
    const r = respondOffline(snapshot, text, switchRole ? initialState() : state ?? initialState(), { channel: "voice", mode: "demo", phase: "0" });
    if (switchRole) r.text = snapshot.style.greeting;
    if (/^(стоп|выйти из демо|выход)[.!]?$/i.test(text)) {
      r.text = "Демонстрация завершена. В реальной работе я бы сохранил карточку обращения и передал заявку администратору. Назовите другую сферу, чтобы продолжить.";
      r.state = initialState();
    }
    if (r.toolCalls.some((t) => t.name === "create_lead" && t.status === "ok")) r.text += " (Это публичное демо: заявка не сохраняется.)";
    return r;
  });
}

/** Проверка вопросами: 30 типовых вопросов сферы по черновику */
export async function runQuestionCheck() {
  return run(async () => {
    const s = await guard("edit_questionnaire");
    const { SPHERE_QUESTIONS } = await import("./sphere-questions");
    const snap = isDjango ? (await import("@all/dialog")).buildSnapshot(await (async () => { const q = await (await import("./data/repo")).getQuestionnaire(s); return { ...q, version: q.draft.version, services: q.services.map((x) => ({ ...x, staff: x.staffIds })) }; })()) : isSupabase ? await sbDraftSnapshot(await createServerSupabase(), s.companyId) : draftSnapshot();
    return (SPHERE_QUESTIONS[snap.company.sphere] ?? SPHERE_QUESTIONS.autoservice ?? []).map((q) => {
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
  if (isDjango) return djangoAction("updateAssistant", [patch]);
  return run(async () => {
    const s = await guard("publish");
    const p = assistantSchema.parse(patch);
    if (isSupabase) {
      const plan = await (await import("./data/sb/repo")).getCurrentPlan(s);
      if (p.mode && !plan.modes.includes(p.mode)) throw new UserError("Режим недоступен на вашем тарифе.");
      if (p.mode && (p.mode === "booking" || p.mode === "semi")) throw new UserError("Режим станет доступен в следующих обновлениях.");
      await sbm.updateAssistant(s, p);
      revalidatePath("/app/assistant");
      return;
    }
    const plan = db.plans.find((x) => x.key === db.usage.planKey)!;
    if (p.mode && !plan.modes.includes(p.mode)) throw new UserError("Режим недоступен на вашем тарифе.");
    if (p.mode && (p.mode === "booking" || p.mode === "semi")) throw new UserError("Режим станет доступен в следующих обновлениях.");
    Object.assign(db.assistant, p);
    audit(s, "update", "Ассистент", Object.keys(p).join(", "));
  });
}

export async function updateNumber(id: string, patch: { receive?: "always" | "no_answer" | "schedule"; noAnswerSeconds?: number }) {
  if (isDjango) return djangoAction("updateNumber", [id, patch]);
  return run(async () => {
    notInMvp();
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
  if (isDjango) return djangoAction<Member & { inviteUrl?: string }>("inviteMember", [input]);
  return run(async () => {
    notInMvp();
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
  if (isDjango) return djangoAction("updateMember", [id, patch]);
  return run(async () => {
    notInMvp();
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
  if (isDjango) return djangoAction<number>("disableMember", [id, reassignTo]);
  return run(async () => {
    notInMvp();
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
  if (isDjango) return djangoAction("setOverage", [policy, capMinor]);
  return run(async () => {
    notInMvp();
    const s = await guard("view_billing");
    if (s.member.role !== "owner") throw new Forbidden();
    db.usage.overagePolicy = z.enum(["pay", "stop_ai"]).parse(policy);
    db.usage.overageCapMinor = capMinor != null ? z.number().int().nonnegative().parse(capMinor) : 0;
    audit(s, "update", "Тариф", `Перерасход: ${policy}`);
  });
}

export async function buyMinutes(pack: 100 | 500 | 1000) {
  if (isDjango) return djangoAction<string>("buyMinutes", [pack]);
  return run(async () => {
    notInMvp();
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
  if (isDjango) return djangoAction("markNotificationsRead", [ids]);
  return run(async () => {
    const s = await requireSession();
    if (isSupabase) { await sbm.markNotificationsRead(s, ids ? z.array(z.string().uuid()).max(200).parse(ids) : undefined); return; }
    const now = new Date().toISOString();
    for (const n of db.notifications) if (!ids || ids.includes(n.id)) n.readAt ??= now;
  });
}

export async function setNotificationPref(userId: string, kind: string, channel: "app" | "telegram" | "email" | "push", on: boolean) {
  if (isDjango) return djangoAction("setNotificationPref", [userId, kind, channel, on]);
  return run(async () => {
    notInMvp();
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
  if (isDjango) return djangoAction("updateCompany", [patch]);
  return run(async () => {
    notInMvp();
    const s = await guard("manage_team");
    Object.assign(db.company, companySchema.parse(patch));
    audit(s, "update", "Компания", Object.keys(patch).join(", "));
    revalidatePath("/app", "layout");
  });
}

export async function setLocale(locale: "ru" | "ky") {
  const store = await cookies();
  // en временно скрыт: перевод не завершён
  const v = z.enum(["ru", "ky"]).safeParse(locale);
  if (!v.success) return;
  store.set("locale", v.data, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function createApiKey(name: string, scopes: string[]) {
  if (isDjango) return djangoAction<string>("createApiKey", [name, scopes]);
  return run(async () => {
    notInMvp();
    const s = await guard("export_delete");
    const key = `all_live_${rid()}${rid()}${rid()}`;
    db.apiKeys.unshift({ id: rid(), name: z.string().min(2).max(60).parse(name), prefix: key.slice(0, 12), scopes: z.array(z.string()).min(1).parse(scopes), createdAt: new Date().toISOString() });
    audit(s, "create", "API-ключ", name);
    return key; // показывается один раз
  });
}

export async function revokeApiKey(id: string) {
  if (isDjango) return djangoAction("revokeApiKey", [id]);
  return run(async () => {
    notInMvp();
    const s = await guard("export_delete");
    const k = db.apiKeys.find((x) => x.id === id);
    if (k) { k.revokedAt = new Date().toISOString(); audit(s, "revoke", "API-ключ", k.name); }
  });
}

export async function requestExport() {
  if (isDjango) return djangoAction<{ url: string }>("requestExport", []);
  return run(async () => {
    notInMvp();
    const s = await guard("export_delete");
    audit(s, "export", "Данные", "Полный экспорт поставлен в очередь");
  });
}

export async function eraseByPhone(phone: string) {
  if (isDjango) return djangoAction("eraseByPhone", [phone]);
  return run(async () => {
    notInMvp();
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
  if (isDjango) return djangoAction("retryIntegrationEvent", [key, logId]);
  return run(async () => {
    notInMvp();
    await guard("manage_integrations");
    const log = db.integrationLogs[key]?.find((x) => x.id === logId);
    if (!log) throw new UserError("Событие не найдено.");
    db.integrationLogs[key]!.unshift({ ...log, id: rid(), at: new Date().toISOString(), status: "ok", error: undefined, ms: 210 });
  });
}

export async function linkTelegram(memberId: string) {
  if (isDjango) return djangoAction<string>("linkTelegram", [memberId]);
  return run(async () => {
    notInMvp();
    await requireSession();
    const token = rid() + rid();
    return `https://t.me/all_manager_bot?start=${memberId}_${token}`;
  });
}

// ───────────── Вход ─────────────
const contactSchema = z.string().trim().min(5).max(120);
const MAX_ATTEMPTS = 5;
const LOCK_MS = 10 * 60_000;

/** Mock-вход по коду 000000 — только локальная разработка без Supabase (mockAuthAllowed) */
function mockOnly() {
  if (!mockAuthAllowed) throw new UserError("Вход по коду отключён. Войдите по email и паролю.");
}

export async function requestCode(contact: string) {
  return run(async () => {
    mockOnly();
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
    mockOnly();
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
    mockOnly();
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
  if (!mockAuthAllowed) return { ok: false as const, error: "Недоступно" };
  await startMockSession(z.string().parse(userId));
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function logout() {
  await endSession();
  revalidatePath("/", "layout");
}

const credentials = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200), otp: z.string().max(6).optional() });
/**
 * Вход по email и паролю через Supabase Auth. Сессия — в httpOnly-cookie @supabase/ssr, обновляется в proxy.ts.
 * После входа проверяется членство в компании: без него сессия сразу закрывается.
 */
export async function loginWithPassword(input: z.input<typeof credentials>): Promise<Result<{ next: string; mfaRequired?: boolean; setupSecret?: string }>> {
  return run(async () => {
    if (isDjango) {
      const r = await djangoFetch<{ token?: string; mfaRequired?: boolean; setupSecret?: string }>("/auth/login/", { method: "POST", body: JSON.stringify(credentials.parse(input)) });
      if (r.mfaRequired) return { next: "/login", mfaRequired: true, setupSecret: r.setupSecret };
      if (!r.token) throw new UserError("Не удалось войти.");
      (await cookies()).set(DJANGO_COOKIE, r.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 12 * 3600 });
      return { next: "/app" };
    }
    if (!isSupabase) throw new UserError("Вход по паролю работает с DATA_SOURCE=supabase.");
    const v = credentials.safeParse(input);
    if (!v.success) throw new UserError("Введите email и пароль.");
    const sb = await createServerSupabase();
    const { data, error } = await sb.auth.signInWithPassword(v.data);
    if (error || !data.user) {
      console.error(`[auth] sign-in failed status=${error?.status ?? "-"} code=${error?.code ?? "-"}`);
      if (error?.status === 429) throw new UserError("Слишком много попыток входа. Подождите минуту.");
      throw new UserError("Неверный email или пароль.");
    }
    const m = await sb.from("memberships").select("id").eq("user_id", data.user.id).is("disabled_at", null).limit(1);
    if (!m.data?.length) {
      await sb.auth.signOut();
      throw new UserError("У этого аккаунта нет доступа к компании. Обратитесь к собственнику.");
    }
    revalidatePath("/", "layout");
    return { next: "/app" };
  });
}

export async function acceptInvite(token: string) {
  return run(async () => {
    mockOnly();
    z.string().min(6).parse(token);
    const staff = db.members.find((m) => m.role === "staff")!;
    await startMockSession(staff.userId);
    return { next: "/app" };
  });
}

/** Вход поддержки в кабинет клиента — по согласию в тикете, с аудитом */
export async function supportLogin(companyId: string, ticket: string) {
  return run(async () => {
    mockOnly();
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
