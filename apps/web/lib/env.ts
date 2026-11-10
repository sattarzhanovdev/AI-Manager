import "server-only";
import { z } from "zod";

// Все переменные проверяются при старте. Сервисный ключ и ключи LLM доступны только на сервере.
const int = (d: number) => z.coerce.number().int().positive().default(d);
const schema = z.object({
  DATA_SOURCE: z.enum(["mock", "supabase", "django"]).default("mock"),
  DJANGO_API_URL: z.string().url().default("http://127.0.0.1:8000/api/v1"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  /** Метка «Demo Environment» в кабинете */
  DEMO_ENVIRONMENT: z.enum(["0", "1"]).default("1"),
  /** Mock-вход (код 000000, переключатель ролей) в production-сборке выключен, пока явно не разрешён */
  ALLOW_MOCK_AUTH: z.enum(["0", "1"]).default("0"),
  // LLM: anthropic | openai | none. По умолчанию — тот, чей ключ задан.
  LLM_PROVIDER: z.enum(["anthropic", "openai", "none"]).optional(),
  LLM_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  // Ограничения частоты и расходов AI
  AI_RATE_PER_USER_MINUTE: int(20),
  AI_RATE_PER_COMPANY_DAY: int(600),
  AI_DAILY_TOKEN_BUDGET: int(400_000),
  AI_MAX_OUTPUT_TOKENS: int(350),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  CHAT_WEBHOOK_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
}).transform((v) => ({
  ...v,
  SUPABASE_URL: v.SUPABASE_URL ?? v.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_ANON_KEY: v.SUPABASE_ANON_KEY ?? v.NEXT_PUBLIC_SUPABASE_ANON_KEY,
})).superRefine((v, ctx) => {
  if (v.DATA_SOURCE === "supabase" && (!v.SUPABASE_URL || !v.SUPABASE_ANON_KEY)) {
    ctx.addIssue({ code: "custom", message: "DATA_SOURCE=supabase требует SUPABASE_URL и SUPABASE_ANON_KEY" });
  }
});

// Пустые строки из .env считаем незаданными
export const env = schema.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));

export const isSupabase = env.DATA_SOURCE === "supabase";

/** Mock-вход разрешён только в разработке или по явному флагу */
export const mockAuthAllowed = env.DATA_SOURCE === "mock" && (process.env.NODE_ENV !== "production" || env.ALLOW_MOCK_AUTH === "1");

export type LlmConfig = { provider: "anthropic" | "openai"; model: string; key: string } | null;

export function llmConfig(): LlmConfig {
  const p = env.LLM_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "anthropic" : env.OPENAI_API_KEY ? "openai" : "none");
  if (p === "anthropic" && env.ANTHROPIC_API_KEY) return { provider: "anthropic", model: env.LLM_MODEL ?? "claude-haiku-5-5", key: env.ANTHROPIC_API_KEY };
  if (p === "openai" && env.OPENAI_API_KEY) return { provider: "openai", model: env.LLM_MODEL ?? "gpt-4.1-mini", key: env.OPENAI_API_KEY };
  return null;
}

export const isDjango = env.DATA_SOURCE === "django";
