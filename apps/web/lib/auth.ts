import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Member } from "@all/db";
import { db } from "./data/mock/store";
import { env } from "./env";
import { createServerSupabase } from "./supabase/server";

export interface Session {
  userId: string;
  member: Member;
  companyId: string;
  /** Вход поддержки в кабинет клиента: полоса «Вы смотрите как поддержка» */
  supportMode?: boolean;
}

const COOKIE = "all_session";

/** Текущая сессия. В mock-режиме — cookie с userId; в supabase — JWT пользователя. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  if (env.DATA_SOURCE === "supabase") {
    const sb = await createServerSupabase();
    const { data } = await sb.auth.getUser();
    if (!data.user) return null;
    const companyId = store.get("company")?.value;
    const { data: m } = await sb.from("memberships").select("id, user_id, role, permissions, branch_ids, transfer_phone, company_id").eq("user_id", data.user.id).maybeSingle();
    if (!m) return null;
    return {
      userId: data.user.id, companyId: companyId ?? m.company_id,
      member: { id: m.id, userId: m.user_id, name: data.user.user_metadata?.full_name ?? data.user.email ?? "", role: m.role, permissions: m.permissions ?? {}, branchIds: m.branch_ids ?? [], transferPhone: m.transfer_phone ?? undefined, telegramLinked: false },
    };
  }
  const userId = store.get(COOKIE)?.value;
  if (!userId) return null;
  const member = db.members.find((m) => m.userId === userId && !m.disabledAt);
  if (!member) return null;
  return { userId, member, companyId: db.company.id, supportMode: store.get("support")?.value === "1" };
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function startMockSession(userId: string) {
  const store = await cookies();
  store.set(COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
}

export async function endSession() {
  const store = await cookies();
  store.delete(COOKIE);
  store.delete("support");
}
