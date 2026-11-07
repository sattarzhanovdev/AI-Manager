import { z } from "zod";

export const env = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  WORKER_QUEUES: z.string().default("call_ended,lead_created,kb_published,notify,integration_out,demo_summary,erase_recordings,chat_inbound,chat_outbound"),
}).parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));
