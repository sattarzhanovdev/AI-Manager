import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getOverview, getMembers } from "@/lib/data/repo";
import { Overview } from "@/components/overview/overview";
import { isSupabase } from "@/lib/env";

export default async function OverviewPage() {
  const s = await requireSession();
  if (s.member.role === "accountant") redirect("/app/billing");
  const [data, members] = await Promise.all([getOverview(s), getMembers(s)]);
  return <Overview data={data} members={members.filter((m) => m.role !== "accountant" && !m.disabledAt).map((m) => ({ userId: m.userId, name: m.name }))} integrationCount={0} me={s.userId} mvp={isSupabase} canKb={s.member.role !== "staff"} />;
}
