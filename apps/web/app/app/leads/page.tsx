import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { listLeads, getMembers } from "@/lib/data/queries";
import { LeadsView } from "@/components/leads/leads-view";

export const metadata = { title: "Заявки" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  if (s.member.role === "accountant") redirect("/app/billing");
  const sp = await searchParams;
  const members = getMembers().filter((m) => m.role !== "accountant" && !m.disabledAt).map((m) => ({ userId: m.userId, name: m.name }));
  return <LeadsView leads={listLeads(s)} members={members} me={s.userId} initial={{ view: sp.view, open: sp.open, status: sp.status, create: sp.create }} />;
}
