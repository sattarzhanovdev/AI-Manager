import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Member, MemberRole } from "@all/db";
import { db } from "./data/mock/store";
import { env, mockAuthAllowed } from "./env";
import { createServerSupabase } from "./supabase/server";

export interface Session {
  userId: string;
  member: Member;
  companyId: string;
  email?: string;
  /** Вход поддержки в кабинет клиента: полоса «Вы смотрите как поддержка» */
  supportMode?: boolean;
}

const COOKIE = "all_session";

/**
 * Текущая сессия.
 * supabase: пользователь из Supabase Auth (getUser проверяет JWT на сервере Auth) + активное членство в компании.
 * mock: cookie с userId — только в разработке (см. mockAuthAllowed).
 * Кэшируется на время одного запроса: layout и страница не ходят в Auth дважды.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  if (env.DATA_SOURCE === "supabase") {
    const sb = await createServerSupabase();
    const { data } = await sb.auth.getUser();
    if (!data.user) return null;
    const { data: rows } = await sb.from("memberships")
      .select("id, user_id, company_id, role, permissions, branch_ids, transfer_phone, disabled_at, created_at")
      .eq("user_id", data.user.id).is("disabled_at", null).order("created_at");
    if (!rows?.length) return null;
    const wanted = store.get("company")?.value;
    const m = rows.find((r) => r.company_id === wanted) ?? rows[0]!;
    const { data: profile } = await sb.from("profiles").select("full_name, phone").eq("id", data.user.id).maybeSingle();
    const name = profile?.full_name ?? (data.user.user_metadata?.full_name as string | undefined) ?? data.user.email ?? "";
    return {
      userId: data.user.id,
      companyId: m.company_id as string,
      email: data.user.email,
      member: {
        id: m.id as string, userId: m.user_id as string, name, email: data.user.email, phone: profile?.phone ?? undefined,
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
  if (env.DATA_SOURCE === "supabase") {
    const sb = await createServerSupabase();
    await sb.auth.signOut();
  }
  store.delete(COOKIE);
  store.delete("support");
  store.delete("company");
}
