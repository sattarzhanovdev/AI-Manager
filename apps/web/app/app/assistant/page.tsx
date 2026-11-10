import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getAssistant, getNumbers, getCurrentPlan, getMembers } from "@/lib/data/repo";
import { isSupabase, isDjango, llmConfig } from "@/lib/env";
import { AssistantView } from "@/components/assistant/assistant-view";

export const metadata = { title: "Ассистент" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  if (s.member.role === "accountant" || s.member.role === "staff") redirect("/app");
  const sp = await searchParams;
  const [settings, numbers, plan, members] = await Promise.all([getAssistant(s), getNumbers(s), getCurrentPlan(s), getMembers(s)]);
  const llm = llmConfig();
  return (
    <AssistantView settings={settings} numbers={numbers} plan={plan} canEdit={can(s.member.role, "publish")} autoTest={sp.test === "1"}
      members={members.filter((m) => m.role !== "accountant" && !m.disabledAt).map((m) => ({ userId: m.userId, name: m.name }))}
      engine={{ llm: !isDjango && !!llm, model: llm?.model, mock: !isSupabase && !isDjango }} />
  );
}
