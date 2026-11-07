import { z } from "zod";
import type { Ctx, DomainEvent, Integration } from "../types";

/**
 * Telegram-уведомления (фаза 1а): бот платформы пишет сотрудникам о заявках, жалобах и пропущенных.
 * Кнопки «Взять» и «Перезвонил» обрабатываются вебхуком /api/webhooks/telegram.
 */
const config = z.object({ chatIds: z.array(z.number()).default([]), events: z.array(z.string()).default(["lead.created", "lead.urgent", "complaint", "call.missed"]) });
export type TelegramNotifyConfig = z.infer<typeof config>;

const API = "https://api.telegram.org";

export function renderEvent(e: DomainEvent): { text: string; buttons: { text: string; data?: string; url?: string }[] } {
  switch (e.type) {
    case "lead.created":
      return {
        text: `${e.urgent ? "🔴 Срочная заявка" : "🆕 Новая заявка"} №${e.number}\n${e.title}${e.contactName ? `\n${e.contactName}` : ""}${e.phone ? ` · ${e.phone}` : ""}`,
        buttons: [{ text: "Взять", data: `take:${e.leadId}` }, { text: "Открыть", url: e.url }],
      };
    case "lead.urgent":
    case "complaint":
      return { text: `🔴 ${e.type === "complaint" ? "Жалоба" : "Срочно"} №${e.number}\n${e.title}\nНикто не взял — напоминаем.`, buttons: [{ text: "Взять", data: `take:${e.leadId}` }, { text: "Открыть", url: e.url }] };
    case "call.missed":
      return { text: `📞 Пропущенный звонок\n${e.phone}`, buttons: [{ text: "Перезвонил", data: `called:${e.callId}` }, { text: "Открыть", url: e.url }] };
    case "limit":
      return { text: `⚠️ Израсходовано ${Math.round(e.ratio * 100)}% минут`, buttons: [{ text: "Докупить", url: e.url }] };
    case "integration.error":
      return { text: `⚠️ Ошибка интеграции «${e.key}»`, buttons: [{ text: "Исправить", url: e.url }] };
  }
}

async function call(ctx: Ctx, token: string, method: string, body: unknown) {
  const t0 = Date.now();
  const res = await ctx.fetch(`${API}/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ms = Date.now() - t0;
  if (!res.ok) {
    const err = await res.text();
    await ctx.log({ direction: "out", event: method, status: "error", ms, error: err.slice(0, 300) });
    throw Object.assign(new Error(`telegram ${method} ${res.status}`), { status: res.status });
  }
  await ctx.log({ direction: "out", event: method, status: "ok", ms });
  return res.json() as Promise<unknown>;
}

export const telegramNotify: Integration<TelegramNotifyConfig, { token: string }> = {
  key: "telegram_notify",
  configSchema: config,
  async connect() {
    // Бот платформы общий: токен в Vault платформы, сотрудники привязываются по одноразовой ссылке
    return { credsRef: "platform:telegram_bot", config: config.parse({}) };
  },
  async disconnect() { /* сотрудники отвязываются по одному */ },
  async healthcheck(ctx) {
    const token = await ctx.secret("platform:telegram_bot");
    const res = await ctx.fetch(`${API}/bot${token}/getMe`);
    return { ok: res.ok, detail: res.ok ? undefined : `getMe ${res.status}` };
  },
  async push(ctx, event, cfg) {
    if (!cfg.events.includes(event.type)) return;
    const token = await ctx.secret("platform:telegram_bot");
    const { text, buttons } = renderEvent(event);
    const reply_markup = { inline_keyboard: [buttons.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }))] };
    for (const chat_id of cfg.chatIds) await call(ctx, token, "sendMessage", { chat_id, text, reply_markup });
  },
};

/** Разбор callback_query: «take:<leadId>» или «called:<callId>» */
export function parseCallback(data: string): { action: "take"; leadId: string } | { action: "called"; callId: string } | null {
  const [a, id] = data.split(":");
  if (!id) return null;
  if (a === "take") return { action: "take", leadId: id };
  if (a === "called") return { action: "called", callId: id };
  return null;
}
