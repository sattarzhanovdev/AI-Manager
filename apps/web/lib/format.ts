import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { Currency } from "@all/db";

export const COMPANY_TZ_DEFAULT = "Asia/Bishkek";

/** E.164 → национальный формат для показа */
export function formatPhone(e164?: string | null): string {
  if (!e164) return "";
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatInternational() : e164;
}

/** Ввод пользователя → E.164 (KG по умолчанию) */
export function toE164(input: string, country: "KG" | "KZ" | "RU" = "KG"): string | null {
  const p = parsePhoneNumberFromString(input, country);
  return p?.isValid() ? p.number : null;
}

const UNIT: Record<Currency, string> = { KGS: "сом", KZT: "₸", RUB: "₽", USD: "$" };

export function formatMoney(minor: number, currency: Currency): string {
  const v = minor / 100;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: v % 1 === 0 ? 0 : 2 }).format(v)} ${UNIT[currency]}`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto", style: "short" });

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "только что";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(iso);
}

export function formatDateTime(iso: string, tz = COMPANY_TZ_DEFAULT): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function formatDate(iso: string, tz = COMPANY_TZ_DEFAULT): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

export function formatTime(iso: string, tz = COMPANY_TZ_DEFAULT): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Час в часовом поясе компании (0–23) */
export function hourInTz(iso: string, tz = COMPANY_TZ_DEFAULT): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date(iso))) % 24;
}

export function dayKeyInTz(iso: string, tz = COMPANY_TZ_DEFAULT): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const fmtInt = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
