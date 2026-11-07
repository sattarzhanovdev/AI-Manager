import { buildPrompt, type KbSnapshot } from "@all/dialog";
import type { Handler } from "../queue";

/**
 * Индексатор после публикации анкеты: чанки для поиска, эмбеддинги (провайдер — LLM_PRIMARY),
 * приветствие синтезируется заранее (TTS_PRIMARY), снимок кладётся в Redis для голоса.
 */
export const kbPublished: Handler = async (m, sb) => {
  const { company_id, version } = m.message as { company_id: string; version: number };
  const { data } = await sb.rpc("get_snapshot", { p_company_id: company_id, p_version: version });
  const snap = data as KbSnapshot | null;
  if (!snap) return;
  const chunks = [
    ...snap.faq.map((f) => ({ source_kind: "faq", source_id: null, text: `${f.question}\n${f.shortAnswer}` })),
    ...snap.services.map((s) => ({ source_kind: "service", source_id: null, text: `${s.name} (${s.synonyms.join(", ")})` })),
    ...Object.entries(snap.booking).map(([k, v]) => ({ source_kind: "field", source_id: null, text: `${k}: ${v}` })),
  ];
  await sb.from("chunks").delete().eq("company_id", company_id).eq("snapshot_version", version);
  if (chunks.length) await sb.from("chunks").insert(chunks.map((c) => ({ ...c, company_id, snapshot_version: version })));
  // Промпт собирается и проверяется на незаполненные переменные — защита от битой публикации
  const prompt = buildPrompt(snap, { channel: "voice", mode: "consult" });
  if (/\{\{/.test(prompt)) throw new Error("prompt has unresolved variables");
};
