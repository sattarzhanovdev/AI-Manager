import "server-only";
import type {
  AppNotification, Branch, Call, CallTurn, Company, Contact, Faq, Lead, LeadEvent, Service, StaffMember, UnansweredQuestion,
} from "@all/db";
import type { AssistantSettings, PhoneNumber } from "../types";

/** Строки Supabase → доменные типы. Пустые значения — undefined, как в mock-хранилище. */
type Row = Record<string, unknown>;
const u = <T>(v: unknown): T | undefined => (v === null || v === undefined ? undefined : (v as T));
const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v));

export const CONTACT_COLS = "id, phone, name, channels, tags, notes, last_seen_at, interactions_count, created_at";
export const LEAD_COLS = "id, number, source, source_id, channel, type, title, status, priority, tags, contact_id, branch_id, assignee_id, due_at, closed_at, lost_reason, payload, created_at, updated_at, contacts(name, phone)";
export const CALL_COLS = "id, number_id, branch_id, caller, contact_id, started_at, answered_at, ended_at, billed_seconds, type, outcome, summary, rating, rating_reason, flags, callback_done_at, kb_version, cost_minor, created_at, contacts(name)";

export function toCompany(r: Row): Company {
  return { id: String(r.id), name: String(r.name), sphere: r.sphere as Company["sphere"], timezone: String(r.timezone), currency: r.currency as Company["currency"], aiMode: r.ai_mode as Company["aiMode"], status: r.status as Company["status"] };
}

export function toBranch(r: Row): Branch {
  return { id: String(r.id), name: String(r.name), address: String(r.address), landmarks: s(r.landmarks), hours: (r.hours ?? {}) as Branch["hours"], phones: (r.phones as string[]) ?? [] };
}

export function toContact(r: Row): Contact {
  const ch = r.channels;
  const channels = Array.isArray(ch) ? ch.map(String) : ch && typeof ch === "object" ? Object.keys(ch) : [];
  return {
    id: String(r.id), phone: s(r.phone), name: s(r.name), channels: channels.length ? channels : ["phone"], tags: (r.tags as string[]) ?? [],
    notes: s(r.notes), lastSeenAt: String(r.last_seen_at), interactionsCount: Number(r.interactions_count ?? 0), createdAt: String(r.created_at),
  };
}

