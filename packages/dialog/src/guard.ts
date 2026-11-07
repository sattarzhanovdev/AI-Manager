import type { KbSnapshot } from "./snapshot";
import { CURRENCY_WORDS } from "./money";

export type GuardAction = "price_replaced" | "stop_topic" | "human_claim" | "forbidden_word";

export interface GuardResult {
  text: string;
  actions: GuardAction[];
}

const PRICE_FALLBACK = "Точную цену уточнит администратор.";
const HUMAN_CLAIM = /(я\s+(живой\s+)?человек|я\s+не\s+(робот|бот|ии|искусственн)|я\s+настоящ(ий|ая)\s+(человек|сотрудник))/i;

/** Разбивает поток текста на предложения — охрана работает по предложениям до синтеза */
export function splitSentences(text: string): string[] {
  return text.match(/[^.!?…]+[.!?…]*\s*/g)?.map((s) => s) ?? [text];
}

function knownAmounts(s: KbSnapshot): Set<number> {
  const out = new Set<number>();
  for (const sv of s.services) {
    if (sv.priceType === "after_inspection") continue;
    if (sv.priceMin != null) out.add(sv.priceMin / 100);
    if (sv.priceMax != null) out.add(sv.priceMax / 100);
  }
  return out;
}

function amountsIn(sentence: string): number[] {
  if (!CURRENCY_WORDS.test(sentence)) return [];
  const out: number[] = [];
  const re = /(\d[\d\s ]*(?:[.,]\d+)?)\s*(тыс(?:яч[аи]?)?\.?)?/gi;
  for (const m of sentence.matchAll(re)) {
    const raw = m[1]?.replace(/[\s ]/g, "").replace(",", ".");
    if (!raw) continue;
    let n = Number(raw);
    if (m[2]) n *= 1000;
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  if (/полторы\s+тысячи/i.test(sentence)) out.push(1500);
  return out;
}

/** Проверка одного предложения перед синтезом или отправкой */
export function guardSentence(sentence: string, s: KbSnapshot): GuardResult {
  const actions: GuardAction[] = [];
  let text = sentence;

  if (HUMAN_CLAIM.test(text)) {
    actions.push("human_claim");
    text = `Я виртуальный помощник компании «${s.company.name}». `;
  }

  const amounts = amountsIn(text);
  if (amounts.length) {
    const known = knownAmounts(s);
    if (amounts.some((a) => !known.has(a))) {
      actions.push("price_replaced");
      text = PRICE_FALLBACK + " ";
    }
  }

  const low = text.toLowerCase();
  if (s.stop.topics.some((t) => t && low.includes(t.toLowerCase()))) {
    actions.push("stop_topic");
    text = s.stop.reply + " ";
  }
  for (const w of s.stop.words) {
    if (w && low.includes(w.toLowerCase())) {
      actions.push("forbidden_word");
      text = text.replace(new RegExp(w, "gi"), "");
    }
  }
  return { text, actions };
}

export function guardText(text: string, s: KbSnapshot): GuardResult {
  const parts = splitSentences(text).map((p) => guardSentence(p, s));
  return { text: parts.map((p) => p.text).join("").trim(), actions: parts.flatMap((p) => p.actions) };
}

/** Вызов неразрешённой функции отклоняется */
export function guardToolCall(name: string, allowed: string[]): { ok: true } | { ok: false; reason: string } {
  return allowed.includes(name) ? { ok: true } : { ok: false, reason: `tool ${name} is not allowed in this mode` };
}
