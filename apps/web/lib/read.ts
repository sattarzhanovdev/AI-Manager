"use client";
import type { getIntegrationLogs, getConversation } from "./data/queries";
import type { getCall, getLead, getContact } from "./data/repo";

async function get<T>(kind: string, id: string): Promise<T | null> {
  const r = await fetch(`/api/read/${kind}/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`read ${kind} failed: ${r.status}`);
  return (await r.json()) as T;
}

export const fetchCall = (id: string) => get<NonNullable<Awaited<ReturnType<typeof getCall>>>>("call", id);
export const fetchLead = (id: string) => get<NonNullable<Awaited<ReturnType<typeof getLead>>>>("lead", id);
export const fetchContact = (id: string) => get<NonNullable<Awaited<ReturnType<typeof getContact>>>>("contact", id);
export const fetchIntegrationLogs = (key: string) => get<ReturnType<typeof getIntegrationLogs>>("integration-log", key);
export const fetchConversation = (id: string) => get<NonNullable<ReturnType<typeof getConversation>>>("conversation", id);