export function toLead(r: Row): Lead {
  const c = (r.contacts ?? undefined) as { name?: string | null; phone?: string | null } | undefined;
  const payload: Record<string, string> = {};
  for (const [k, v] of Object.entries((r.payload ?? {}) as Record<string, unknown>)) {
    if (v !== null && v !== undefined && typeof v !== "object") payload[k] = String(v);
  }
  return {
    id: String(r.id), number: Number(r.number), source: r.source as Lead["source"], sourceId: s(r.source_id), channel: s(r.channel),
    type: r.type as Lead["type"], title: String(r.title), status: r.status as Lead["status"], priority: r.priority as Lead["priority"],
    tags: ((r.tags as string[]) ?? []) as Lead["tags"], contactId: s(r.contact_id), contactName: c?.name ?? undefined, contactPhone: c?.phone ?? undefined,
    branchId: s(r.branch_id), assigneeId: s(r.assignee_id), dueAt: s(r.due_at), closedAt: s(r.closed_at), lostReason: s(r.lost_reason),
    payload, createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

export function toLeadEvent(r: Row): LeadEvent {
  return {
    id: String(r.id), leadId: String(r.lead_id), actorId: s(r.actor_id), actorKind: r.actor_kind as LeadEvent["actorKind"],
    action: r.action as LeadEvent["action"], comment: s(r.comment), before: u(r.before), after: u(r.after), createdAt: String(r.created_at),
  };
}

export function toCall(r: Row): Call {
  const started = new Date(String(r.started_at)).getTime();
  const ended = r.ended_at ? new Date(String(r.ended_at)).getTime() : started;
  const c = (r.contacts ?? undefined) as { name?: string | null } | undefined;
  return {
    id: String(r.id), numberId: String(r.number_id ?? ""), branchId: s(r.branch_id), caller: String(r.caller), contactId: s(r.contact_id),
    contactName: c?.name ?? undefined, isNewCaller: false, startedAt: String(r.started_at), endedAt: s(r.ended_at),
    durationS: Math.max(0, Math.round((ended - started) / 1000)), billedSeconds: Number(r.billed_seconds ?? 0),
    type: u(r.type), outcome: (r.outcome ?? "no_result") as Call["outcome"], summary: s(r.summary),
    rating: u(r.rating), ratingReason: s(r.rating_reason), flags: ((r.flags as string[]) ?? []) as Call["flags"],
    transferred: r.outcome === "transferred", callbackDoneAt: s(r.callback_done_at), kbVersion: u(r.kb_version), costMinor: Number(r.cost_minor ?? 0),
  };
}

export function toTurn(r: Row): CallTurn {
  return { seq: Number(r.seq), speaker: r.speaker as CallTurn["speaker"], startMs: Number(r.start_ms), endMs: Number(r.end_ms), text: String(r.text), interrupted: Boolean(r.interrupted) };
}

export function toService(r: Row): Service {
  return {
    id: String(r.id), name: String(r.name), synonyms: (r.synonyms as string[]) ?? [], description: s(r.description), priceType: r.price_type as Service["priceType"],
    priceMin: r.price_min == null ? undefined : Number(r.price_min), priceMax: r.price_max == null ? undefined : Number(r.price_max),
    currency: r.currency as Service["currency"], durationMin: r.duration_min == null ? undefined : Number(r.duration_min),
    staffIds: (r.staff_ids as string[]) ?? [], branchIds: (r.branch_ids as string[]) ?? [], active: Boolean(r.active),
  };
}

export function toStaff(r: Row): StaffMember {
  return {
    id: String(r.id), name: String(r.name), specialties: (r.specialties as string[]) ?? [], serviceIds: (r.services as string[]) ?? [], branchId: s(r.branch_id),
    hours: (r.hours ?? {}) as StaffMember["hours"], languages: (r.languages as string[]) ?? ["ru"], transferPhone: s(r.transfer_phone), bookable: Boolean(r.bookable),
  };
}

export function toFaq(r: Row): Faq {
  return { id: String(r.id), question: String(r.question), synonyms: (r.synonyms as string[]) ?? [], shortAnswer: String(r.short_answer), longAnswer: s(r.long_answer), source: String(r.source ?? "manual"), active: Boolean(r.active) };
}

export function toUnanswered(r: Row): UnansweredQuestion {
  return { id: String(r.id), text: String(r.text), count: Number(r.count), lastSeenAt: String(r.last_seen_at), exampleCallId: s(r.example_call_id), resolved: Boolean(r.resolved) };
}

export function toNotification(r: Row): AppNotification {
  const entity = s(r.entity);
  const id = s(r.entity_id);
  const href = entity === "lead" && id ? `/app/leads?open=${id}` : entity === "call" && id ? `/app/calls?open=${id}` : undefined;
  return { id: String(r.id), kind: r.kind as AppNotification["kind"], title: String(r.title), body: s(r.body), href, readAt: s(r.read_at), createdAt: String(r.created_at) };
}

export function toNumber(r: Row): PhoneNumber {
  const sch = (r.schedule ?? {}) as { mode?: string; seconds?: number };
  const receive = sch.mode === "no_answer" || sch.mode === "schedule" ? sch.mode : "always";
  return { id: String(r.id), e164: String(r.e164), branchId: s(r.branch_id), kind: r.kind as PhoneNumber["kind"], receive, noAnswerSeconds: sch.seconds, lines: Number(r.lines ?? 1) };
}

/** Настройки ассистента по умолчанию — если в базе ещё нет строки */
export const DEFAULT_ASSISTANT: AssistantSettings = {
  voice: "aigul", speed: 1, pronunciation: [], name: "Ассистент",
  greeting: "Здравствуйте! Я виртуальный помощник компании. Чем помочь?",
  farewell: "Спасибо за обращение, хорошего дня!", mode: "consult",
  handoffRules: "", handoffQueue: [], handoffTimeoutS: 20,
  noAnswerPhrase: "Сейчас все заняты. Я создала заявку, вам перезвонят.", maxCallMinutes: 10, onLimit: "leads_only",
};
