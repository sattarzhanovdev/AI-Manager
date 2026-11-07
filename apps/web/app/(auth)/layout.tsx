import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { isSupabase } from "@/lib/env";

/** Две колонки: слева форма 360px, справа панель с демо-номером. На телефоне — только форма. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("auth");
  return (
    <div className="grid min-h-dvh grid-cols-1 bg-app md:grid-cols-[1fr_1fr]">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <Link href="/" className="flex items-center gap-2 text-[13px] font-medium">
          <span className="flex size-6 items-center justify-center rounded-[6px] bg-accent font-display text-[11px] font-semibold text-accent-fg">A</span>
          ALL-менеджер
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[360px]">{children}</div>
        </div>
      </div>
      <aside className="hero-horizon relative hidden flex-col justify-end overflow-hidden p-10 md:flex">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_30%,rgba(255,255,255,0.12),transparent)]" />
        <div className="relative max-w-md rounded-[24px] bg-black/25 p-7 backdrop-blur-sm">
          {/* Демо-телефон показываем только когда есть телефония; в Hackathon MVP — браузерный тест в кабинете */}
          {!isSupabase && (
            <>
              <p className="text-xs uppercase tracking-[0.1em] text-white/70">{t("demoNumber")}</p>
              <a href="tel:+996312900900" className="mt-2 block font-display text-[40px] font-medium leading-none tracking-[-0.035em] text-white">+996 312 900 900</a>
            </>
          )}
          <p className="mt-3 text-[15px] leading-6 text-white/85">{t("pitch")}</p>
        </div>
      </aside>
    </div>
  );
}
