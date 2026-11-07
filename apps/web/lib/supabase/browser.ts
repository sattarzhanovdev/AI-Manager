"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Браузерный клиент — только чтение и Realtime */
export function createBrowserSupabase() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
