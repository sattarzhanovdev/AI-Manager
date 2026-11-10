import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { isDisabledInMvp } from "@/lib/data/repo";
import { MvpDisabled } from "@/components/mvp/mvp-disabled";
import { can } from "@/lib/permissions";
import { getMembers, getBranches } from "@/lib/data/repo";
import { TeamView } from "@/components/team/team-view";

export const metadata = { title: "Команда" };

export default async function TeamPage() {
  const s = await requireSession();
  if (isDisabledInMvp("team")) return <MvpDisabled />;
  if (!can(s.member.role, "manage_team")) redirect("/app");
  return <TeamView members={(await getMembers(s))} branches={(await getBranches(s)).map((b) => ({ id: b.id, name: b.name }))} />;
}
