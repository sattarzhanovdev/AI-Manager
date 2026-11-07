import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { requireSession } from "@/lib/auth";
import { isDisabledInMvp } from "@/lib/data/repo";
import { MvpDisabled } from "@/components/mvp/mvp-disabled";
import { getCompany, getBranches, getNumbers, getMembers, getNotificationPrefs, getApiKeys, getAudit } from "@/lib/data/queries";
import { SettingsView } from "@/components/settings/settings-view";
import { TABS, type Tab } from "@/components/settings/tabs";

export const metadata = { title: "Настройки" };

export default async function SettingsPage({ params }: { params: Promise<{ tab: string }> }) {
  const s = await requireSession();
  if (isDisabledInMvp("settings")) return <MvpDisabled />;
  if (s.member.role === "staff" || s.member.role === "accountant") redirect("/app");
  const { tab } = await params;
  if (!TABS.includes(tab as Tab)) notFound();
  return (
    <SettingsView tab={tab as Tab} company={getCompany()} branches={getBranches()} numbers={getNumbers()} members={getMembers()} prefs={getNotificationPrefs()}
      apiKeys={getApiKeys()} audit={getAudit()} me={s.member} isOwner={s.member.role === "owner"} locale={await getLocale()} />
  );
}
