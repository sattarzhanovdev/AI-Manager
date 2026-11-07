import "server-only";
import { buildSnapshot, completeness, type KbSnapshot } from "@all/dialog";
import type { AiMode, Call, CallDetail, Lead, LeadEvent, LeadStatus, Usage } from "@all/db";
import type {
  AssistantSettings, ContactTimelineItem, QuestionnaireState, RealtimeEvent,
} from "../types";
import * as seed from "./seed";
import * as seed1b from "./seed-1b";

/**
 * In-memory хранилище для DATA_SOURCE=mock. Живёт в globalThis, чтобы переживать HMR.
 * Повторяет семантику базы: версии анкеты, неизменяемость опубликованного, аудит, события Realtime.
 */
interface PublishedVersion { version: number; publishedAt: string; snapshot: KbSnapshot; fields: typeof seed.questionnaireFields }

function create() {
  const fields = structuredClone(seed.questionnaireFields);
  const counts = { services: seed.services.length, staff: seed.staff.length, faq: seed.faq.length };
  const firstSnapshot = snapshotFrom(fields, 12);
  const published: PublishedVersion[] = [
    { version: 11, publishedAt: new Date(Date.now() - 30 * 86400_000).toISOString(), snapshot: firstSnapshot, fields: structuredClone(fields) },
    { version: 12, publishedAt: new Date(Date.now() - 12 * 86400_000).toISOString(), snapshot: firstSnapshot, fields: structuredClone(fields) },
  ];
  // черновик отличается от публикации двумя изменениями
  fields["booking.prepay"] = "Не требуется";
  fields["company.advantages"] = `${String(fields["company.advantages"])}\nБесплатная диагностика ходовой при ремонте`;

  return {
    company: structuredClone(seed.company),
    members: structuredClone(seed.members),
    branches: structuredClone(seed.branches),
    numbers: structuredClone(seed.numbers),
    contacts: structuredClone(seed.contacts),
    calls: structuredClone(seed.calls),
    callTurns: seed.callTurns,
    leads: structuredClone(seed.leads),
    leadEvents: structuredClone(seed.leadEvents),
    fields,
    fieldSources: { ...seed.fieldSources },
    draftVersion: 13,
    published,
    services: structuredClone(seed.services),
    staff: structuredClone(seed.staff),
    faq: structuredClone(seed.faq),
    unanswered: structuredClone(seed.unanswered),
    counts,
    integrations: structuredClone(seed.integrations),
    integrationLogs: structuredClone(seed.integrationLogs),
    notifications: structuredClone(seed.notifications),
    plans: seed.plans,
    invoices: seed.invoices,
    usage: { ...seed.usage },
    assistant: structuredClone(seed.assistant) as AssistantSettings,
    notificationPrefs: structuredClone(seed.notificationPrefs),
    apiKeys: structuredClone(seed.apiKeys),
    audit: structuredClone(seed.audit),
    adminCompanies: structuredClone(seed.adminCompanies),
    demoLeads: structuredClone(seed.demoLeads),
    demoCalls: structuredClone(seed.demoCalls),
    moderation: structuredClone(seed.moderation),
    conversations: structuredClone(seed1b.conversations),
    messages: structuredClone(seed1b.messages),
    quickReplies: seed1b.quickReplies,
    templates: seed1b.templates,
    resources: structuredClone(seed1b.resources),
    appointments: structuredClone(seed1b.appointments),
    tickets: structuredClone(seed1b.tickets),
    waitlist: structuredClone(seed1b.waitlist),
    chatTimers: new Map<string, ReturnType<typeof setTimeout>>(),
    chatStates: new Map<string, import("@all/dialog").DialogState>(),
    chatSimulator: null as ReturnType<typeof setInterval> | null,
    listeners: new Set<(e: RealtimeEvent) => void>(),
    otp: new Map<string, { code: string; attempts: number; lockedUntil?: number; sentAt: number }>(),
    simulator: null as ReturnType<typeof setInterval> | null,
  };
}

