import "server-only";
import type { Session } from "../auth";
import { isSupabase, isDjango } from "../env";
import * as mock from "./queries";
import * as sb from "./sb/repo";
import { djangoRead } from "../django";

/**
 * Единая точка чтения для страниц и API кабинета.
 * DATA_SOURCE=supabase — реальные данные под JWT пользователя (RLS); mock — демо-хранилище в памяти для локальной разработки.
 * В режиме supabase ничего не читается из mock-массивов.
 */
export const getCompany = (s: Session) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.getCompany>>>("getCompany") : isSupabase ? sb.getCompany(s) : Promise.resolve(mock.getCompany()));
export const getMembers = (s: Session) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.getMembers>>>("getMembers") : isSupabase ? sb.getMembers(s) : Promise.resolve(mock.getMembers()));
export const getBranches = (s: Session) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.getBranches>>>("getBranches") : isSupabase ? sb.getBranches(s) : Promise.resolve(mock.getBranches()));
export const getNumbers = (s: Session) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.getNumbers>>>("getNumbers") : isSupabase ? sb.getNumbers(s) : Promise.resolve(mock.getNumbers()));
export const listCalls = (s: Session) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.listCalls>>>("listCalls") : isSupabase ? sb.listCalls(s) : Promise.resolve(mock.listCalls(s)));
export const getCall = (s: Session, id: string) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.getCall>>>("getCall", id) : isSupabase ? sb.getCall(s, id) : Promise.resolve(mock.getCall(s, id)));
export const listLeads = (s: Session) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.listLeads>>>("listLeads") : isSupabase ? sb.listLeads(s) : Promise.resolve(mock.listLeads(s)));
export const getLead = async (s: Session, id: string) => {
  if (isDjango) return djangoRead<Awaited<ReturnType<typeof sb.getLead>>>("getLead", id);
  if (isSupabase) return sb.getLead(s, id);
  const r = mock.getLead(s, id);
  return r ? { ...r, dialog: [] as sb.DialogMessage[] } : null;
};
export const listContacts = (s: Session) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.listContacts>>>("listContacts") : isSupabase ? sb.listContacts(s) : Promise.resolve(mock.listContacts()));
export const getContact = (s: Session, id: string) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.getContact>>>("getContact", id) : isSupabase ? sb.getContact(s, id) : Promise.resolve(mock.getContact(id)));
export const getQuestionnaire = (s: Session) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.getQuestionnaire>>>("getQuestionnaire") : isSupabase ? sb.getQuestionnaire(s) : Promise.resolve(mock.getQuestionnaire()));
export const getAssistant = (s: Session) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.getAssistant>>>("getAssistant") : isSupabase ? sb.getAssistant(s) : Promise.resolve(mock.getAssistant()));
export const getCurrentPlan = (s: Session) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.getCurrentPlan>>>("getCurrentPlan") : isSupabase ? sb.getCurrentPlan(s) : Promise.resolve(mock.getCurrentPlan()));
export const getNotifications = (s: Session) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.getNotifications>>>("getNotifications") : isSupabase ? sb.getNotifications(s) : Promise.resolve(mock.getNotifications()));
/** Small, RLS-aware counts for the persistent cabinet navigation. */
export const getSidebarStats = (s: Session, includeKnowledge: boolean) => {
  if (isDjango) return djangoRead<Awaited<ReturnType<typeof sb.getSidebarStats>>>("getSidebarStats");
  if (isSupabase) return sb.getSidebarStats(s, includeKnowledge);
  const leads = s.member.role === "accountant" ? [] : mock.listLeads(s);
  const q = includeKnowledge ? mock.getQuestionnaire() : null;
  return Promise.resolve({
    newUnassignedLeads: leads.filter((l) => l.status === "new" && !l.assigneeId).length,
    unansweredCount: q?.unanswered.length ?? 0,
    kbLow: !!q && q.draft.completeness < 50,
  });
};

export type OverviewData = Awaited<ReturnType<typeof sb.getOverview>>;
export const getOverview = async (s: Session): Promise<OverviewData> => {
  if (isDjango) return djangoRead<OverviewData>("getOverview");
  if (isSupabase) return sb.getOverview(s);
  const o = mock.getOverview(s);
  const leads = mock.listLeads(s);
  const byStatus = { new: 0, in_progress: 0, waiting: 0, won: 0, lost: 0 };
  for (const l of leads) byStatus[l.status]++;
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...o, status: { ...o.status, numbers: o.status.numbers.map((n) => ({ id: n.id, e164: n.e164 })), integrations: [] },
    leadStats: { total: leads.length, today: leads.filter((l) => l.createdAt.startsWith(today)).length, newUnassigned: o.kpi.newLeads, processed: byStatus.won + byStatus.lost, byStatus },
    recent: [],
  };
};
export const getAnalytics = (s: Session, days: number) => (isDjango ? djangoRead<Awaited<ReturnType<typeof sb.getAnalytics>>>("getAnalytics", undefined, days) : isSupabase ? sb.getAnalytics(s, days) : Promise.resolve(mock.getAnalytics(s, days)));

/** Разделы, которые в Hackathon MVP (supabase) не подключены к базе — скрыты из навигации и закрыты заглушкой */
export const MVP_DISABLED = ["inbox", "calendar", "integrations", "team", "billing", "settings"] as const;
export const isDisabledInMvp = (key: (typeof MVP_DISABLED)[number]) => isSupabase && MVP_DISABLED.includes(key);


export const getUsage = (s: Session) => isDjango ? djangoRead<ReturnType<typeof mock.getUsage>>("getUsage") : Promise.resolve(mock.getUsage());

export const getPlans = (s: Session) => isDjango ? djangoRead<ReturnType<typeof mock.getPlans>>("getPlans") : Promise.resolve(mock.getPlans());

export const getInvoices = (s: Session) => isDjango ? djangoRead<ReturnType<typeof mock.getInvoices>>("getInvoices") : Promise.resolve(mock.getInvoices());

export const getIntegrations = (s: Session) => isDjango ? djangoRead<ReturnType<typeof mock.getIntegrations>>("getIntegrations") : Promise.resolve(mock.getIntegrations());

export const getNotificationPrefs = (s: Session) => isDjango ? djangoRead<ReturnType<typeof mock.getNotificationPrefs>>("getNotificationPrefs") : Promise.resolve(mock.getNotificationPrefs());

export const getApiKeys = (s: Session) => isDjango ? djangoRead<ReturnType<typeof mock.getApiKeys>>("getApiKeys") : Promise.resolve(mock.getApiKeys());

export const getAudit = (s: Session) => isDjango ? djangoRead<ReturnType<typeof mock.getAudit>>("getAudit") : Promise.resolve(mock.getAudit());

export const getCalendar = (s: Session) => isDjango ? djangoRead<ReturnType<typeof mock.getCalendar>>("getCalendar") : Promise.resolve(mock.getCalendar());

export const listConversations = (s: Session) => isDjango ? djangoRead<ReturnType<typeof mock.listConversations>>("listConversations") : Promise.resolve(mock.listConversations(s));

export const getConversation = (s: Session, id: string) => isDjango ? djangoRead<ReturnType<typeof mock.getConversation>>("getConversation", id) : Promise.resolve(mock.getConversation(s, id));

export const getIntegrationLogs = (s: Session, id: string) => isDjango ? djangoRead<ReturnType<typeof mock.getIntegrationLogs>>("getIntegrationLogs", id) : Promise.resolve(mock.getIntegrationLogs(id));
