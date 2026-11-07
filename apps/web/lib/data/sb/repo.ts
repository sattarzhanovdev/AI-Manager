import "server-only";
import { cache } from "react";
import type { CallDetail, Lead, Member, Plan } from "@all/db";
import { dayKeyInTz, hourInTz } from "../../format";
import type { Session } from "../../auth";
import { createServerSupabase } from "../../supabase/server";
import type { AssistantSettings, ContactTimelineItem } from "../types";
import {
  CALL_COLS, CONTACT_COLS, DEFAULT_ASSISTANT, LEAD_COLS, toBranch, toCall, toCompany, toContact, toLead, toLeadEvent, toNotification, toNumber, toTurn,
} from "./map";
import { questionnaireState } from "./kb";

/**
 * Чтение кабинета из Supabase под JWT пользователя: RLS сама ограничивает компанию и роль
 * (сотрудник видит свободные и свои заявки). Явный фильтр company_id — для выбора активной компании.
 */
export class RepoError extends Error {}
function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new RepoError(r.error.message);
  return r.data;
}

const client = cache(() => createServerSupabase());

export const getCompany = cache(async (s: Session) => {
  const sb = await client();
  return toCompany(check(await sb.from("companies").select("*").eq("id", s.companyId).single())!);
});

export const getMembers = cache(async (s: Session): Promise<Member[]> => {
  const sb = await client();
  const rows = check(await sb.from("memberships").select("id, user_id, role, permissions, branch_ids, transfer_phone, disabled_at").eq("company_id", s.companyId).order("created_at")) ?? [];
  const ids = rows.map((r) => r.user_id as string);
  const profiles = ids.length ? check(await sb.from("profiles").select("id, full_name, email, phone").in("id", ids)) ?? [] : [];
  return rows.map((r) => {
    const p = profiles.find((x) => x.id === r.user_id);
    return {
      id: String(r.id), userId: String(r.user_id), name: p?.full_name ?? p?.email ?? "—", email: p?.email ?? undefined, phone: p?.phone ?? undefined,
      role: r.role as Member["role"], permissions: (r.permissions ?? {}) as Member["permissions"], branchIds: (r.branch_ids as string[]) ?? [],
      transferPhone: (r.transfer_phone as string | null) ?? undefined, telegramLinked: false, disabledAt: (r.disabled_at as string | null) ?? undefined,
    };
  });
});

export const getBranches = cache(async (s: Session) => {
  const sb = await client();
  return (check(await sb.from("branches").select("*").eq("company_id", s.companyId).order("created_at")) ?? []).map(toBranch);
});

export const getNumbers = cache(async (s: Session) => {
  const sb = await client();
  return (check(await sb.from("phone_numbers").select("*").eq("company_id", s.companyId)) ?? []).map(toNumber);
});

export const listCalls = cache(async (s: Session) => {
  const sb = await client();
  return (check(await sb.from("calls").select(CALL_COLS).eq("company_id", s.companyId).order("started_at", { ascending: false }).limit(500)) ?? []).map(toCall);
});

export async function getCall(s: Session, id: string): Promise<CallDetail | null> {
  const sb = await client();
  const row = check(await sb.from("calls").select(CALL_COLS).eq("company_id", s.companyId).eq("id", id).maybeSingle());
  if (!row) return null;
  const [turns, tools, leads] = await Promise.all([
    sb.from("call_turns").select("*").eq("call_id", id).order("seq"),
    sb.from("call_tool_calls").select("*").eq("call_id", id).order("at_ms"),
    sb.from("leads").select("id").eq("source", "call").eq("source_id", id),
  ]);
  return {
    ...toCall(row),
    turns: (check(turns) ?? []).map(toTurn),
    toolCalls: (check(tools) ?? []).map((t) => ({ atMs: Number(t.at_ms), name: String(t.name), arguments: (t.arguments ?? {}) as Record<string, unknown>, result: t.result ?? undefined, status: t.status as "ok" })),
    leadIds: (check(leads) ?? []).map((l) => String(l.id)),
  };
}

