import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getCompany, getBranches, getSidebarStats, getNotifications, getMembers, MVP_DISABLED } from "@/lib/data/repo";
import { listConversations, getUsage, getCurrentPlan, getIntegrations } from "@/lib/data/repo";
import { env, isSupabase, mockAuthAllowed } from "@/lib/env";

export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const role = s.member.role;
  // Navigation does not need the full 500-row leads list or the entire
  // questionnaire: load only its badges and flags. Demo user switching is mock-only.
  const [company, branches, sidebar, notifications, members, locale] = await Promise.all([
    getCompany(s), getBranches(s), getSidebarStats(s, role !== "staff" && role !== "accountant"),
    getNotifications(s), mockAuthAllowed ? getMembers(s) : Promise.resolve([]), getLocale(),
  ]);
  // Недоступные разделы скрыты (раздел 05); в Hackathon MVP — ещё и разделы без базы
  const hidden: string[] = isSupabase ? [...MVP_DISABLED] : [];
  if (role === "accountant") hidden.push("overview", "calls", "leads", "inbox", "calendar", "contacts", "knowledge", "assistant", "analytics", "integrations", "team", "settings");
  if (role === "staff") hidden.push("knowledge", "assistant", "integrations", "team", "billing", "settings", "analytics");
  if (role === "admin") hidden.push("billing", "team");

  // Тариф, минуты и интеграции есть только в mock-хранилище; в MVP их не показываем вовсе
  const usage = isSupabase ? null : await getUsage(s);
  const broken = isSupabase ? undefined : (await getIntegrations(s)).find((i) => i.status === "error" || i.status === "reconnect");

  return (
    <AppShell
      company={{ name: company.name, branches: branches.map((b) => ({ id: b.id, name: b.name })) }}
      member={{ name: s.member.name, role, userId: s.userId }}
      canToggleAi={can(role, "toggle_ai")}
      aiMode={company.aiMode}
      minutesLeft={usage ? Math.max(0, usage.minutesTotal - usage.minutesUsed) : 0}
      planName={usage ? (await getCurrentPlan(s)).name : ""}
      counts={{
        chats: isSupabase || role === "accountant" ? 0 : (await listConversations(s)).filter((c) => c.needsHuman && c.state !== "closed").length,
        leads: sidebar.newUnassignedLeads,
        unanswered: sidebar.unansweredCount,
      }}
      notifications={notifications}
      banners={{ limitPct: usage ? (usage.minutesUsed / usage.minutesTotal) * 100 : 0, integrationError: broken?.key, support: s.supportMode, kbLow: sidebar.kbLow }}
      mock={mockAuthAllowed}
      mvp={isSupabase}
      demoEnv={env.DEMO_ENVIRONMENT === "1"}
      locale={locale}
      demoUsers={mockAuthAllowed ? members.filter((m) => !m.disabledAt).map((m) => ({ userId: m.userId, name: m.name, role: m.role })) : []}
      hidden={hidden}
    >
      {children}
    </AppShell>
  );
}
