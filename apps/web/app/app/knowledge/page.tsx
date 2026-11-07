import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getQuestionnaire } from "@/lib/data/queries";
import { KnowledgeView } from "@/components/knowledge/knowledge-view";

export const metadata = { title: "Анкета" };

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  if (s.member.role === "accountant" || s.member.role === "staff") redirect("/app");
  const sp = await searchParams;
  return (
    <KnowledgeView q={getQuestionnaire()} canEdit={can(s.member.role, "edit_questionnaire", s.member.permissions)} canPublish={can(s.member.role, "publish")}
      initialBlock={sp.block ? Number(sp.block) : undefined} unansweredId={sp.unanswered} />
  );
}
