import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";

export const metadata = { title: "Вход" };

export default async function LoginPage() {
  if (await getSession()) redirect("/app");
  const t = await getTranslations("auth");
  return (
    <>
      <LoginForm mock={env.DATA_SOURCE === "mock"} />
      <p className="mt-6 text-xs text-fg-muted">{t("noAccount")} <Link href="/signup" className="text-fg underline">{t("signup")}</Link> · <Link href="/reset" className="hover:text-fg">{t("resetTitle")}</Link></p>
    </>
  );
}
