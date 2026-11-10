import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { env } from "./env";

export class DjangoError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export const DJANGO_COOKIE = "all_django_session";

/** Tokens stay in httpOnly cookies; requests to Django run only on the Next.js server. */
export async function djangoFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const store = await cookies();
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const token = store.get(DJANGO_COOKIE)?.value;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const company = store.get("company")?.value;
  if (company) headers.set("X-Company-ID", company);
  const res = await fetch(`${env.DJANGO_API_URL}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const error = await res.json().catch(() => null) as { detail?: unknown } | null;
    const detail = typeof error?.detail === "string" ? error.detail : res.status === 401 ? "Войдите снова." : res.status === 403 ? "Недостаточно прав." : res.status === 404 ? "Объект не найден." : "Проверьте введённые данные.";
    throw new DjangoError(detail, res.status);
  }
  if (res.status === 204) return undefined as T;
  return await res.json() as T;
}
const readCached = cache((name: string, id?: string, days?: number) => {
  const query = new URLSearchParams();
  if (id) query.set("id", id);
  if (days) query.set("days", String(days));
  return djangoFetch<unknown>(`/read/${name}/?${query}`);
});
export const djangoRead = <T>(name: string, id?: string, days?: number) => readCached(name, id, days) as Promise<T>;
export async function djangoAction<T = undefined>(name: string, args: unknown[]): Promise<{ ok: true; data?: T } | { ok: false; error: string }> {
  try {
    const data = await djangoFetch<T>(`/commands/${name}/`, { method: "POST", body: JSON.stringify({ args }) });
    if (name !== "setField") revalidatePath("/app", "layout");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof DjangoError ? e.message : "Не удалось связаться с сервером. Повторите попытку." };
  }
}
