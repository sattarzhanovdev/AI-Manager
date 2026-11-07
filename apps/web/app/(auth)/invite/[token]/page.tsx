import { getTranslations } from "next-intl/server";
import { InviteAccept } from "@/components/auth/invite-accept";
import { notFound } from "next/navigation";
import { getCompany } from "@/lib/data/queries";
import { isSupabase } from "@/lib/env";

export const metadata = { title: "Приглашение" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  // Приглашения в MVP не используются: аккаунты создаёт provisioning-скрипт
  if (isSupabase) notFound();
  const { token } = await params;
  const t = await getTranslations("auth");
  const expired = token.startsWith("exp");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-medium tracking-[-0.03em]">{t("inviteTitle")}</h1>
      {expired ? <p className="text-[13px] text-danger">{t("inviteExpired")}</p> : (
        <>
          <p className="text-[13px] text-fg-muted">{t("inviteText", { company: getCompany().name, role: "Сотрудник" })}</p>
          <InviteAccept token={token} />
        </>
      )}
    </div>
  );
}
