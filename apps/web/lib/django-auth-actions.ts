"use server";
import { isDjango } from "./env";
import { djangoFetch, DjangoError } from "./django";
export async function acceptDjangoInvite(input: { token: string; password: string; name: string }) {
  if (!isDjango) return { ok: false, error: "Недоступно" };
  try {
    await djangoFetch("/auth/accept-invite/", { method: "POST", body: JSON.stringify(input) });
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof DjangoError ? e.message : "Не удалось связаться с сервером." }; }
}
