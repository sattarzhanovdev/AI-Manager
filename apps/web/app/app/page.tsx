import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getOverview, getMembers, getIntegrations } from "@/lib/data/queries";
import { Overview } from "@/components/overview/overview";

export default async function OverviewPage() {
  const s = await requireSession();
  if (s.member.role === "accountant") redirect("/app/billing");
  const data = getOverview(s);
  return <Overview data={data} members={getMembers().filter((m) => m.role !== "accountant" && !m.disabledAt).map((m) => ({ userId: m.userId, name: m.name }))} integrationCount={getIntegrations().filter((i) => i.status === "connected").length} me={s.userId} />;
}