function snapshotFrom(fields: typeof seed.questionnaireFields, version: number, services = seed.services, staff = seed.staff, faq = seed.faq): KbSnapshot {
  return buildSnapshot({
    version,
    fields,
    branches: seed.branches.map((b) => ({ id: b.id, name: b.name, address: b.address, landmarks: b.landmarks, hours: b.hours, phones: b.phones })),
    services: services.filter((s) => s.active).map((s) => ({
      id: s.id, name: s.name, synonyms: s.synonyms, priceType: s.priceType, priceMin: s.priceMin, priceMax: s.priceMax,
      currency: s.currency, durationMin: s.durationMin, staff: s.staffIds.map((id) => staff.find((x) => x.id === id)?.name ?? ""),
    })),
    staff: staff.map((s) => ({ id: s.id, name: s.name, specialties: s.specialties, transferPhone: s.transferPhone })),
    faq: faq.filter((f) => f.active).map((f) => ({ id: f.id, question: f.question, synonyms: f.synonyms, shortAnswer: f.shortAnswer, longAnswer: f.longAnswer })),
  });
}

type Store = ReturnType<typeof create>;
const g = globalThis as unknown as { __allStore?: Store };
export const db: Store = (g.__allStore ??= create());
// После обновления кода во время `next dev` добавляем в живое хранилище новые разделы, не теряя старые данные
if (!("conversations" in db)) {
  const fresh = create() as Record<string, unknown>;
  for (const [k, v] of Object.entries(fresh)) if (!(k in db)) (db as unknown as Record<string, unknown>)[k] = v;
}

export function emit(e: RealtimeEvent) {
  for (const l of db.listeners) l(e);
}

export function draftSnapshot(): KbSnapshot {
  return snapshotFrom(db.fields, db.draftVersion, db.services, db.staff, db.faq);
}
export function publishedSnapshot(): KbSnapshot {
  return db.published.at(-1)!.snapshot;
}
export function newPublishedSnapshot(version: number): KbSnapshot {
  return snapshotFrom(db.fields, version, db.services, db.staff, db.faq);
}

export function questionnaireState(): QuestionnaireState {
  const counts = { services: db.services.filter((s) => s.active).length, staff: db.staff.length, faq: db.faq.filter((f) => f.active).length };
  const last = db.published.at(-1);
  const changed = last
    ? Object.keys({ ...db.fields, ...last.fields }).filter((k) => JSON.stringify(db.fields[k]) !== JSON.stringify(last.fields[k]))
    : Object.keys(db.fields);
  return {
    draft: { version: db.draftVersion, status: "draft", completeness: completeness(db.fields, counts) },
    published: last ? { version: last.version, status: "published", publishedAt: last.publishedAt, completeness: completeness(last.fields, counts) } : undefined,
    versions: [...db.published].reverse().map((p) => ({ version: p.version, status: p === last ? "published" : "archived", publishedAt: p.publishedAt, completeness: completeness(p.fields, counts) })),
    fields: db.fields,
    fieldSources: db.fieldSources,
    changedSincePublish: changed,
    services: db.services,
    staff: db.staff,
    faq: db.faq,
    unanswered: db.unanswered.filter((u) => !u.resolved).sort((a, b) => b.count - a.count),
    branches: db.branches,
  };
}

