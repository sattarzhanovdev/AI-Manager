import type { Currency, PriceType, Weekday } from "@all/db";
import { BLOCKS, type FieldValues } from "./questionnaire";

/** Неизменяемый снимок опубликованной анкеты. Его держат в памяти голос и чаты. */
export interface KbSnapshot {
  version: number;
  company: { name: string; nameStress?: string; sphere: string; description: string; advantages: string[] };
  branches: { id: string; name: string; address: string; landmarks?: string; hours: Partial<Record<Weekday, [string, string][]>>; phones: string[] }[];
  services: {
    id: string; name: string; synonyms: string[]; priceType: PriceType;
    priceMin?: number; priceMax?: number; currency: Currency; durationMin?: number; staff: string[];
  }[];
  staff: { id: string; name: string; specialties: string[]; transferPhone?: string }[];
  faq: { id: string; question: string; synonyms: string[]; shortAnswer: string; longAnswer?: string }[];
  booking: Record<string, string>;
  stop: { neverPromise: string[]; topics: string[]; reply: string; words: string[] };
  handoff: { who: string; when: string; how: "transfer" | "callback"; noAnswer: string; urgent?: string };
  style: { assistantName: string; greeting: string; address: string; tone: string; words: string[]; languages: string[] };
  client: { required: string[]; never: string[] };
  objections: Record<string, string>;
  emergencyNumber: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split("\n").map((s) => s.trim()).filter(Boolean) : [];

export interface SnapshotInput {
  version: number;
  fields: FieldValues;
  branches: KbSnapshot["branches"];
  services: KbSnapshot["services"];
  staff: KbSnapshot["staff"];
  faq: KbSnapshot["faq"];
}

export function buildSnapshot(input: SnapshotInput): KbSnapshot {
  const f = input.fields;
  const objections: Record<string, string> = {};
  for (const field of BLOCKS.find((b) => b.key === "objections")?.fields ?? []) {
    const v = str(f[field.key]);
    if (v) objections[field.label] = v;
  }
  const how = str(f["handoff.how"]);
  return {
    version: input.version,
    company: {
      name: str(f["company.name"]),
      nameStress: str(f["company.name_stress"]) || undefined,
      sphere: str(f["company.sphere"]),
      description: str(f["company.description"]),
      advantages: list(f["company.advantages"]),
    },
    branches: input.branches,
    services: input.services,
    staff: input.staff,
    faq: input.faq,
    booking: Object.fromEntries(
      Object.entries(f).filter(([k]) => k.startsWith("booking.")).map(([k, v]) => [k.slice(8), str(v)]),
    ),
    stop: {
      neverPromise: list(f["stop.never_promise"]),
      topics: list(f["stop.topics"]),
      reply: str(f["stop.reply"]) || "Это лучше уточнить у администратора, я передам ваш вопрос.",
      words: list(f["stop.words"]),
    },
    handoff: {
      who: str(f["handoff.who"]),
      when: str(f["handoff.when"]),
      how: how === "transfer" ? "transfer" : "callback",
      noAnswer: str(f["handoff.no_answer"]),
      urgent: str(f["handoff.urgent"]) || undefined,
    },
    style: {
      assistantName: str(f["style.assistant_name"]) || "Ассистент",
      greeting: str(f["style.greeting"]),
      address: str(f["style.address"]) === "name" ? "Обращайся по имени, если клиент его назвал" : "Обращайся на «вы»",
      tone: str(f["style.tone"]) || "friendly",
      words: list(f["style.words"]),
      languages: list(f["style.languages"]).length ? list(f["style.languages"]) : ["ru"],
    },
    client: { required: list(f["client.required"]), never: list(f["client.never"]) },
    objections,
    emergencyNumber: "103",
  };
}
