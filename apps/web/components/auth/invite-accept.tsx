"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, toast } from "@all/ui";
import { acceptInvite } from "@/lib/actions";

/** Принятие приглашения сразу открывает кабинет нужной компании */
export function InviteAccept({ token }: { token: string }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button variant="primary" className="h-10 justify-center" loading={pending}
      onClick={() => start(async () => { const r = await acceptInvite(token); if (r.ok) { router.push(r.data!.next); router.refresh(); } else toast.error(r.error); })}>
      {t("accept")}
    </Button>
  );
}
