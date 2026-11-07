import { NextResponse } from "next/server";
import { normalizeTelegram, normalizeWhatsApp, normalizeWidget, verifyMeta, type InboundMessage } from "@all/integrations";
import { toE164 } from "@/lib/format";
import { db } from "@/lib/data/mock/store";
import { inbound } from "@/lib/data/mock/chat";

export const dynamic = "force-dynamic";

/**
 * Входящие сообщения каналов (раздел 28): проверка подписи → нормализация → messages + очередь chat_inbound → ответ ≤ 100 мс.
 * В mock-режиме очередь — таймер склейки в памяти; в проде — pgmq, обработка в apps/workers (chat-inbound).
 * Повторная доставка того же сообщения игнорируется (идемпотентность по externalMessageId).
 */
const seen = new Set<string>();

export async function GET(req: Request, { params }: { params: Promise<{ channel: string }> }) {
  // Верификация вебхука Meta
  const { channel } = await params;
  const u = new URL(req.url);
  if (channel === "whatsapp" && u.searchParams.get("hub.verify_token") === process.env.META_VERIFY_TOKEN) return new Response(u.searchParams.get("hub.challenge") ?? "");
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  const raw = await req.text();
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }

  let msgs: InboundMessage[] = [];
  if (channel === "telegram") {
    if (process.env.TELEGRAM_WEBHOOK_SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== process.env.TELEGRAM_WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
    const m = normalizeTelegram(body);
    if (m) msgs = [m];
  } else if (channel === "whatsapp") {
    if (process.env.META_APP_SECRET && !verifyMeta(process.env.META_APP_SECRET, raw, req.headers.get("x-hub-signature-256"))) return new Response("forbidden", { status: 403 });
    msgs = normalizeWhatsApp(body);
  } else if (channel === "widget") {
    const m = normalizeWidget(body);
    if (m) msgs = [m];
  } else {
    return new Response("unknown channel", { status: 404 });
  }

  for (const m of msgs) {
    const key = `${m.channel}:${m.externalMessageId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const phone = m.phone ? toE164(m.phone) : null;
    let contact = phone ? db.contacts.find((c) => c.phone === phone) : db.contacts.find((c) => c.channels.includes(`${m.channel}:${m.externalChatId}`));
    if (!contact) {
      contact = { id: `ct_${Math.random().toString(36).slice(2, 9)}`, phone: phone ?? undefined, name: m.name, channels: [m.channel, `${m.channel}:${m.externalChatId}`], tags: [], lastSeenAt: m.at, interactionsCount: 0, createdAt: m.at };
      db.contacts.unshift(contact);
    }
    inbound({ channel: m.channel, contactId: contact.id, body: m.text, attachments: m.attachments.map((a) => ({ kind: a.kind, name: a.name, durationS: a.durationS })) });
  }
  return NextResponse.json({ ok: true });
}