export const listLeads = cache(async (s: Session): Promise<Lead[]> => {
  const sb = await client();
  return (check(await sb.from("leads").select(LEAD_COLS).eq("company_id", s.companyId).order("created_at", { ascending: false }).limit(500)) ?? []).map(toLead);
});

async function contactTimeline(s: Session, contactId: string): Promise<ContactTimelineItem[]> {
  const sb = await client();
  const [calls, leads] = await Promise.all([
    sb.from("calls").select("id, started_at, summary, outcome").eq("company_id", s.companyId).eq("contact_id", contactId).order("started_at", { ascending: false }).limit(20),
    sb.from("leads").select("id, number, title, status, created_at").eq("company_id", s.companyId).eq("contact_id", contactId).order("created_at", { ascending: false }).limit(20),
  ]);
  const items: ContactTimelineItem[] = [];
  for (const c of check(calls) ?? []) items.push({ kind: "call", id: String(c.id), at: String(c.started_at), title: c.summary ? String(c.summary) : "Звонок", subtitle: c.outcome ? String(c.outcome) : undefined, href: `/app/calls?open=${c.id}` });
  for (const l of check(leads) ?? []) items.push({ kind: "lead", id: String(l.id), at: String(l.created_at), title: `#${l.number} ${l.title}`, subtitle: String(l.status), href: `/app/leads?open=${l.id}` });
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export interface DialogMessage { id: string; author: "client" | "ai" | "operator" | "system"; body: string; createdAt: string }

export async function getLead(s: Session, id: string) {
  const sb = await client();
  const row = check(await sb.from("leads").select(LEAD_COLS).eq("company_id", s.companyId).eq("id", id).maybeSingle());
  if (!row) return null;
  const lead = toLead(row);
  const [events, call, history, dialog] = await Promise.all([
    sb.from("lead_events").select("*").eq("lead_id", id).order("created_at"),
    lead.source === "call" && lead.sourceId ? getCall(s, lead.sourceId) : Promise.resolve(null),
    lead.contactId ? contactTimeline(s, lead.contactId) : Promise.resolve([]),
    lead.source === "chat" && lead.sourceId
      ? sb.from("messages").select("id, author, body, created_at").eq("conversation_id", lead.sourceId).order("created_at").limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);
  return {
    lead,
    events: (check(events) ?? []).map(toLeadEvent),
    call,
    history: history.filter((i) => i.id !== lead.id).slice(0, 6),
    dialog: (check(dialog) ?? []).map((m) => ({ id: String(m.id), author: m.author as DialogMessage["author"], body: String(m.body ?? ""), createdAt: String(m.created_at) })),
  };
}

export const listContacts = cache(async (s: Session) => {
  const sb = await client();
  return (check(await sb.from("contacts").select(CONTACT_COLS).eq("company_id", s.companyId).order("last_seen_at", { ascending: false }).limit(1000)) ?? []).map(toContact);
});

export async function getContact(s: Session, id: string) {
  const sb = await client();
  const row = check(await sb.from("contacts").select(CONTACT_COLS).eq("company_id", s.companyId).eq("id", id).maybeSingle());
  if (!row) return null;
  const [timeline, leads] = await Promise.all([
    contactTimeline(s, id),
    sb.from("leads").select(LEAD_COLS).eq("company_id", s.companyId).eq("contact_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  return { contact: toContact(row), timeline, leads: (check(leads) ?? []).map(toLead) };
}

export const getQuestionnaire = cache(async (s: Session) => questionnaireState(await client(), s.companyId));

export const getAssistant = cache(async (s: Session): Promise<AssistantSettings> => {
  const sb = await client();
  const row = check(await sb.from("assistant_settings").select("settings").eq("company_id", s.companyId).maybeSingle());
  return { ...DEFAULT_ASSISTANT, ...((row?.settings ?? {}) as Partial<AssistantSettings>) };
});

const PLAN_FALLBACK: Plan = { key: "business", name: "Демо", priceMinor: 0, currency: "KGS", minutes: 0, aiDialogs: 0, lines: 0, modes: ["leads", "consult"] };

/** Тариф компании: подписка → версия тарифа. Биллинг в MVP не подключён — только для доступных режимов ассистента. */
export const getCurrentPlan = cache(async (s: Session): Promise<Plan> => {
  const sb = await client();
  const sub = check(await sb.from("subscriptions").select("plan_version_id, currency").eq("company_id", s.companyId).neq("status", "cancelled").order("period_start", { ascending: false }).limit(1).maybeSingle());
  if (!sub) return PLAN_FALLBACK;
  const pv = check(await sb.from("plan_versions").select("limits, prices, plans(key, name)").eq("id", sub.plan_version_id).maybeSingle());
  if (!pv) return PLAN_FALLBACK;
  const limits = pv.limits as { minutes: number; ai_dialogs: number; lines: number; modes: Plan["modes"] };
  const plan = pv.plans as unknown as { key: Plan["key"]; name: string } | null;
  const price = (pv.prices as Record<string, { amount_minor: number }>)[String(sub.currency)];
  return { key: plan?.key ?? "business", name: plan?.name ?? "—", priceMinor: price?.amount_minor ?? 0, currency: sub.currency as Plan["currency"], minutes: limits.minutes, aiDialogs: limits.ai_dialogs, lines: limits.lines, modes: limits.modes };
});

export const getNotifications = cache(async (s: Session) => {
  const sb = await client();
  return (check(await sb.from("notifications").select("*").eq("company_id", s.companyId).eq("user_id", s.userId).order("created_at", { ascending: false }).limit(50)) ?? []).map(toNotification);
});

/** Последние действия по заявкам — для «Обзора» */
export async function recentLeadEvents(s: Session, limit = 12) {
  const sb = await client();
  const rows = check(await sb.from("lead_events").select("id, lead_id, actor_id, actor_kind, action, comment, before, after, created_at, leads!inner(number, title)").eq("company_id", s.companyId).order("created_at", { ascending: false }).limit(limit)) ?? [];
  return rows.map((r) => {
    const l = r.leads as unknown as { number: number; title: string };
    return { ...toLeadEvent(r), leadNumber: Number(l.number), leadTitle: String(l.title) };
  });
}
export type RecentEvent = Awaited<ReturnType<typeof recentLeadEvents>>[number];

/** Обзор по реальным данным: заявки, звонки, база знаний. Ничего не генерируется. */
export async function getOverview(s: Session) {
  const [company, calls, leads, q, recent] = await Promise.all([getCompany(s), listCalls(s), listLeads(s), getQuestionnaire(s), recentLeadEvents(s)]);
  const tz = company.timezone;
  const today = dayKeyInTz(new Date().toISOString(), tz);
  const yesterday = dayKeyInTz(new Date(Date.now() - 86400_000).toISOString(), tz);
  const todayCalls = calls.filter((c) => dayKeyInTz(c.startedAt, tz) === today);
  const yCalls = calls.filter((c) => dayKeyInTz(c.startedAt, tz) === yesterday);
  const byHour = (list: typeof calls) => Array.from({ length: 24 }, (_, h) => list.filter((c) => hourInTz(c.startedAt, tz) === h).length);
  const missed = todayCalls.filter((c) => c.outcome === "missed");
  const newLeads = leads.filter((l) => l.status === "new" && !l.assigneeId);
  const byStatus = { new: 0, in_progress: 0, waiting: 0, won: 0, lost: 0 } as Record<Lead["status"], number>;
  for (const l of leads) byStatus[l.status]++;
  const leadsToday = leads.filter((l) => dayKeyInTz(l.createdAt, tz) === today).length;
  const now = Date.now();

  type Attention = { id: string; kind: "complaint" | "urgent" | "sla" | "missed" | "unanswered" | "integration"; title: string; subtitle: string; at: string; href: string; leadId?: string; callId?: string; phone?: string };
  const attention: Attention[] = [];
  for (const l of leads.filter((x) => x.status !== "won" && x.status !== "lost")) {
    const sub = l.contactName ?? l.contactPhone ?? "";
    if (l.type === "complaint") attention.push({ id: `a_${l.id}`, kind: "complaint", title: l.title, subtitle: sub, at: l.createdAt, href: `/app/leads?open=${l.id}`, leadId: l.id });
    else if (l.priority === "urgent") attention.push({ id: `a_${l.id}`, kind: "urgent", title: l.title, subtitle: sub, at: l.createdAt, href: `/app/leads?open=${l.id}`, leadId: l.id });
    else if (!l.assigneeId && l.dueAt && new Date(l.dueAt).getTime() < now) attention.push({ id: `a_${l.id}`, kind: "sla", title: l.title, subtitle: sub, at: l.dueAt, href: `/app/leads?open=${l.id}`, leadId: l.id });
  }
  for (const c of calls.filter((x) => x.outcome === "missed" && !x.callbackDoneAt).slice(0, 6)) {
    attention.push({ id: `a_${c.id}`, kind: "missed", title: c.contactName ?? c.caller, subtitle: "", at: c.startedAt, href: `/app/calls?open=${c.id}`, callId: c.id, phone: c.caller });
  }
  // Вопросы без ответа ведут в базу знаний — сотруднику она недоступна
  if (s.member.role !== "staff") for (const uq of q.unanswered.slice(0, 3)) attention.push({ id: `a_${uq.id}`, kind: "unanswered", title: uq.text, subtitle: String(uq.count), at: uq.lastSeenAt, href: `/app/knowledge?unanswered=${uq.id}` });
  const order = { complaint: 0, urgent: 1, sla: 2, missed: 3, integration: 4, unanswered: 5 } as const;
  attention.sort((a, b) => order[a.kind] - order[b.kind] || b.at.localeCompare(a.at));
  const cap = { complaint: 4, urgent: 3, sla: 4, missed: 3, integration: 2, unanswered: 3 } as const;
  const seen: Record<string, number> = {};
  const capped = attention.filter((a) => (seen[a.kind] = (seen[a.kind] ?? 0) + 1) <= cap[a.kind]);

  return {
    kpi: {
      callsToday: todayCalls.length, callsYesterday: yCalls.length, callsSpark: byHour(todayCalls).slice(8, 22),
      answeredPct: todayCalls.length ? Math.round(((todayCalls.length - missed.length) / todayCalls.length) * 100) : 100,
      newLeads: newLeads.length, missed: missed.length, missedReason: "",
      minutesLeft: 0, minutesForecast: 0, minutesTotal: 0,
      kbIndex: q.draft.completeness, unanswered: q.unanswered.length,
    },
    attention: capped,
    hours: { today: byHour(todayCalls), yesterday: byHour(yCalls) },
    status: { aiMode: company.aiMode, linesBusy: 0, linesTotal: 0, numbers: [] as { id: string; e164: string }[], integrations: [], lastPublish: q.published },
    firstWeek: false,
    leadStats: { total: leads.length, today: leadsToday, newUnassigned: newLeads.length, processed: byStatus.won + byStatus.lost, byStatus },
    recent,
  };
}

/** Аналитика по реальным звонкам и заявкам за период */
export async function getAnalytics(s: Session, days = 30) {
  const [company, allCalls, allLeads] = await Promise.all([getCompany(s), listCalls(s), listLeads(s)]);
  const tz = company.timezone;
  const since = Date.now() - days * 86400_000;
  const calls = allCalls.filter((c) => new Date(c.startedAt).getTime() >= since);
  const target = calls.filter((c) => c.type && c.type !== "spam" && c.type !== "irrelevant");
  const leadsAll = allLeads.filter((l) => new Date(l.createdAt).getTime() >= since);
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
    funnel: [{ key: "calls", value: calls.length }, { key: "target", value: target.length }, { key: "leads", value: leadsAll.length }, { key: "won", value: won.length }],
    heat, byDay,
    // Ответ сотрудника на перевод в MVP не отслеживается (нет телефонии) — показываем только факт перевода
    transfers: { total: transfers.length, share: calls.length ? transfers.length / calls.length : 0, answered: transfers.length, reasons },
  };
}
