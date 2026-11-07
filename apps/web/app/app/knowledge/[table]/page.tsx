import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getQuestionnaire } from "@/lib/data/queries";
import { TableEditor } from "@/components/knowledge/table-editor";

export default async function KbTablePage({ params, searchParams }: { params: Promise<{ table: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  if (s.member.role === "accountant" || s.member.role === "staff") redirect("/app");
  const { table } = await params;
  if (table !== "services" && table !== "staff" && table !== "faq") notFound();
  const sp = await searchParams;
  const q = getQuestionnaire();
  return (
    <TableEditor key={table} table={table} services={q.services} staff={q.staff} faq={q.faq} branches={q.branches.map((b) => ({ id: b.id, name: b.name }))}
      canEdit={can(s.member.role, "edit_questionnaire", s.member.permissions)} prefillQuestion={sp.new} />
  );
}
