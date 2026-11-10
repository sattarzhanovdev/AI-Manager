"use server";
import { cookies } from "next/headers";
import { djangoFetch, DJANGO_COOKIE } from "./django";
import { isDjango } from "./env";
export async function revokeDjangoSessions() {
  if (!isDjango) return { ok: false };
  await djangoFetch("/auth/sessions/", { method: "DELETE" });
  (await cookies()).delete(DJANGO_COOKIE);
  return { ok: true };
}
