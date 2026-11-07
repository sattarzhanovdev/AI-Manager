import type { KbSnapshot } from "./snapshot";
import { allowedTools, type AiModeKey, type Phase } from "./tools";
import { ASSISTANT_RU } from "./prompt-template";

export const PROMPT_VERSION = "assistant.ru@1.0.0";

const SPHERE_RU: Record<string, string> = {
  autoservice: "автосервис", salon: "салон красоты", clinic: "клиника", dental: "стоматология",
  service: "сервисная компания", polyclinic: "поликлиника", other: "компания",
};
const TONE_RU: Record<string, string> = { friendly: "дружелюбный", business: "деловой", warm: "тёплый, заботливый" };
const MODE_RU: Record<AiModeKey, string> = {
  leads: "сбор заявок", consult: "консультация", booking: "запись", semi: "полуавтомат", demo: "демо",
};

export interface PromptContext {
  channel: "voice" | "chat";
  mode: AiModeKey;
  phase?: Phase;
}

/** Собирает системный промпт для звонка или чата из снимка анкеты */
export function buildPrompt(s: KbSnapshot, ctx: PromptContext): string {
  const tools = allowedTools(ctx.mode, ctx.phase ?? "1a").map((t) => t.name);
  const objections = Object.entries(s.objections).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- нет";
  const vars: Record<string, string> = {
    "assistant.name": s.style.assistantName,
    "company.name": s.company.name,
    "company.sphere": SPHERE_RU[s.company.sphere] ?? s.company.sphere,
    channel: ctx.channel === "voice" ? "по телефону" : "в чате",
    "style.address": s.style.address,
    "style.tone": TONE_RU[s.style.tone] ?? s.style.tone,
    languages: s.style.languages.join(", "),
    "style.words": s.style.words.join(", ") || "—",
    required_fields: s.client.required.join(", ") || "имя и телефон",
    ai_mode: MODE_RU[ctx.mode],
    allowed_tools: tools.join(", "),
    "handoff.extra": s.handoff.when || "—",
    emergency_number: s.emergencyNumber,
    stop_topics: s.stop.topics.join("; ") || "—",
    stop_reply: s.stop.reply,
    never_promise: s.stop.neverPromise.join("; ") || "—",
    objections,
  };
  return ASSISTANT_RU.replace(/\{\{([\w.]+)\}\}/g, (_, k: string) => vars[k] ?? "");
}
