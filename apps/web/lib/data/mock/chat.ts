import "server-only";
import { initialState, respondOffline } from "@all/dialog";
import type { Attachment, ChannelType, ChatMessage, Conversation } from "@all/db";
import { db, draftSnapshot, emit, publishedSnapshot } from "./store";

/**
 * Чаты (раздел 28) для DATA_SOURCE=mock — тот же порядок, что у воркера apps/workers/chat:
 * сообщение клиента → склейка 3–5 с → состояние диалога:
 *   ai → отвечает движок; draft → черновик оператору; operator → молчит; closed → новый диалог.
 * Ответ — тот же движок диалога со стилем чата; голосовые расшифровываются.
 */

const BATCH_MS = 3500;
const rid = () => Math.random().toString(36).slice(2, 10);

export function preview(m: ChatMessage): string {
  if (m.body) return m.body;
  const a = m.attachments[0];
  return a?.kind === "voice" ? "🎤 Голосовое" : a ? "📎 Вложение" : "";
}

export function pushMessage(conv: Conversation, m: Omit<ChatMessage, "id" | "createdAt" | "conversationId">): ChatMessage {
  const msg: ChatMessage = { ...m, id: `ms_${rid()}`, conversationId: conv.id, createdAt: new Date().toISOString() };
  db.messages.push(msg);
  if (msg.status !== "draft") {
    conv.lastMessageAt = msg.createdAt;
    conv.lastMessage = preview(msg);
    if (msg.author === "client") conv.unread += 1;
  }
  emit({ type: "message.created", message: msg, conversation: conv });
  return msg;
}

/** Нормализованное входящее сообщение (вебхук канала или симулятор). Ответ вебхуку — сразу, работа — асинхронно. */
export function inbound(input: { channel: ChannelType; contactId?: string; conversationId?: string; body?: string; attachments?: Attachment[] }): Conversation {
  let conv = input.conversationId ? db.conversations.find((c) => c.id === input.conversationId) : db.conversations.find((c) => c.contactId === input.contactId && c.channel === input.channel && c.state !== "closed");
  if (!conv || conv.state === "closed") {
    const contact = db.contacts.find((c) => c.id === (input.contactId ?? conv?.contactId));
    conv = {
      id: `cv_${rid()}`, channel: input.channel, contactId: contact?.id, contactName: contact?.name, contactPhone: contact?.phone,
      state: "ai", lastMessageAt: new Date().toISOString(), lastMessage: "", unread: 0, needsHuman: false, tags: [],
    };
    db.conversations.unshift(conv);
  }
  // Входящее сообщение клиента открывает/продлевает 24-часовое окно Meta
  if (conv.channel === "whatsapp" || conv.channel === "instagram" || conv.channel === "facebook") conv.windowExpiresAt = new Date(Date.now() + 24 * 3600_000).toISOString();
  const voice = input.attachments?.find((a) => a.kind === "voice");
  pushMessage(conv, {
    direction: "in", author: "client", body: input.body, attachments: input.attachments ?? [], status: "delivered",
    transcript: voice ? input.body ?? "Здравствуйте, подскажите, сколько стоит замена масла?" : undefined,
  });
  schedule(conv.id);
  return conv;
}

function schedule(convId: string) {
  const prev = db.chatTimers.get(convId);
  if (prev) clearTimeout(prev);
  db.chatTimers.set(convId, setTimeout(() => { db.chatTimers.delete(convId); void processBatch(convId); }, BATCH_MS));
}

/** Обработка склеенной пачки сообщений клиента */
export async function processBatch(convId: string) {
  const conv = db.conversations.find((c) => c.id === convId);
  if (!conv) return;
  if (conv.state === "operator" || conv.state === "closed") return; // оператор ведёт — AI молчит
  const history = db.messages.filter((m) => m.conversationId === convId && m.status !== "draft");
  const lastOut = [...history].reverse().findIndex((m) => m.author !== "client");
  const batch = (lastOut < 0 ? history : history.slice(history.length - lastOut)).filter((m) => m.author === "client");
  if (!batch.length) return;
  const text = batch.map((m) => m.transcript ?? m.body ?? (m.attachments.length ? "[вложение]" : "")).join(" ").trim();
  const mode = db.company.aiMode;
  if (mode === "off" || mode === "all_human") { conv.needsHuman = true; emit({ type: "conversation.updated", conversation: conv }); return; }
  const snap = conv.id.startsWith("cv_test") ? draftSnapshot() : publishedSnapshot();
  const reply = respondOffline(snap, text, db.chatStates.get(convId) ?? initialState(), { channel: "chat", mode: mode === "leads_only" ? "leads" : "consult" });
  db.chatStates.set(convId, reply.state);
  // Фото и файлы AI не оценивает — прикладывает к заявке
  const hasAttachment = batch.some((m) => m.attachments.some((a) => a.kind !== "voice"));
  const body = hasAttachment && !reply.handoff ? `Спасибо, вложение получила и передам мастеру. ${reply.text}` : reply.text;

  if (conv.state === "draft") {
    // Режим «черновик»: ответ готовится оператору ≤ 5 с, не отправляется
    for (let i = db.messages.length - 1; i >= 0; i--) {
      const m = db.messages[i]!;
      if (m.conversationId === convId && m.status === "draft") db.messages.splice(i, 1);
    }
    pushMessage(conv, { direction: "out", author: "ai", body, attachments: [], status: "draft" });
    conv.needsHuman = true;
  } else {
    pushMessage(conv, { direction: "out", author: "ai", body, attachments: [], status: "delivered" });
    if (reply.handoff) {
      conv.needsHuman = true;
      const n = { id: `nt_${rid()}`, kind: "chat_takeover" as const, title: `Нужен человек в чате: ${conv.contactName ?? conv.contactPhone ?? ""}`, href: `/app/inbox?open=${conv.id}`, createdAt: new Date().toISOString() };
      db.notifications.unshift(n);
      emit({ type: "notification", notification: n });
    }
    if (reply.toolCalls.some((t) => t.name === "create_lead" && t.status === "ok")) {
      pushMessage(conv, { direction: "out", author: "system", body: "AI создал заявку", attachments: [], status: "delivered" });
    }
  }
  emit({ type: "conversation.updated", conversation: conv });
}

/** Симулятор входящих сообщений: раз в ~55 с, пока открыт кабинет */
export function ensureChatSimulator() {
  if (db.chatSimulator || process.env.MOCK_SIMULATOR === "off") return;
  const phrases = ["Здравствуйте! Сколько стоит замена масла?", "До скольки вы сегодня работаете?", "Можно записаться на диагностику завтра?", "Где вы находитесь?", "Есть ли гарантия на ремонт?", "Хочу поговорить с менеджером"];
  db.chatSimulator = setInterval(() => {
    if (db.listeners.size === 0) return;
    const contact = db.contacts[Math.floor(Math.random() * 60)]!;
    const channel: ChannelType = Math.random() < 0.5 ? "telegram" : "widget";
    inbound({ channel, contactId: contact.id, body: phrases[Math.floor(Math.random() * phrases.length)] });
  }, 55_000);
}
