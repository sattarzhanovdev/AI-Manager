import "server-only";
import { hourInTz, dayKeyInTz } from "../format";
import type { Session } from "../auth";
import { seesOnlyOwn } from "../permissions";
import { db, callDetail, contactTimeline, questionnaireState, usage, ensureSimulator } from "./mock/store";

/**
 * Запросы кабинета. Источник — mock-хранилище (DATA_SOURCE=mock).
 * В режиме supabase те же функции реализует ./supabase-repo с RLS по JWT пользователя.
 * Правила видимости повторяют RLS: сотрудник видит свои и свободные заявки и звонки по ним.
 */

const visibleLeads = (s: Session) => (seesOnlyOwn(s.member.role) ? db.leads.filter((l) => !l.assigneeId || l.assigneeId === s.userId) : db.leads);

export function getCompany() { return db.company; }
export function getMembers() { return db.members; }
export function getBranches() { return db.branches; }
export function getNumbers() { return db.numbers; }

export function listCalls(s: Session) {
  ensureSimulator();
  if (seesOnlyOwn(s.member.role)) {
    const own = new Set(visibleLeads(s).map((l) => l.sourceId));
    return db.calls.filter((c) => own.has(c.id));
  }
  return db.calls;
}
export function getCall(s: Session, id: string) {
  if (!listCalls(s).some((c) => c.id === id)) return null;
  return callDetail(id);
}

