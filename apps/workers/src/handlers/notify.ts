import { telegramNotify, type Ctx, type DomainEvent } from "@all/integrations";
import { env } from "../env";
import type { Handler } from "../queue";

/** Новая заявка → Telegram сотрудникам ≤ 10 с; жалобы и срочные повторяются через 15 мин (sla-sweep) */
export const leadCreated: Handler = async (m, sb) => {
  const { company_id, lead_id } = m.message as { company_id: string; lead_id: string };
  const { data: lead } = await sb.from("leads").select("id, number, title, priority, type, contact_id").eq("id", lead_id).eq("company_id", company_id).single();
  if (!lead) return;
  const { data: chats } = await sb.from("memberships").select("user_id, profiles!inner(telegram_chat_id)").eq("company_id", company_id).is("disabled_at", null);
  const chatIds = (chats ?? []).map((c) => (c as unknown as { profiles: { telegram_chat_id: number | null } }).profiles.telegram_chat_id).filter((x): x is number => !!x);
  const event: DomainEvent = lead.type === "complaint"
    ? { type: "complaint", leadId: lead.id, number: lead.number, title: lead.title, url: `${env.APP_URL}/app/leads?open=${lead.id}` }
    : { type: "lead.created", leadId: lead.id, number: lead.number, title: lead.title, urgent: lead.priority === "urgent", url: `${env.APP_URL}/app/leads?open=${lead.id}` };
  const ctx: Ctx = {
    companyId: company_id, integrationId: "telegram_notify", fetch,
    secret: async () => env.TELEGRAM_BOT_TOKEN ?? "",
    log: async (e) => { await sb.from("integration_logs").insert({ company_id, integration_id: await integrationId(sb, company_id), ...e }); },
  };
  if (env.TELEGRAM_BOT_TOKEN) await telegramNotify.push!(ctx, event, { chatIds, events: ["lead.created", "complaint", "lead.urgent", "call.missed"] });
  await sb.from("notifications").insert((chats ?? []).map((c) => ({ company_id, user_id: (c as { user_id: string }).user_id, kind: lead.type === "complaint" ? "complaint" : "lead_new", title: `Новая заявка №${lead.number}: ${lead.title}`, entity: "lead", entity_id: lead.id })));
};

async function integrationId(sb: Parameters<Handler>[1], companyId: string) {
  const { data } = await sb.from("integrations").select("id").eq("company_id", companyId).eq("key", "telegram_notify").maybeSingle();
  return data?.id;
}
