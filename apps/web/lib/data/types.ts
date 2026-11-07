import type {
  Appointment, ChatMessage, Conversation, Resource, Ticket, WaitlistEntry,
  AiMode, AppNotification, AuditEntry, Branch, Call, CallDetail, Company, Contact, Faq, Integration, IntegrationLog,
  Invoice, Lead, LeadEvent, Member, Plan, QuestionnaireVersion, Service, StaffMember, UnansweredQuestion, Usage,
} from "@all/db";
import type { FieldValues } from "@all/dialog";

export interface PhoneNumber {
  id: string;
  e164: string;
  branchId?: string;
  kind: "forwarding" | "platform";
  receive: "always" | "no_answer" | "schedule";
  noAnswerSeconds?: number;
  lines: number;
}

export interface AssistantSettings {
  voice: string;
  speed: number;
  pronunciation: { word: string; say: string }[];
  name: string;
  greeting: string;
  farewell: string;
  mode: "leads" | "consult" | "booking" | "semi";
  handoffRules: string;
  handoffQueue: string[];
  handoffTimeoutS: number;
  noAnswerPhrase: string;
  maxCallMinutes: number;
  onLimit: "leads_only" | "all_human";
}

export interface QuestionnaireState {
  draft: QuestionnaireVersion;
  published?: QuestionnaireVersion;
  versions: QuestionnaireVersion[];
  fields: FieldValues;
  fieldSources: Record<string, string>;
  changedSincePublish: string[];
  services: Service[];
  staff: StaffMember[];
  faq: Faq[];
  unanswered: UnansweredQuestion[];
  branches: Branch[];
}

export interface ContactTimelineItem {
  kind: "call" | "lead" | "note";
  id: string;
  at: string;
  title: string;
  subtitle?: string;
  href?: string;
}

export interface NotificationPref { kind: string; channels: ("app" | "telegram" | "email" | "push")[] }

export interface ApiKey { id: string; name: string; prefix: string; scopes: string[]; createdAt: string; lastUsedAt?: string; revokedAt?: string }

export interface AdminCompany {
  id: string; name: string; sphere: string; status: Company["status"]; plan: string; readiness: number;
  minutesUsed: number; costMinor: number; revenueMinor: number; kbIndex: number; lastActivityAt: string;
}
export interface DemoLead { id: string; phone: string; calls: number; roles: string[]; consent: boolean; status: "new" | "contacted" | "meeting" | "won" | "lost"; owner?: string; createdAt: string; utm?: string }
export interface DemoCall { id: string; caller: string; roles: string[]; durationS: number; costMinor: number; summarySent: boolean; token: string; createdAt: string }
export interface ModerationItem { id: string; company: string; version: number; status: "queued" | "in_review" | "approved" | "rejected"; slaDueAt: string; findings: { rule: string; quote: string; severity: "low" | "high" }[] }

export type RealtimeEvent =
  | { type: "call.created"; call: Call }
  | { type: "lead.created"; lead: Lead }
  | { type: "lead.updated"; lead: Lead }
  | { type: "notification"; notification: AppNotification }
  | { type: "company.ai_mode"; mode: AiMode }
  | { type: "message.created"; message: ChatMessage; conversation: Conversation }
  | { type: "conversation.updated"; conversation: Conversation }
  | { type: "appointment.changed"; appointment: Appointment }
  | { type: "waitlist.changed" };

export type {
  Appointment, ChatMessage, Conversation, Resource, Ticket, WaitlistEntry,
  AiMode, AppNotification, AuditEntry, Branch, Call, CallDetail, Company, Contact, Faq, Integration, IntegrationLog,
  Invoice, Lead, LeadEvent, Member, Plan, QuestionnaireVersion, Service, StaffMember, UnansweredQuestion, Usage,
};