export function listLeads(s: Session) { ensureSimulator(); return visibleLeads(s); }
export function getLead(s: Session, id: string) {
  const lead = visibleLeads(s).find((l) => l.id === id);
  if (!lead) return null;
  const events = db.leadEvents.filter((e) => e.leadId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const call = lead.sourceId ? callDetail(lead.sourceId) : null;
  const history = lead.contactId ? contactTimeline(lead.contactId).filter((i) => i.id !== lead.id).slice(0, 6) : [];
  return { lead, events, call, history };
}

export function listContacts() { return db.contacts; }
export function getContact(id: string) {
  const c = db.contacts.find((x) => x.id === id);
  if (!c) return null;
  return { contact: c, timeline: contactTimeline(id), leads: db.leads.filter((l) => l.contactId === id) };
}

export function getQuestionnaire() { return questionnaireState(); }
export function getAssistant() { return db.assistant; }
export function getUsage() { return usage(); }
export function getPlans() { return db.plans; }
export function getCurrentPlan() { return db.plans.find((p) => p.key === db.usage.planKey)!; }
export function getInvoices() { return db.invoices; }
export function getIntegrations() { return db.integrations; }
export function getIntegrationLogs(key: string) { return db.integrationLogs[key] ?? []; }
export function getNotifications() { return db.notifications; }
export function getNotificationPrefs() { return db.notificationPrefs; }
export function getApiKeys() { return db.apiKeys; }
export function getAudit() { return db.audit; }

/** Обзор: KPI, «Требует внимания», звонки по часам, состояние */
export function getOverview(s: Session) {
  const tz = db.company.timezone;
  const today = dayKeyInTz(new Date().toISOString(), tz);
  const yesterday = dayKeyInTz(new Date(Date.now() - 86400_000).toISOString(), tz);
  const calls = listCalls(s);
  const todayCalls = calls.filter((c) => dayKeyInTz(c.startedAt, tz) === today);
  const yCalls = calls.filter((c) => dayKeyInTz(c.startedAt, tz) === yesterday);
  const byHour = (list: typeof calls) => Array.from({ length: 24 }, (_, h) => list.filter((c) => hourInTz(c.startedAt, tz) === h).length);
  const answered = todayCalls.filter((c) => c.outcome !== "missed").length;
  const missed = todayCalls.filter((c) => c.outcome === "missed");
  const leads = visibleLeads(s);
  const newLeads = leads.filter((l) => l.status === "new" && !l.assigneeId);
  const q = questionnaireState();
  const u = usage();
  const now = Date.now();

  type Attention = { id: string; kind: "complaint" | "urgent" | "sla" | "missed" | "unanswered" | "integration"; title: string; subtitle: string; at: string; href: string; leadId?: string; callId?: string; phone?: string };
  const attention: Attention[] = [];
  for (const l of leads.filter((x) => x.status !== "won" && x.status !== "lost")) {
    if (l.type === "complaint") attention.push({ id: `a_${l.id}`, kind: "complaint", title: l.title, subtitle: l.contactName ?? l.contactPhone ?? "", at: l.createdAt, href: `/app/leads?open=${l.id}`, leadId: l.id });
    else if (l.priority === "urgent") attention.push({ id: `a_${l.id}`, kind: "urgent", title: l.title, subtitle: l.contactName ?? l.contactPhone ?? "", at: l.createdAt, href: `/app/leads?open=${l.id}`, leadId: l.id });
    else if (!l.assigneeId && l.dueAt && new Date(l.dueAt).getTime() < now && now - new Date(l.createdAt).getTime() < 3 * 86400_000) attention.push({ id: `a_${l.id}`, kind: "sla", title: l.title, subtitle: l.contactName ?? l.contactPhone ?? "", at: l.dueAt, href: `/app/leads?open=${l.id}`, leadId: l.id });
  }
  for (const c of calls.filter((x) => x.outcome === "missed" && !x.callbackDoneAt).slice(0, 6)) {
    attention.push({ id: `a_${c.id}`, kind: "missed", title: c.contactName ?? c.caller, subtitle: "", at: c.startedAt, href: `/app/calls?open=${c.id}`, callId: c.id, phone: c.caller });
  }
  for (const uq of q.unanswered.slice(0, 3)) attention.push({ id: `a_${uq.id}`, kind: "unanswered", title: uq.text, subtitle: String(uq.count), at: uq.lastSeenAt, href: `/app/knowledge?unanswered=${uq.id}` });
  for (const i of db.integrations.filter((x) => x.status === "error" || x.status === "reconnect")) attention.push({ id: `a_${i.key}`, kind: "integration", title: i.key, subtitle: "", at: i.lastSyncAt ?? new Date().toISOString(), href: `/app/integrations?open=${i.key}` });
  const integrationErrors = (db.integrationLogs.telegram_notify ?? []).filter((x) => x.status === "error" && now - new Date(x.at).getTime() < 86400_000);
  if (integrationErrors.length) attention.push({ id: "a_tg", kind: "integration", title: "telegram_notify", subtitle: integrationErrors[0]!.error ?? "", at: integrationErrors[0]!.at, href: "/app/integrations?open=telegram_notify" });
  const order = { complaint: 0, urgent: 1, sla: 2, missed: 3, integration: 4, unanswered: 5 } as const;
  attention.sort((a, b) => order[a.kind] - order[b.kind] || b.at.localeCompare(a.at));
  // не больше нескольких строк одного вида — лента должна показывать всю картину
  const cap = { complaint: 4, urgent: 3, sla: 4, missed: 3, integration: 2, unanswered: 3 } as const;
  const seen: Record<string, number> = {};
  const capped = attention.filter((a) => (seen[a.kind] = (seen[a.kind] ?? 0) + 1) <= cap[a.kind]);

  const firstWeek = calls.length < 10;
  return {
    kpi: {
      callsToday: todayCalls.length, callsYesterday: yCalls.length, callsSpark: byHour(todayCalls).slice(8, 22),
      answeredPct: todayCalls.length ? Math.round((answered / todayCalls.length) * 100) : 100,
      newLeads: newLeads.length, missed: missed.length, missedReason: missed.length ? "линии заняты" : "",
      minutesLeft: Math.max(0, u.minutesTotal - u.minutesUsed), minutesForecast: u.forecast, minutesTotal: u.minutesTotal,
      kbIndex: q.draft.completeness, unanswered: q.unanswered.length,
    },
    attention: capped,
    hours: { today: byHour(todayCalls), yesterday: byHour(yCalls) },
    status: {
      aiMode: db.company.aiMode, linesBusy: u.linesBusy, linesTotal: u.linesTotal, numbers: db.numbers,
      integrations: db.integrations.filter((i) => i.status === "connected" || i.status === "error"),
      lastPublish: q.published,
    },
    firstWeek,
  };
}

/** Аналитика фазы 1а: воронка, нагрузка, передачи человеку */
export function getAnalytics(s: Session, days = 30) {
  const tz = db.company.timezone;
  const since = Date.now() - days * 86400_000;
  const calls = listCalls(s).filter((c) => new Date(c.startedAt).getTime() >= since);
  const target = calls.filter((c) => c.type && c.type !== "spam" && c.type !== "irrelevant");
  const leadsAll = db.leads.filter((l) => new Date(l.createdAt).getTime() >= since);
  const won = leadsAll.filter((l) => l.status === "won");
  const heat: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const c of calls) {
    const d = new Date(new Date(c.startedAt).toLocaleString("en-US", { timeZone: tz }));
    const row = heat[(d.getDay() + 6) % 7]!;
    row[d.getHours()] = (row[d.getHours()] ?? 0) + 1;
  }
  const transfers = calls.filter((c) => c.transferred);
  const reasons: Record<string, number> = {};
  for (const c of transfers) {
    const k = c.type === "complaint" ? "complaint" : c.type === "booking" ? "client_request" : "not_understood";
    reasons[k] = (reasons[k] ?? 0) + 1;
  }
  const byDay: { day: string; calls: number; leads: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKeyInTz(new Date(Date.now() - i * 86400_000).toISOString(), tz);
    byDay.push({ day: key, calls: calls.filter((c) => dayKeyInTz(c.startedAt, tz) === key).length, leads: leadsAll.filter((l) => dayKeyInTz(l.createdAt, tz) === key).length });
  }
  return {
    funnel: [
      { key: "calls", value: calls.length }, { key: "target", value: target.length },
      { key: "leads", value: leadsAll.length }, { key: "won", value: won.length },
    ],
    heat, byDay,
    transfers: { total: transfers.length, share: calls.length ? transfers.length / calls.length : 0, answered: Math.round(transfers.length * 0.86), reasons },
  };
}

