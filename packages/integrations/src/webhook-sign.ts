import { createHmac, timingSafeEqual } from "node:crypto";

/** Подпись исходящих вебхуков: HMAC-SHA256 от `${timestamp}.${body}` */
export function sign(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): { header: string; timestamp: number } {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { header: `t=${timestamp},v1=${mac}`, timestamp };
}

export function verify(secret: string, body: string, header: string, toleranceS = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const ts = Number(parts.t);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > toleranceS || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${body}`).digest();
  const got = Buffer.from(parts.v1, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