export function callDetail(id: string): CallDetail | null {
  const c = db.calls.find((x) => x.id === id);
  if (!c) return null;
  const turns = db.callTurns.get(id) ?? [];
  const leadIds = db.leads.filter((l) => l.sourceId === id).map((l) => l.id);
  const toolCalls: CallDetail["toolCalls"] = [];
  const firstCaller = turns.find((t) => t.speaker === "caller");
  if (firstCaller) toolCalls.push({ atMs: firstCaller.endMs + 120, name: "search_kb", arguments: { query: firstCaller.text.slice(0, 60) }, result: { hits: 2, top: "Услуги и цены" }, status: "ok" });
  if (c.type === "consultation") toolCalls.push({ atMs: (turns[2]?.startMs ?? 4000) - 300, name: "get_service", arguments: { name: "по запросу" }, result: { priceType: "exact" }, status: "ok" });
  if (leadIds.length) toolCalls.push({ atMs: (turns.at(-2)?.startMs ?? 9000), name: "create_lead", arguments: { type: c.type ?? "callback" }, result: { id: leadIds[0] }, status: "ok" });
  if (c.transferred) toolCalls.push({ atMs: (turns[1]?.endMs ?? 5000) + 200, name: "transfer_to_human", arguments: { reason: c.type === "complaint" ? "complaint" : "client_request", target: "Айжан" }, result: { answered: true, wait_ms: 7400 }, status: "ok" });
  if (c.type === "spam" || c.type === "irrelevant") toolCalls.push({ atMs: turns.at(-1)?.endMs ?? 3000, name: "end_call", arguments: { outcome: "no_result" }, status: "ok" });
  toolCalls.sort((a, b) => a.atMs - b.atMs);
  return { ...c, turns, toolCalls, leadIds };
}

