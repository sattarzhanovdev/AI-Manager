import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/auth/login-form";
import { env } from "@/lib/env";

export const metadata = { title: "Восстановление доступа" };

export default async function ResetPage() {
  const t = await getTranslations("auth");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-fg-muted">{t("resetText")}</p>
      <LoginForm mock={env.DATA_SOURCE === "mock"} />
    </div>
  );
}
