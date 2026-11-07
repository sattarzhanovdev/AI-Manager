import { createClient } from "@supabase/supabase-js";
import { env } from "./env";
import { consume, log, type Handler } from "./queue";
import { callEnded } from "./handlers/call-ended";
import { leadCreated } from "./handlers/notify";
import { kbPublished } from "./handlers/kb-published";
import { chatInbound, chatOutbound } from "./handlers/chat-inbound";

const HANDLERS: Record<string, Handler> = {
  call_ended: callEnded,
  lead_created: leadCreated,
  kb_published: kbPublished,
  chat_inbound: chatInbound,
  chat_outbound: chatOutbound,
  notify: async () => { /* общий канал уведомлений: email/push — фаза 1б */ },
  integration_out: async () => { /* исходящие события CRM — фаза 2 */ },
  demo_summary: async (m) => { log("demo.sms", { to: String((m.message as { phone?: string }).phone ?? "") }); },
  erase_recordings: async (m, sb) => {
    const { paths } = m.message as { paths: string[] };
    if (paths.length) await sb.storage.from("recordings").remove(paths);
  },
};

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ctl = new AbortController();
process.on("SIGTERM", () => ctl.abort());
process.on("SIGINT", () => ctl.abort());

const queues = env.WORKER_QUEUES.split(",").map((q) => q.trim()).filter((q) => HANDLERS[q]);
log("workers.start", { queues });
await Promise.all(queues.map((q) => consume(sb, q, HANDLERS[q]!, ctl.signal)));
