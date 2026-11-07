import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getAnalytics, getBranches } from "@/lib/data/queries";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export const metadata = { title: "Аналитика" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  if (s.member.role === "accountant" || s.member.role === "staff") redirect("/app");
  const days = (await searchParams).days === "7" ? 7 : 30;
  return <AnalyticsView data={getAnalytics(s, days)} days={days} branches={getBranches().map((b) => ({ id: b.id, name: b.name }))} />;
}
