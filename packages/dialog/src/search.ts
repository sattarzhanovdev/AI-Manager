import type { KbSnapshot } from "./snapshot";

export interface KbHit {
  kind: "faq" | "service" | "booking" | "company" | "branch";
  id: string;
  text: string;
  source: string;
  score: number;
}

const STOP = new Set(["а", "и", "в", "на", "у", "вы", "вас", "мне", "я", "ли", "это", "по", "с", "к", "о", "как", "что", "а", "есть", "можно", "ну", "да", "у вас", "the"]);

/** Грубая нормализация русского: нижний регистр, без пунктуации, усечение окончаний */
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 5 ? w.slice(0, w.length - 2) : w));
}

function overlap(q: string[], doc: string[]): number {
  if (!q.length || !doc.length) return 0;
  const d = new Set(doc);
  let hit = 0;
  for (const t of q) {
    if (d.has(t)) hit += 1;
    else if (t.length >= 4 && doc.some((x) => x.startsWith(t.slice(0, 4)))) hit += 0.5;
  }
  return hit / q.length;
}

/** Локальный поиск по снимку — без обращения к базе (голос держит снимок в памяти) */
export function searchKb(s: KbSnapshot, query: string, limit = 3): KbHit[] {
  const q = tokens(query);
  const hits: KbHit[] = [];
  for (const f of s.faq) {
    const score = Math.max(overlap(q, tokens(f.question)), ...f.synonyms.map((x) => overlap(q, tokens(x))));
    hits.push({ kind: "faq", id: f.id, text: f.shortAnswer, source: `FAQ: ${f.question}`, score });
  }
  for (const sv of s.services) {
    const score = Math.max(overlap(q, tokens(sv.name)), ...sv.synonyms.map((x) => overlap(q, tokens(x))));
    hits.push({ kind: "service", id: sv.id, text: sv.name, source: `Услуги: ${sv.name}`, score });
  }
  for (const [k, v] of Object.entries(s.booking)) {
    if (v) hits.push({ kind: "booking", id: k, text: v, source: `Запись: ${k}`, score: overlap(q, tokens(v)) * 0.8 });
  }
  return hits.filter((h) => h.score >= 0.34).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function findService(s: KbSnapshot, name: string) {
  const q = tokens(name);
  let best: { sv: KbSnapshot["services"][number]; score: number } | undefined;
  for (const sv of s.services) {
    // доля слов названия услуги, найденных в реплике
    const score = Math.max(overlap(tokens(sv.name), q), ...sv.synonyms.map((x) => overlap(tokens(x), q)));
    if (score > (best?.score ?? 0.6)) best = { sv, score };
  }
  return best?.sv;
}
