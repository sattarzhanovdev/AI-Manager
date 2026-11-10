import { NextResponse } from "next/server";
import { z } from "zod";
import { parseCallback } from "@all/integrations";
import { env, isSupabase, isDjango } from "@/lib/env";
import { db, patchLead } from "@/lib/data/mock/store";

/**
 * Вебхук бота Telegram: кнопки «Взять» и «Перезвонил».
 * Проверяет секрет, отвечает быстро; идемпотентен (повторное «Взять» не меняет ответственного).
 */
const update = z.object({
  update_id: z.number(),
  callback_query: z.object({ id: z.string(), from: z.object({ id: z.number() }), data: z.string() }).optional(),
});
const seen = new Set<number>();

export async function POST(req: Request) {
  // Бот Telegram в Hackathon MVP не подключён; секрет обязателен всегда
  if (isSupabase || isDjango) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!env.TELEGRAM_WEBHOOK_SECRET || req.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = update.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: true });
  const u = parsed.data;
  if (seen.has(u.update_id)) return NextResponse.json({ ok: true });
  seen.add(u.update_id);
  const cb = u.callback_query;
  if (!cb) return NextResponse.json({ ok: true });

  const member = db.members.find((m) => m.telegramLinked && !m.disabledAt && hashTg(m.userId) === cb.from.id) ?? db.members.find((m) => m.telegramLinked && !m.disabledAt);
  const action = parseCallback(cb.data);
  let text = "Готово";
  if (member && action?.action === "take") {
    const lead = db.leads.find((l) => l.id === action.leadId);
    if (lead && !lead.assigneeId) { patchLead(lead.id, { assigneeId: member.userId, status: "in_progress" }, member.userId); text = `Заявка №${lead.number} ваша`; }
    else text = lead ? "Заявку уже взяли" : "Заявка не найдена";
  }
  if (member && action?.action === "called") {
    const call = db.calls.find((c) => c.id === action.callId);
    if (call && !call.callbackDoneAt) call.callbackDoneAt = new Date().toISOString();
    text = "Отмечено: перезвонили";
  }
  if (env.TELEGRAM_BOT_TOKEN) {
    void fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callback_query_id: cb.id, text }) });
  }
  return NextResponse.json({ ok: true, text });
}

// В проде chat_id хранится в profiles.telegram_chat_id; в mock — детерминированный хеш
function hashTg(userId: string) {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
