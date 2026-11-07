import { BATCH_WINDOW_MS } from "@all/integrations";
import { initialState, respondOffline, type DialogState, type KbSnapshot } from "@all/dialog";
import type { Handler } from "../queue";
import { env } from "../env";

/**
 * Чаты (раздел 28): склейка сообщений клиента (пауза 3–5 с), расшифровка голосовых,
 * состояние диалога: ai → отвечает; draft → черновик оператору; operator → молчит; closed → новый диалог.
 * Ответ — тот же движок диалога со стилем чата; адаптер канала проверяет 24-часовое окно и повторяет до 24 ч.
 */
export class NotYet extends Error {}

export const chatInbound: Handler = async (m, sb) => {
  const { company_id, conversation_id } = m.message as { company_id: string; conversation_id: string };
  const { data: conv } = await sb.from("conversations").select("id, state, channel_id, contact_id, external_id, window_expires_at").eq("id", conversation_id).eq("company_id", company_id).single();
  if (!conv || conv.state === "operator" || conv.state === "closed") return; // оператор ведёт — AI молчит

  const { data: msgs } = await sb.from("messages").select("id, author, body, transcript, attachments, created_at, status").eq("conversation_id", conversation_id).order("created_at", { ascending: true }).limit(50);
  const list = msgs ?? [];
  const last = list.at(-1);
  if (!last || last.author !== "client") return; // уже ответили (идемпотентность)
  if (Date.now() - new Date(last.created_at).getTime() < BATCH_WINDOW_MS) throw new NotYet("batching"); // ждём паузу клиента

  const lastOut = [...list].reverse().findIndex((x) => x.author !== "client");
  const batch = (lastOut < 0 ? list : list.slice(list.length - lastOut)).map((x) => x.transcript ?? x.body ?? "").join(" ").trim();
  const { data: company } = await sb.from("companies").select("ai_mode").eq("id", company_id).single();
  if (company?.ai_mode === "off" || company?.ai_mode === "all_human") return;
  const { data: snap } = await sb.rpc("get_snapshot", { p_company_id: company_id });
  if (!snap) return;
  const { data: stateRow } = await sb.from("conversations").select("dialog_state").eq("id", conversation_id).maybeSingle();
  const prev = (stateRow as { dialog_state?: DialogState } | null)?.dialog_state ?? initialState();
  // В проде — LLM_PRIMARY с buildPrompt(channel: "chat") и функциями; детерминированный движок — резерв при отказе провайдера
  const reply = respondOffline(snap as KbSnapshot, batch, prev, { channel: "chat", mode: company?.ai_mode === "leads_only" ? "leads" : "consult" });

  const draft = conv.state === "draft";
  await sb.from("messages").insert({ company_id, conversation_id, direction: "out", author: "ai", body: reply.text, status: draft ? "draft" : "queued", external_id: `ai:${last.id}` });
  await sb.from("conversations").update({ last_message_at: new Date().toISOString(), dialog_state: reply.state }).eq("id", conversation_id);
  if (draft) return;
  if (reply.handoff) await sb.from("notifications").insert({ company_id, kind: "chat_takeover", title: "Нужен человек в чате", entity: "conversation", entity_id: conversation_id });
  await sb.schema("pgmq_public").rpc("send", { queue_name: "chat_outbound", message: { company_id, conversation_id, external_id: `ai:${last.id}` } });
};

/** Отправка в канал: вне окна Meta — только шаблон; ошибки → повтор по расписанию (до 12 ч), затем dead-letter */
export const chatOutbound: Handler = async (m, sb) => {
  const { company_id, conversation_id, external_id } = m.message as { company_id: string; conversation_id: string; external_id: string };
  const { data: msg } = await sb.from("messages").select("id, body, status").eq("conversation_id", conversation_id).eq("external_id", external_id).single();
  if (!msg || msg.status === "sent" || msg.status === "delivered") return;
  const { data: conv } = await sb.from("conversations").select("external_id, window_expires_at, channels(type, credentials_ref)").eq("id", conversation_id).eq("company_id", company_id).single();
  const ch = (conv as unknown as { channels: { type: string } } | null)?.channels;
  if (!conv || !ch) return;
  if (["whatsapp", "instagram", "facebook"].includes(ch.type) && (!conv.window_expires_at || new Date(conv.window_expires_at).getTime() < Date.now())) {
    await sb.from("messages").update({ status: "failed" }).eq("id", msg.id); // свободный текст вне окна не отправляем
    return;
  }
  if (ch.type === "telegram" && env.TELEGRAM_BOT_TOKEN) {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: conv.external_id, text: msg.body }) });
    if (!r.ok) throw new Error(`telegram ${r.status}`);
  }
  await sb.from("messages").update({ status: "sent" }).eq("id", msg.id);
};
