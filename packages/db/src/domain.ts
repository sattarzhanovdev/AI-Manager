// Доменные типы, общие для web, workers и integrations.
// Строковые литералы совпадают с check-ограничениями миграций.
// Сгенерированные типы Supabase: `pnpm db:types` → src/database.types.ts

export type Uuid = string;
export type IsoDate = string;
/** Деньги: целые минорные единицы */
export type Money = { amountMinor: number; currency: Currency };
export type Currency = "KGS" | "KZT" | "RUB" | "USD";

export type MemberRole = "owner" | "admin" | "staff" | "accountant";
export type AiMode = "on" | "leads_only" | "all_human" | "off";
export type Sphere = "autoservice" | "salon" | "clinic" | "dental" | "service" | "polyclinic" | "other";

export interface Company {
  id: Uuid;
  name: string;
  sphere: Sphere;
  timezone: string;
  currency: Currency;
  aiMode: AiMode;
  status: "onboarding" | "moderation" | "active" | "suspended" | "closed";
}

export interface Branch {
  id: Uuid;
  name: string;
  address: string;
  landmarks?: string;
  hours: Record<Weekday, [string, string][]>;
  phones: string[];
}
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface Member {
  id: Uuid;
  userId: Uuid;
  name: string;
  email?: string;
  phone?: string;
  role: MemberRole;
  permissions: Partial<Record<Permission, boolean>>;
  branchIds: Uuid[];
  transferPhone?: string;
  telegramLinked: boolean;
  lastSeenAt?: IsoDate;
  disabledAt?: IsoDate;
}
export type Permission = "edit_questionnaire" | "integrations";

export type CallType = "booking" | "consultation" | "complaint" | "reschedule" | "irrelevant" | "spam";
export type CallOutcome = "lead_created" | "booked" | "transferred" | "no_result" | "dropped" | "missed";
export type CallFlag = "wrong_price" | "misunderstood" | "rude" | "slow" | "unanswered" | "interrupted";

export interface Call {
  id: Uuid;
  numberId: Uuid;
  branchId?: Uuid;
  caller: string;
  contactId?: Uuid;
  contactName?: string;
  isNewCaller: boolean;
  startedAt: IsoDate;
  endedAt?: IsoDate;
  durationS: number;
  billedSeconds: number;
  type?: CallType;
  outcome: CallOutcome;
  summary?: string;
  rating?: -1 | 1;
  ratingReason?: string;
  flags: CallFlag[];
  transferred: boolean;
  callbackDoneAt?: IsoDate;
  kbVersion?: number;
  costMinor: number;
}

export interface CallTurn {
  seq: number;
  speaker: "ai" | "caller" | "operator";
  startMs: number;
  endMs: number;
  text: string;
  interrupted: boolean;
  latencyMs?: number;
}

export interface CallToolCall {
  atMs: number;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: "ok" | "error" | "rejected";
}

export interface CallDetail extends Call {
  turns: CallTurn[];
  toolCalls: CallToolCall[];
  leadIds: Uuid[];
}

export type LeadStatus = "new" | "in_progress" | "waiting" | "won" | "lost";
export type LeadType = "booking" | "consultation" | "order" | "complaint" | "reschedule" | "callback" | "other";
export type LeadTag = "complaint" | "urgent" | "missed" | "vip";

