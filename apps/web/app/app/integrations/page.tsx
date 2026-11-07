import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getIntegrations, getMembers } from "@/lib/data/queries";
import { IntegrationsView } from "@/components/integrations/integrations-view";

export const metadata = { title: "Каналы и интеграции" };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  if (s.member.role === "accountant" || s.member.role === "staff") redirect("/app");
  const members = getMembers().filter((m) => !m.disabledAt && m.role !== "accountant");
  return <IntegrationsView items={getIntegrations()} linked={members.filter((m) => m.telegramLinked).length} total={members.length} openKey={(await searchParams).open}
    canManage={can(s.member.role, "manage_integrations", s.member.permissions)} />;
}
