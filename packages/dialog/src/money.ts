import type { Currency } from "@all/db";

const UNIT: Record<Currency, string> = { KGS: "сом", KZT: "тенге", RUB: "₽", USD: "$" };

export function formatMoney(minor: number, currency: Currency): string {
  const major = minor / 100;
  const s = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: major % 1 === 0 ? 0 : 2 }).format(major);
  return `${s.replace(/[\u00a0\u202f]/g, " ")} ${UNIT[currency]}`;
}

export const CURRENCY_WORDS = /(сом|сомов|сома|тенге|тг|руб|рублей|рубля|₽|\$|долл)/i;
