import type { z } from "zod";

export type IntegrationKey =
  | "telegram_notify" | "telegram" | "widget" | "whatsapp" | "instagram" | "facebook" | "google_calendar" | "google_sheets"
  | "bitrix24" | "amocrm" | "yclients" | "altegio" | "mis" | "webhook";

export interface Ctx {
  companyId: string;
  integrationId: string;
  /** Чтение секрета из Vault по ссылке (только сервер) */
  secret: (ref: string) => Promise<string>;
  log: (entry: { direction: "in" | "out"; event: string; status: "ok" | "error" | "retrying" | "dead"; ms: number; error?: string }) => Promise<void>;
  fetch: typeof fetch;
}

export type DomainEvent =
  | { type: "lead.created"; leadId: string; number: number; title: string; contactName?: string; phone?: string; urgent: boolean; url: string }
  | { type: "lead.urgent"; leadId: string; number: number; title: string; phone?: string; url: string }
  | { type: "call.missed"; callId: string; phone: string; url: string }
  | { type: "complaint"; leadId: string; number: number; title: string; url: string }
  | { type: "limit"; ratio: number; url: string }
  | { type: "integration.error"; key: string; url: string };

export interface Integration<Config, Creds = unknown> {
  key: IntegrationKey;
  configSchema: z.ZodType<Config>;
  connect(ctx: Ctx, input: unknown): Promise<{ credsRef: string; config: Config }>;
  disconnect(ctx: Ctx): Promise<void>;
  healthcheck(ctx: Ctx, config: Config): Promise<{ ok: boolean; detail?: string }>;
  handleWebhook?(ctx: Ctx, req: Request, config: Config): Promise<Response>;
  push?(ctx: Ctx, event: DomainEvent, config: Config & { creds?: Creds }): Promise<void>;
  pull?(ctx: Ctx, since: Date, config: Config): Promise<void>;
}
