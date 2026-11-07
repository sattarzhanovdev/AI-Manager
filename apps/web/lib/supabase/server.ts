import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** Клиент с JWT пользователя — по умолчанию для всех запросов кабинета (RLS работает) */
export async function createServerSupabase() {
  const store = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { for (const c of list) store.set(c.name, c.value, c.options); } catch { /* вызов из Server Component */ }
      },
    },
  });
}

/**
 * Сервисный клиент — только для вебхуков и серверных задач, только через RPC с явным company_id.
 * Импорт из клиентского кода невозможен благодаря server-only.
 */
export function createServiceSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}
