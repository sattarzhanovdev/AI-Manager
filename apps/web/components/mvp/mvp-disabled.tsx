import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Lock } from "lucide-react";

/** Заглушка раздела, который в Hackathon MVP не подключён к базе: без фальшивых данных и кнопок */
export async function MvpDisabled() {
  const t = await getTranslations("mvp");
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6" data-testid="mvp-disabled">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <Lock className="size-6 text-fg-faint" aria-hidden />
        <h1 className="font-display text-[15px] font-medium">{t("disabledTitle")}</h1>
        <p className="text-[13px] leading-5 text-fg-muted">{t("disabledText")}</p>
        <p className="text-xs text-fg-faint">{t("disabledAvailable")}</p>
        <Link href="/app" className="inline-flex h-8 items-center rounded-full border border-line-strong px-3 text-[13px] hover:bg-hover">{t("toOverview")}</Link>
      </div>
    </div>
  );
}
