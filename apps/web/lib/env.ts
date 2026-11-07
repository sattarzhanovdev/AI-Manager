import "server-only";
import { z } from "zod";

// Все переменные проверяются при старте. Сервисный ключ доступен только на сервере.
const schema = z.object({
  DATA_SOURCE: z.enum(["mock", "supabase"]).default("mock"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.DATA_SOURCE === "supabase" && (!v.SUPABASE_URL || !v.SUPABASE_ANON_KEY)) {
    ctx.addIssue({ code: "custom", message: "DATA_SOURCE=supabase требует SUPABASE_URL и SUPABASE_ANON_KEY" });
  }
});

// Пустые строки из .env считаем незаданными
export const env = schema.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));
