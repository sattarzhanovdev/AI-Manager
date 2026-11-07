import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "../env";

/** Токены сессии недоступны JS страницы: браузерный клиент Supabase в кабинете не используется */
export const SESSION_COOKIE = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

/** Клиент с JWT пользователя — по умолчанию для всех запросов кабинета (RLS работает) */
export async function createServerSupabase() {
  const store = await cookies();
  return createServerClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
    cookieOptions: SESSION_COOKIE,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { for (const c of list) store.set(c.name, c.value, c.options); } catch { /* вызов из Server Component — cookies обновит proxy */ }
      },
    },
  });
}

/**
 * Сервисный клиент — только для доверенных серверных задач (provisioning, вебхуки), только через RPC с явным company_id.
 * Импорт из клиентского кода невозможен благодаря server-only. Кабинет и AI-диалог работают под JWT пользователя.
 */
export function createServiceSupabase() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
