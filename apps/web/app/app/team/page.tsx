import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getMembers, getBranches } from "@/lib/data/queries";
import { TeamView } from "@/components/team/team-view";

export const metadata = { title: "Команда" };

export default async function TeamPage() {
  const s = await requireSession();
  if (!can(s.member.role, "manage_team")) redirect("/app");
  return <TeamView members={getMembers()} branches={getBranches().map((b) => ({ id: b.id, name: b.name }))} />;
}
