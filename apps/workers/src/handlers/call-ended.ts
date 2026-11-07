import type { Handler } from "../queue";
import { summarize, classify } from "../postprocess";

/**
 * Пост-обработка звонка: резюме, тип и итог, флаги качества, вопросы без ответа, учёт минут.
 * Идемпотентно: usage_records по ключу call:<id>, резюме перезаписывается.
 */
export const callEnded: Handler = async (m, sb) => {
  const { company_id, call_id } = m.message as { company_id: string; call_id: string };
  const { data: turns } = await sb.from("call_turns").select("speaker, text, start_ms, end_ms").eq("call_id", call_id).eq("company_id", company_id).order("seq");
  const { data: call } = await sb.from("calls").select("billed_seconds, started_at").eq("id", call_id).eq("company_id", company_id).single();
  if (!call) return;
  const t = (turns ?? []).map((x) => ({ speaker: x.speaker as "ai" | "caller" | "operator", text: x.text as string }));
  const { type, outcome, flags, unanswered } = classify(t);
  await sb.from("calls").update({ summary: summarize(t), type, outcome, flags }).eq("id", call_id).eq("company_id", company_id);
  for (const q of unanswered) {
    await sb.rpc("upsert_unanswered", { p_company_id: company_id, p_text: q, p_call_id: call_id }).then(() => undefined, () => undefined);
  }
  await sb.from("usage_records").upsert({
    company_id, kind: "minutes", quantity: Math.ceil((call.billed_seconds as number) / 60), period: String(call.started_at).slice(0, 10),
    source_id: call_id, idempotency_key: `call:${call_id}`,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true });
};
