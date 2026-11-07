import { createHmac, timingSafeEqual } from "node:crypto";

/** Общий формат входящего сообщения из любого канала (раздел 28) */
export interface InboundMessage {
  channel: "widget" | "telegram" | "whatsapp" | "instagram" | "facebook";
  externalChatId: string;
  externalMessageId: string;
  name?: string;
  phone?: string;
  text?: string;
  attachments: { kind: "image" | "file" | "voice"; name: string; ref?: string; durationS?: number }[];
  at: string;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function normalizeTelegram(u: Json): InboundMessage | null {
  const m = u.message ?? u.business_message;
  if (!m?.chat) return null;
  const att: InboundMessage["attachments"] = [];
  if (m.voice) att.push({ kind: "voice", name: "voice.ogg", ref: m.voice.file_id, durationS: m.voice.duration });
  if (m.photo?.length) att.push({ kind: "image", name: "photo.jpg", ref: m.photo.at(-1).file_id });
  if (m.document) att.push({ kind: "file", name: m.document.file_name ?? "file", ref: m.document.file_id });
  return {
    channel: "telegram", externalChatId: String(m.chat.id), externalMessageId: String(m.message_id),
    name: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || undefined, phone: m.contact?.phone_number,
    text: m.text ?? m.caption, attachments: att, at: new Date((m.date ?? Date.now() / 1000) * 1000).toISOString(),
  };
}

export function normalizeWhatsApp(body: Json): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of body.entry ?? []) for (const ch of entry.changes ?? []) {
    const v = ch.value ?? {};
    const contact = v.contacts?.[0];
    for (const m of v.messages ?? []) {
      const att: InboundMessage["attachments"] = [];
      if (m.audio) att.push({ kind: "voice", name: "voice.ogg", ref: m.audio.id });
      if (m.image) att.push({ kind: "image", name: "image.jpg", ref: m.image.id });
      if (m.document) att.push({ kind: "file", name: m.document.filename ?? "file", ref: m.document.id });
      out.push({ channel: "whatsapp", externalChatId: m.from, externalMessageId: m.id, name: contact?.profile?.name, phone: `+${m.from}`,
        text: m.text?.body ?? m.image?.caption, attachments: att, at: new Date(Number(m.timestamp) * 1000).toISOString() });
    }
  }
  return out;
}

export function normalizeWidget(b: Json): InboundMessage | null {
  if (!b.session || !b.id) return null;
  return { channel: "widget", externalChatId: String(b.session), externalMessageId: String(b.id), name: b.name, phone: b.phone, text: b.text, attachments: [], at: new Date().toISOString() };
}

/** Meta: X-Hub-Signature-256 = sha256=HMAC(app_secret, raw body) */
export function verifyMeta(appSecret: string, raw: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(raw).digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Сообщения клиента склеиваются, если пауза между ними меньше 3–5 с */
export const BATCH_WINDOW_MS = 4000;
