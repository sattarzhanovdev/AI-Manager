import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { listCalls, getBranches, getNumbers, getCompany } from "@/lib/data/queries";
import { CallsView } from "@/components/calls/calls-view";

export const metadata = { title: "Звонки" };

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  if (s.member.role === "accountant") redirect("/app/billing");
  const sp = await searchParams;
  return (
    <CallsView calls={listCalls(s)} branches={getBranches().map((b) => ({ id: b.id, name: b.name }))} numbers={getNumbers().map((n) => ({ id: n.id, e164: n.e164 }))}
      initial={{ view: sp.view, open: sp.open, outcome: sp.outcome, hour: sp.hour }} tz={getCompany().timezone} />
  );
}