export function contactTimeline(id: string): ContactTimelineItem[] {
  const items: ContactTimelineItem[] = [];
  for (const c of db.calls.filter((x) => x.contactId === id)) items.push({ kind: "call", id: c.id, at: c.startedAt, title: c.summary ?? "Звонок", subtitle: c.outcome, href: `/app/calls?open=${c.id}` });
  for (const l of db.leads.filter((x) => x.contactId === id)) items.push({ kind: "lead", id: l.id, at: l.createdAt, title: `#${l.number} ${l.title}`, subtitle: l.status, href: `/app/leads?open=${l.id}` });
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export function usage(): Usage & { forecast: number } {
  const start = new Date(db.usage.periodStart).getTime();
  const end = new Date(db.usage.periodEnd).getTime();
  // база периода + минуты живых звонков (симулятор)
  const used = 1236 + Math.round(db.calls.filter((c) => c.id.startsWith("cl_live")).reduce((s, c) => s + c.billedSeconds, 0) / 60);
  const elapsed = Math.max(1, Date.now() - start);
  const forecast = Math.round((used / elapsed) * (end - start));
  return {
    minutesUsed: used, minutesTotal: db.usage.minutesTotal + db.usage.extraMinutes, dialogsUsed: db.usage.dialogsUsed, dialogsTotal: db.usage.dialogsTotal,
    linesBusy: 1, linesTotal: db.usage.linesTotal, periodStart: db.usage.periodStart, periodEnd: db.usage.periodEnd,
    overagePolicy: db.usage.overagePolicy, overageCapMinor: db.usage.overageCapMinor, forecast,
  };
}

export function addLeadEvent(e: Omit<LeadEvent, "id" | "createdAt">) {
  db.leadEvents.push({ ...e, id: `ev_${Math.random().toString(36).slice(2, 9)}`, createdAt: new Date().toISOString() });
}

export function setAiModeInternal(mode: AiMode) {
  db.company.aiMode = mode;
  emit({ type: "company.ai_mode", mode });
}

export function patchLead(id: string, patch: Partial<Lead>, actorId: string): Lead | null {
  const l = db.leads.find((x) => x.id === id);
  if (!l) return null;
  const before = { ...l };
  Object.assign(l, patch, { updatedAt: new Date().toISOString() });
  if (patch.status && patch.status !== before.status) {
    addLeadEvent({ leadId: id, actorId, actorKind: "user", action: "status", before: before.status, after: patch.status, comment: patch.lostReason });
    if (patch.status === "won" || patch.status === "lost") l.closedAt = new Date().toISOString();
  }
  if ("assigneeId" in patch && patch.assigneeId !== before.assigneeId) addLeadEvent({ leadId: id, actorId, actorKind: "user", action: "assignee", before: before.assigneeId, after: patch.assigneeId });
  if (patch.tags) addLeadEvent({ leadId: id, actorId, actorKind: "user", action: "tag", before: before.tags, after: patch.tags });
  if (patch.payload) addLeadEvent({ leadId: id, actorId, actorKind: "user", action: "field", before: before.payload, after: patch.payload });
  emit({ type: "lead.updated", lead: l });
  return l;
}

/** Симулятор входящих звонков для демо-режима: новый звонок каждые ~40 с */
export function ensureSimulator() {
  if (db.simulator || process.env.MOCK_SIMULATOR === "off") return;
  let n = 0;
  db.simulator = setInterval(() => {
    if (db.listeners.size === 0) return;
    n++;
    const contact = db.contacts[Math.floor(Math.random() * db.contacts.length)]!;
    const svc = db.services[Math.floor(Math.random() * 6)]!;
    const now = new Date();
    const durationS = 60 + Math.floor(Math.random() * 180);
    const call: Call = {
      id: `cl_live_${Date.now().toString(36)}`, numberId: "num_1", branchId: "br_1", caller: contact.phone!, contactId: contact.id, contactName: contact.name,
      isNewCaller: false, startedAt: new Date(now.getTime() - durationS * 1000).toISOString(), endedAt: now.toISOString(), durationS, billedSeconds: Math.ceil(durationS / 60) * 60,
      type: "booking", outcome: "lead_created", summary: `Клиент записался на ${svc.name.toLowerCase()} на завтра в 10:00. Заявка создана.`,
      flags: [], transferred: false, kbVersion: db.published.at(-1)!.version, costMinor: durationS,
    };
    db.calls.unshift(call);
    db.callTurns.set(call.id, [
      { seq: 0, speaker: "ai", startMs: 300, endMs: 3500, text: "Здравствуйте! Автосервис «Мотор», я Айгуль, виртуальный помощник. Чем помочь?", interrupted: false, latencyMs: 520 },
      { seq: 1, speaker: "caller", startMs: 4100, endMs: 7000, text: `Хочу записаться на ${svc.name.toLowerCase()} на завтра.`, interrupted: false },
      { seq: 2, speaker: "ai", startMs: 7600, endMs: 10500, text: "Хорошо. Во сколько вам удобно?", interrupted: false, latencyMs: 610 },
      { seq: 3, speaker: "caller", startMs: 11000, endMs: 12600, text: "В десять утра.", interrupted: false },
      { seq: 4, speaker: "ai", startMs: 13100, endMs: 17800, text: `Записала: ${svc.name.toLowerCase()}, завтра в 10:00. Администратор подтвердит по этому номеру.`, interrupted: false, latencyMs: 690 },
    ]);
    emit({ type: "call.created", call });
    if (n % 2 === 1) {
      const max = db.leads.reduce((m, l) => Math.max(m, l.number), 0);
      const lead: Lead = {
        id: `ld_${max + 1}`, number: max + 1, source: "call", sourceId: call.id, channel: "phone", type: "booking", title: `${svc.name}, завтра 10:00`,
        status: "new" as LeadStatus, priority: "normal", tags: [], contactId: contact.id, contactName: contact.name, contactPhone: contact.phone, branchId: "br_1",
        dueAt: new Date(now.getTime() + 2 * 3600_000).toISOString(), payload: { service: svc.name, preferred_time: "завтра 10:00", branch: "Ахунбаева" },
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
      };
      db.leads.unshift(lead);
      addLeadEvent({ leadId: lead.id, actorKind: "ai", action: "created" });
      emit({ type: "lead.created", lead });
      const nt = { id: `nt_${Date.now()}`, kind: "lead_new" as const, title: `Новая заявка: ${lead.title}`, href: `/app/leads?open=${lead.id}`, createdAt: now.toISOString() };
      db.notifications.unshift(nt);
      emit({ type: "notification", notification: nt });
    }
  }, 40_000);
}
