import { getSession } from "@/lib/auth";
import { isSupabase, isDjango } from "@/lib/env";
import { djangoFetch } from "@/lib/django";
import { db, ensureSimulator } from "@/lib/data/mock/store";
import type { RealtimeEvent } from "@/lib/data/types";

export const dynamic = "force-dynamic";

/**
 * Realtime для DATA_SOURCE=mock — SSE-поток событий хранилища.
 * В режиме supabase браузер подписывается на postgres_changes напрямую (RLS фильтрует по компании).
 */
export async function GET(req: Request) {
  // В режиме supabase SSE из памяти процесса не используется (Vercel — несколько инстансов)
  if (isDjango) return djangoEvents(req);
  if (isSupabase) return new Response(null, { status: 204 });
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });
  ensureSimulator();
  const encoder = new TextEncoder();
  let listener: ((e: RealtimeEvent) => void) | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    if (listener) db.listeners.delete(listener);
    if (ping) clearInterval(ping);
  };
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try { controller.enqueue(encoder.encode(chunk)); } catch { cleanup(); }
      };
      req.signal.addEventListener("abort", () => { cleanup(); try { controller.close(); } catch { /* уже закрыт */ } });
      listener = (e) => {
        // Сотрудник получает только свои и свободные заявки
        if (session.member.role === "staff" && (e.type === "lead.created" || e.type === "lead.updated") && e.lead.assigneeId && e.lead.assigneeId !== session.userId) return;
        if (session.member.role === "accountant" && e.type !== "notification") return;
        if (session.member.role === "staff" && (e.type === "message.created" || e.type === "conversation.updated") && e.conversation.assigneeId && e.conversation.assigneeId !== session.userId) return;
        send(`data: ${JSON.stringify(e)}\n\n`);
      };
      db.listeners.add(listener);
      ping = setInterval(() => send(": ping\n\n"), 25_000);
    },
    cancel: cleanup,
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}


async function djangoEvents(req: Request) {
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });
  const initial = await djangoFetch<{ cursor: number; events: RealtimeEvent[] }>("/events/");
  let cursor = initial.cursor;
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stop: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let closed = false;
  const cleanup = () => { closed = true; if (timer) clearInterval(timer); if (stop) clearTimeout(stop); };
  const stream = new ReadableStream({
    start(controller) {
      const close = () => { cleanup(); try { controller.close(); } catch { /* cancelled */ } };
      req.signal.addEventListener("abort", close, { once: true });
      controller.enqueue(encoder.encode(": connected\n\n"));
      timer = setInterval(async () => {
        if (busy || closed) return;
        busy = true;
        try {
          const batch = await djangoFetch<{ cursor: number; events: RealtimeEvent[] }>(`/events/?after=${cursor}`);
          if (closed) return;
          for (const event of batch.events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (!batch.events.length) controller.enqueue(encoder.encode(": ping\n\n"));
          cursor = batch.cursor;
        } catch { close(); } finally { busy = false; }
      }, 2000);
      stop = setTimeout(close, 55_000);
    },
    cancel: cleanup,
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
