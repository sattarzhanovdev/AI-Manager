import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listConversations, getCompany, getBranches, getUsage, getCurrentPlan, listLeads, getQuestionnaire, getNotifications, getIntegrations, getMembers } from "@/lib/data/queries";
import { env } from "@/lib/env";

export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const company = getCompany();
  const usage = getUsage();
  const q = getQuestionnaire();
  const role = s.member.role;
  // Недоступные разделы скрыты (раздел 05)
  const hidden: string[] = [];
  if (role === "accountant") hidden.push("overview", "calls", "leads", "inbox", "calendar", "contacts", "knowledge", "assistant", "analytics", "integrations", "team", "settings");
  if (role === "staff") hidden.push("knowledge", "assistant", "integrations", "team", "billing", "settings", "analytics");
  if (role === "admin") hidden.push("billing", "team");
  const integrations = getIntegrations();
  const broken = integrations.find((i) => i.status === "error" || i.status === "reconnect");

  return (
    <AppShell
      company={{ name: company.name, branches: getBranches().map((b) => ({ id: b.id, name: b.name })) }}
      member={{ name: s.member.name, role, userId: s.userId }}
      canToggleAi={can(role, "toggle_ai")}
      aiMode={company.aiMode}
      minutesLeft={Math.max(0, usage.minutesTotal - usage.minutesUsed)}
      planName={getCurrentPlan().name}
      counts={{ chats: role === "accountant" ? 0 : listConversations(s).filter((c) => c.needsHuman && c.state !== "closed").length, leads: listLeads(s).filter((l) => l.status === "new" && !l.assigneeId).length, unanswered: role === "staff" ? 0 : q.unanswered.length }}
      notifications={getNotifications()}
      banners={{ limitPct: (usage.minutesUsed / usage.minutesTotal) * 100, integrationError: broken?.key, support: s.supportMode, kbLow: q.draft.completeness < 50 }}
      mock={env.DATA_SOURCE === "mock"}
      demoUsers={getMembers().filter((m) => !m.disabledAt).map((m) => ({ userId: m.userId, name: m.name, role: m.role }))}
      hidden={hidden}
    >
      {children}
    </AppShell>
  );
}