export const admin = {
  companies: () => db.adminCompanies,
  demoLeads: () => db.demoLeads,
  demoCalls: () => db.demoCalls,
  moderation: () => db.moderation,
};

// ───────────── Чаты (фаза 1б) ─────────────
const visibleConversations = (s: Session) =>
  (seesOnlyOwn(s.member.role) ? db.conversations.filter((c) => !c.assigneeId || c.assigneeId === s.userId) : db.conversations);

export function listConversations(s: Session) {
  ensureSimulator();
  void import("./mock/chat").then((m) => m.ensureChatSimulator());
  return [...visibleConversations(s)].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

export function getConversation(s: Session, id: string) {
  const conversation = visibleConversations(s).find((c) => c.id === id);
  if (!conversation) return null;
  const messages = db.messages.filter((m) => m.conversationId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const contact = conversation.contactId ? db.contacts.find((c) => c.id === conversation.contactId) : undefined;
  const timeline = conversation.contactId ? contactTimeline(conversation.contactId).slice(0, 8) : [];
  const leads = conversation.contactId ? db.leads.filter((l) => l.contactId === conversation.contactId).slice(0, 5) : [];
  const otherChats = db.conversations.filter((c) => c.contactId && c.contactId === conversation.contactId && c.id !== id);
  return { conversation, messages, contact, timeline, leads, otherChats, quickReplies: db.quickReplies, templates: db.templates };
}

// ───────────── Календарь (фаза 1б) ─────────────
export function getCalendar() {
  return {
    resources: db.resources,
    appointments: db.appointments.filter((a) => a.status !== "cancelled"),
    services: db.services.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, durationMin: x.durationMin ?? 60 })),
    tickets: db.tickets,
    waitlist: db.waitlist.filter((w) => w.status === "waiting" || w.status === "offered").sort((a, b) => a.scope.localeCompare(b.scope) || a.position - b.position),
    branches: db.branches.map((b) => ({ id: b.id, name: b.name, hours: b.hours })),
  };
}
