import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

// en временно скрыт до завершения перевода
export const LOCALES = ["ru", "ky"] as const;
export type Locale = (typeof LOCALES)[number];

export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get("locale")?.value;
  const locale: Locale = LOCALES.includes(raw as Locale) ? (raw as Locale) : "ru";
  const base = (await import("../messages/ru.json")).default;
  const messages = locale === "ru" ? base : { ...base, ...(await import(`../messages/${locale}.json`)).default };
  return { locale, messages, timeZone: "Asia/Bishkek" };
});
