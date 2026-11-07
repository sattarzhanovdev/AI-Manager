import type { SupabaseClient } from "@supabase/supabase-js";
import { nextRetry } from "@all/integrations";

export interface Message<T = Record<string, unknown>> { msg_id: number; read_ct: number; message: T }
export type Handler = (msg: Message, sb: SupabaseClient) => Promise<void>;

/** Без персональных данных в логах: маскируем телефоны */
export const mask = (s: string) => s.replace(/\+?\d{6,}/g, (m) => `${m.slice(0, 4)}****`);
export const log = (event: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...JSON.parse(mask(JSON.stringify(data))) }));

/**
 * Чтение pgmq через Supabase Queues (схема pgmq_public). Обработчики идемпотентны:
 * сообщение удаляется только после успеха; при ошибке — повтор по расписанию, затем dead-letter.
 */
export async function consume(sb: SupabaseClient, queue: string, handler: Handler, signal: AbortSignal) {
  const q = sb.schema("pgmq_public");
  while (!signal.aborted) {
    const { data, error } = await q.rpc("read", { queue_name: queue, sleep_seconds: 30, n: 10 });
    if (error) { log("queue.read_error", { queue, error: error.message }); await sleep(2000); continue; }
    const msgs = (data ?? []) as Message[];
    if (!msgs.length) { await sleep(1000); continue; }
    for (const m of msgs) {
      const t0 = Date.now();
      try {
        await handler(m, sb);
        await q.rpc("delete", { queue_name: queue, message_id: m.msg_id });
        log("queue.ok", { queue, id: m.msg_id, ms: Date.now() - t0 });
      } catch (e) {
        // Склейка сообщений: не ошибка, просто вернуть в очередь через 2 с
        if (e instanceof Error && e.message === "batching") { await sb.rpc("pgmq_set_vt", { queue_name: queue, msg_id: m.msg_id, vt: 2 }).then(() => undefined, () => undefined); continue; }
        const r = nextRetry(m.read_ct);
        if ("dead" in r) {
          await q.rpc("send", { queue_name: `${queue}_dead`, message: { ...m.message, error: String(e) } });
          await q.rpc("delete", { queue_name: queue, message_id: m.msg_id });
          log("queue.dead", { queue, id: m.msg_id, error: String(e) });
        } else {
          // видимость сообщения продлевается до следующей попытки
          await sb.rpc("pgmq_set_vt", { queue_name: queue, msg_id: m.msg_id, vt: r.delayS }).then(() => undefined, () => undefined);
          log("queue.retry", { queue, id: m.msg_id, in_s: r.delayS, error: String(e) });
        }
      }
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
