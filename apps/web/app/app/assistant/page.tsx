import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getAssistant, getNumbers, getCurrentPlan, getMembers } from "@/lib/data/queries";
import { AssistantView } from "@/components/assistant/assistant-view";

export const metadata = { title: "Ассистент" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  if (s.member.role === "accountant" || s.member.role === "staff") redirect("/app");
  const sp = await searchParams;
  return (
    <AssistantView settings={getAssistant()} numbers={getNumbers()} plan={getCurrentPlan()} canEdit={can(s.member.role, "publish")} autoTest={sp.test === "1"}
      members={getMembers().filter((m) => m.role !== "accountant" && !m.disabledAt).map((m) => ({ userId: m.userId, name: m.name }))} />
  );
}
