import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/auth/login-form";
import Link from "next/link";
import { env, isSupabase } from "@/lib/env";

export const metadata = { title: "Восстановление доступа" };

export default async function ResetPage() {
  const t = await getTranslations("auth");
  if (isSupabase) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-2xl font-medium tracking-[-0.03em]">{t("resetTitle")}</h1>
        <p className="text-[13px] text-fg-muted">В демо-среде восстановление пароля не подключено. Если пароль не подходит, обратитесь к организаторам.</p>
        <Link href="/login" className="text-xs text-fg underline">{t("login")}</Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-fg-muted">{t("resetText")}</p>
      <LoginForm mock={env.DATA_SOURCE === "mock"} />
    </div>
  );
}
