import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Member, MemberRole } from "@all/db";
import { db } from "./data/mock/store";
import { env, mockAuthAllowed, isDjango } from "./env";
import { createServerSupabase } from "./supabase/server";

export interface Session {
  userId: string;
  member: Member;
  companyId: string;
  email?: string;
  /** Вход поддержки в кабинет клиента: полоса «Вы смотрите как поддержка» */
  supportMode?: boolean;
}

import { djangoFetch, DJANGO_COOKIE, DjangoError } from "./django";

const COOKIE = "all_session";

/**
 * Текущая сессия.
 * supabase: пользователь из Supabase Auth (getUser проверяет JWT на сервере Auth) + активное членство в компании.
 * mock: cookie с userId — только в разработке (см. mockAuthAllowed).
 * Кэшируется на время одного запроса: layout и страница не ходят в Auth дважды.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  if (isDjango) {
    if (!store.has(DJANGO_COOKIE)) return null;
    try { return await djangoFetch<Session>("/auth/session/"); }
    catch (e) { if (e instanceof DjangoError && [401, 403, 404].includes(e.status)) return null; throw e; }
  }
  if (env.DATA_SOURCE === "supabase") {
    const sb = await createServerSupabase();
    // Проверяем подпись JWT без обязательного обращения к Auth API на каждом
    // серверном рендере. Membership/RLS по-прежнему проверяются в Supabase.
    const { data, error } = await sb.auth.getClaims();
    if (error || !data?.claims?.sub) return null;
    const userId = data.claims.sub;
    const email = typeof data.claims.email === "string" ? data.claims.email : undefined;
    // These independent RLS-protected lookups run in parallel, removing one
    // additional cross-region database round trip on every navigation.
    const [{ data: rows }, { data: profile }] = await Promise.all([
      sb.from("memberships")
        .select("id, user_id, company_id, role, permissions, branch_ids, transfer_phone, disabled_at, created_at")
        .eq("user_id", userId).is("disabled_at", null).order("created_at"),
      sb.from("profiles").select("full_name, phone").eq("id", userId).maybeSingle(),
    ]);
    if (!rows?.length) return null;
    const wanted = store.get("company")?.value;
    const m = rows.find((r) => r.company_id === wanted) ?? rows[0]!;
    const name = profile?.full_name ?? email ?? "";
    return {
      userId: userId,
      companyId: m.company_id as string,
      email: email,
      member: {
        id: m.id as string, userId: m.user_id as string, name, email: email, phone: profile?.phone ?? undefined,
        role: m.role as MemberRole, permissions: (m.permissions as Member["permissions"]) ?? {}, branchIds: (m.branch_ids as string[]) ?? [],
        transferPhone: (m.transfer_phone as string | null) ?? undefined, telegramLinked: false,
      },
    };
  }
  if (!mockAuthAllowed) return null;
  const userId = store.get(COOKIE)?.value;
  if (!userId) return null;
  const member = db.members.find((m) => m.userId === userId && !m.disabledAt);
  if (!member) return null;
  return { userId, member, companyId: db.company.id, supportMode: store.get("support")?.value === "1" };
});

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function startMockSession(userId: string) {
  if (!mockAuthAllowed) throw new Error("mock auth disabled");
  const store = await cookies();
  store.set(COOKIE, userId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 14 });
}

export async function endSession() {
  const store = await cookies();
  if (isDjango) {
    try { await djangoFetch("/auth/session/", { method: "DELETE" }); }
    finally { store.delete(DJANGO_COOKIE); }
  }
  if (env.DATA_SOURCE === "supabase") {
    const sb = await createServerSupabase();
    await sb.auth.signOut();
  }
  store.delete(COOKIE);
  store.delete("support");
  store.delete("company");
}
