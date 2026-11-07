import "server-only";
import type { Session } from "../auth";
import { isSupabase } from "../env";
import * as mock from "./queries";
import * as sb from "./sb/repo";

/**
 * Единая точка чтения для страниц и API кабинета.
 * DATA_SOURCE=supabase — реальные данные под JWT пользователя (RLS); mock — демо-хранилище в памяти для локальной разработки.
 * В режиме supabase ничего не читается из mock-массивов.
 */
export const getCompany = (s: Session) => (isSupabase ? sb.getCompany(s) : Promise.resolve(mock.getCompany()));
export const getMembers = (s: Session) => (isSupabase ? sb.getMembers(s) : Promise.resolve(mock.getMembers()));
export const getBranches = (s: Session) => (isSupabase ? sb.getBranches(s) : Promise.resolve(mock.getBranches()));
export const getNumbers = (s: Session) => (isSupabase ? sb.getNumbers(s) : Promise.resolve(mock.getNumbers()));
export const listCalls = (s: Session) => (isSupabase ? sb.listCalls(s) : Promise.resolve(mock.listCalls(s)));
export const getCall = (s: Session, id: string) => (isSupabase ? sb.getCall(s, id) : Promise.resolve(mock.getCall(s, id)));
export const listLeads = (s: Session) => (isSupabase ? sb.listLeads(s) : Promise.resolve(mock.listLeads(s)));
export const getLead = async (s: Session, id: string) => {
  if (isSupabase) return sb.getLead(s, id);
  const r = mock.getLead(s, id);
  return r ? { ...r, dialog: [] as sb.DialogMessage[] } : null;
};
export const listContacts = (s: Session) => (isSupabase ? sb.listContacts(s) : Promise.resolve(mock.listContacts()));
export const getContact = (s: Session, id: string) => (isSupabase ? sb.getContact(s, id) : Promise.resolve(mock.getContact(id)));
export const getQuestionnaire = (s: Session) => (isSupabase ? sb.getQuestionnaire(s) : Promise.resolve(mock.getQuestionnaire()));
export const getAssistant = (s: Session) => (isSupabase ? sb.getAssistant(s) : Promise.resolve(mock.getAssistant()));
export const getCurrentPlan = (s: Session) => (isSupabase ? sb.getCurrentPlan(s) : Promise.resolve(mock.getCurrentPlan()));
export const getNotifications = (s: Session) => (isSupabase ? sb.getNotifications(s) : Promise.resolve(mock.getNotifications()));

export type OverviewData = Awaited<ReturnType<typeof sb.getOverview>>;
export const getOverview = async (s: Session): Promise<OverviewData> => {
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
export const getAnalytics = (s: Session, days: number) => (isSupabase ? sb.getAnalytics(s, days) : Promise.resolve(mock.getAnalytics(s, days)));

/** Разделы, которые в Hackathon MVP (supabase) не подключены к базе — скрыты из навигации и закрыты заглушкой */
export const MVP_DISABLED = ["inbox", "calendar", "integrations", "team", "billing", "settings"] as const;
export const isDisabledInMvp = (key: (typeof MVP_DISABLED)[number]) => isSupabase && MVP_DISABLED.includes(key);
