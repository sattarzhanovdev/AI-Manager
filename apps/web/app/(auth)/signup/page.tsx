import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SignupForm } from "@/components/auth/signup-form";
import { isSupabase } from "@/lib/env";

export const metadata = { title: "Регистрация" };

/** Фаза 1а: регистрация проходит с командой — оставить номер. Самостоятельная — фаза 2. */
export default async function SignupPage() {
  const t = await getTranslations("auth");
  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl font-medium tracking-[-0.03em]">{t("signupTitle")}</h1>
      {isSupabase ? (
        <p className="text-[13px] text-fg-muted">Это демо-среда хакатона: регистрация новых компаний закрыта. Войдите с тестовым аккаунтом, который выдали организаторы.</p>
      ) : (
        <>
          <p className="text-[13px] text-fg-muted">{t("signupClosed")}</p>
          <SignupForm />
        </>
      )}
      <p className="text-xs text-fg-muted">{t("haveAccount")} <Link href="/login" className="text-fg underline">{t("login")}</Link></p>
    </div>
  );
}
