import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/lib/auth";
import { isDisabledInMvp } from "@/lib/data/repo";
import { MvpDisabled } from "@/components/mvp/mvp-disabled";
import { getCompany, getBranches, getNumbers, getMembers, getNotificationPrefs, getApiKeys, getAudit } from "@/lib/data/repo";
import { SettingsView } from "@/components/settings/settings-view";
import { isDjango } from "@/lib/env";
import { djangoFetch } from "@/lib/django";
import type { SessionItem } from "@/components/settings/session-list";
import { TABS, type Tab } from "@/components/settings/tabs";

export const metadata = { title: "Настройки" };

export default async function SettingsPage({ params }: { params: Promise<{ tab: string }> }) {
  const s = await requireSession();
  if (isDisabledInMvp("settings")) return <MvpDisabled />;
  if (s.member.role === "staff" || s.member.role === "accountant") redirect("/app");
  const { tab } = await params;
  if (!TABS.includes(tab as Tab)) notFound();
  return (
    <SettingsView tab={tab as Tab} company={(await getCompany(s))} branches={(await getBranches(s))} numbers={(await getNumbers(s))} members={(await getMembers(s))} prefs={(await getNotificationPrefs(s))}
      apiKeys={(await getApiKeys(s))} audit={s.member.role === "owner" ? (await getAudit(s)) : []} sessions={isDjango && tab === "security" ? await djangoFetch<SessionItem[]>("/auth/sessions/") : undefined} me={s.member} isOwner={s.member.role === "owner"} locale={await getLocale()} />
  );
}
