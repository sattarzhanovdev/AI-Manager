import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { PasswordLoginForm } from "@/components/auth/password-login-form";
import { getSession } from "@/lib/auth";
import { isSupabase, mockAuthAllowed } from "@/lib/env";

export const metadata = { title: "Вход" };

export default async function LoginPage() {
  if (await getSession()) redirect("/app");
  if (isSupabase) return <PasswordLoginForm />;
  const t = await getTranslations("auth");
  if (!mockAuthAllowed) {
    return <p className="text-[13px] text-fg-muted" role="alert">Вход не настроен: укажите DATA_SOURCE=supabase и ключи Supabase.</p>;
  }
  return (
    <>
      <LoginForm mock />
      <p className="mt-6 text-xs text-fg-muted">{t("noAccount")} <Link href="/signup" className="text-fg underline">{t("signup")}</Link> · <Link href="/reset" className="hover:text-fg">{t("resetTitle")}</Link></p>
    </>
  );
}
