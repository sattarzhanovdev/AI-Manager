import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getCompany, getBranches, listLeads, getQuestionnaire, getNotifications, getMembers, MVP_DISABLED } from "@/lib/data/repo";
import { listConversations, getUsage, getCurrentPlan, getIntegrations } from "@/lib/data/queries";
import { env, isSupabase, mockAuthAllowed } from "@/lib/env";

export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const role = s.member.role;
  const [company, branches, leads, q, notifications, members, locale] = await Promise.all([
    getCompany(s), getBranches(s), role === "accountant" ? Promise.resolve([]) : listLeads(s),
    role === "staff" || role === "accountant" ? Promise.resolve(null) : getQuestionnaire(s),
    getNotifications(s), getMembers(s), getLocale(),
  ]);
  // Недоступные разделы скрыты (раздел 05); в Hackathon MVP — ещё и разделы без базы
  const hidden: string[] = isSupabase ? [...MVP_DISABLED] : [];
  if (role === "accountant") hidden.push("overview", "calls", "leads", "inbox", "calendar", "contacts", "knowledge", "assistant", "analytics", "integrations", "team", "settings");
  if (role === "staff") hidden.push("knowledge", "assistant", "integrations", "team", "billing", "settings", "analytics");
  if (role === "admin") hidden.push("billing", "team");

  // Тариф, минуты и интеграции есть только в mock-хранилище; в MVP их не показываем вовсе
  const usage = isSupabase ? null : getUsage();
  const broken = isSupabase ? undefined : getIntegrations().find((i) => i.status === "error" || i.status === "reconnect");

  return (
    <AppShell
      company={{ name: company.name, branches: branches.map((b) => ({ id: b.id, name: b.name })) }}
      member={{ name: s.member.name, role, userId: s.userId }}
      canToggleAi={can(role, "toggle_ai")}
      aiMode={company.aiMode}
      minutesLeft={usage ? Math.max(0, usage.minutesTotal - usage.minutesUsed) : 0}
      planName={usage ? getCurrentPlan().name : ""}
      counts={{
        chats: isSupabase || role === "accountant" ? 0 : listConversations(s).filter((c) => c.needsHuman && c.state !== "closed").length,
        leads: leads.filter((l) => l.status === "new" && !l.assigneeId).length,
        unanswered: q?.unanswered.length ?? 0,
      }}
      notifications={notifications}
      banners={{ limitPct: usage ? (usage.minutesUsed / usage.minutesTotal) * 100 : 0, integrationError: broken?.key, support: s.supportMode, kbLow: !!q && q.draft.completeness < 50 }}
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