export interface Lead {
  id: Uuid;
  number: number;
  source: "call" | "chat" | "manual" | "demo";
  sourceId?: Uuid;
  channel?: string;
  type: LeadType;
  title: string;
  status: LeadStatus;
  priority: "normal" | "urgent";
  tags: LeadTag[];
  contactId?: Uuid;
  contactName?: string;
  contactPhone?: string;
  branchId?: Uuid;
  assigneeId?: Uuid;
  dueAt?: IsoDate;
  closedAt?: IsoDate;
  lostReason?: string;
  payload: Record<string, string>;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface LeadEvent {
  id: Uuid;
  leadId: Uuid;
  actorId?: Uuid;
  actorKind: "user" | "ai" | "system";
  action: "created" | "status" | "assignee" | "comment" | "tag" | "field";
  comment?: string;
  before?: unknown;
  after?: unknown;
  createdAt: IsoDate;
}

export interface Contact {
  id: Uuid;
  phone?: string;
  name?: string;
  channels: string[];
  tags: string[];
  notes?: string;
  lastSeenAt: IsoDate;
  interactionsCount: number;
  createdAt: IsoDate;
}

export type PriceType = "exact" | "range" | "after_inspection";

export interface Service {
  id: Uuid;
  name: string;
  synonyms: string[];
  description?: string;
  priceType: PriceType;
  priceMin?: number;
  priceMax?: number;
  currency: Currency;
  durationMin?: number;
  staffIds: Uuid[];
  branchIds: Uuid[];
  active: boolean;
}

export interface StaffMember {
  id: Uuid;
  name: string;
  specialties: string[];
  serviceIds: Uuid[];
  branchId?: Uuid;
  hours: Partial<Record<Weekday, [string, string][]>>;
  languages: string[];
  transferPhone?: string;
  bookable: boolean;
}

export interface Faq {
  id: Uuid;
  question: string;
  synonyms: string[];
  shortAnswer: string;
  longAnswer?: string;
  source: string;
  active: boolean;
}

export interface UnansweredQuestion {
  id: Uuid;
  text: string;
  count: number;
  lastSeenAt: IsoDate;
  exampleCallId?: Uuid;
  resolved: boolean;
}

export interface QuestionnaireVersion {
  version: number;
  status: "draft" | "published" | "archived";
  publishedAt?: IsoDate;
  completeness: number;
}

export interface Integration {
  key: string;
  group: "channels" | "crm" | "calendars" | "sheets" | "developers";
  status: "connected" | "error" | "reconnect" | "disabled" | "not_connected" | "plan_locked";
  lastSyncAt?: IsoDate;
  errors24h: number;
  phase: "1a" | "1b" | "2" | "3";
}

export interface IntegrationLog {
  id: Uuid;
  at: IsoDate;
  direction: "in" | "out";
  event: string;
  status: "ok" | "error" | "retrying" | "dead";
  ms: number;
  error?: string;
}

export type NotificationKind =
  | "lead_new" | "lead_urgent" | "complaint" | "call_missed" | "chat_takeover"
  | "limit_80" | "limit_100" | "integration_error" | "payment_due" | "kb_published";

export interface AppNotification {
  id: Uuid;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  readAt?: IsoDate;
  createdAt: IsoDate;
}

export interface Usage {
  minutesUsed: number;
  minutesTotal: number;
  dialogsUsed: number;
  dialogsTotal: number;
  linesBusy: number;
  linesTotal: number;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  overagePolicy: "pay" | "stop_ai";
  overageCapMinor?: number;
}

export interface Plan {
  key: "start" | "business" | "pro";
  name: string;
  priceMinor: number;
  currency: Currency;
  minutes: number;
  aiDialogs: number;
  lines: number;
  modes: ("leads" | "consult" | "booking" | "semi")[];
}

export interface Invoice {
  id: Uuid;
  number: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  amountMinor: number;
  currency: Currency;
  status: "draft" | "issued" | "paid" | "overdue" | "void";
}

export interface AuditEntry {
  id: Uuid;
  actorName: string;
  action: string;
  entity: string;
  createdAt: IsoDate;
  detail?: string;
}

// ───────────── Чаты (фаза 1б) ─────────────
export type ChannelType = "widget" | "telegram" | "whatsapp" | "instagram" | "facebook";
export type ConversationState = "ai" | "draft" | "operator" | "closed";

export interface Conversation {
  id: Uuid;
  channel: ChannelType;
  contactId?: Uuid;
  contactName?: string;
  contactPhone?: string;
  state: ConversationState;
  assigneeId?: Uuid;
  /** 24-часовое окно Meta: после него — только одобренные шаблоны */
  windowExpiresAt?: IsoDate;
  lastMessageAt: IsoDate;
  lastMessage: string;
  unread: number;
  needsHuman: boolean;
  tags: string[];
}

export interface Attachment { kind: "image" | "file" | "voice"; name: string; url?: string; durationS?: number }

export interface ChatMessage {
  id: Uuid;
  conversationId: Uuid;
  direction: "in" | "out";
  author: "client" | "ai" | "operator" | "system";
  authorId?: Uuid;
  body?: string;
  attachments: Attachment[];
  /** Расшифровка голосового сообщения */
  transcript?: string;
  status: "draft" | "queued" | "sent" | "delivered" | "failed";
  createdAt: IsoDate;
}

// ───────────── Запись, талоны, лист ожидания (фаза 1б) ─────────────
export interface Resource {
  id: Uuid;
  kind: "staff" | "room" | "equipment";
  name: string;
  branchId?: Uuid;
  staffId?: Uuid;
}

export type AppointmentStatus = "held" | "booked" | "cancelled" | "done" | "no_show" | "blocked";

export interface Appointment {
  id: Uuid;
  resourceId: Uuid;
  serviceId?: Uuid;
  serviceName?: string;
  contactId?: Uuid;
  contactName?: string;
  contactPhone?: string;
  startsAt: IsoDate;
  endsAt: IsoDate;
  status: AppointmentStatus;
  createdByAi: boolean;
  leadId?: Uuid;
  note?: string;
}

export interface Ticket {
  id: Uuid;
  doctor: string;
  specialty: string;
  startsAt: IsoDate;
  opensAt: IsoDate;
  status: "closed" | "open" | "offered" | "taken" | "cancelled";
  contactName?: string;
  contactPhone?: string;
}

export interface WaitlistEntry {
  id: Uuid;
  scope: string;
  contactName: string;
  contactPhone: string;
  position: number;
  status: "waiting" | "offered" | "accepted" | "expired" | "removed";
  offeredAt?: IsoDate;
  expiresAt?: IsoDate;
  createdAt: IsoDate;
}
