import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Sparkles, ArrowRight } from "lucide-react";

/** Плавающая frosted-навигация (design.md): отступ от краёв, пилюли, белая CTA */
export async function SiteNav() {
  const t = await getTranslations("landing");
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center px-4">
      <nav className="pointer-events-auto flex w-full max-w-[1200px] items-center gap-1.5 rounded-[19px] border border-white/15 bg-[#161616]/80 p-1.5 pl-4 shadow-[rgba(255,255,255,0.02)_0_3px_4.5px,rgba(0,0,0,0.04)_0_10px_8px,rgba(0,0,0,0.1)_0_4px_3px] backdrop-blur-md">
        <Link href="/" className="mr-auto flex items-center gap-2 text-[14px] font-medium tracking-[0.01em] text-white">
          <span className="flex size-6 items-center justify-center rounded-[6px] bg-white font-display text-[11px] font-semibold text-[#161616]">A</span>ALL-менеджер
        </Link>
        <Link href="/#how" className="hidden h-8 items-center rounded-full px-3.5 text-[14px] text-white/85 hover:bg-white/10 md:inline-flex">{t("nav.how")}</Link>
        <Link href="/pricing" className="hidden h-8 items-center rounded-full px-3.5 text-[14px] text-white/85 hover:bg-white/10 md:inline-flex">{t("nav.pricing")}</Link>
        <Link href="/login" className="inline-flex h-8 items-center rounded-full border border-white/20 px-3.5 text-[14px] text-white/85 hover:bg-white/10">{t("nav.login")}</Link>
        <Link href="/signup" className="inline-flex h-8 items-center rounded-full bg-white px-3.5 text-[14px] font-medium text-[#161616] hover:bg-white/90">{t("nav.cta")}</Link>
      </nav>
    </div>
  );
}

export async function StatusBanner() {
  const t = await getTranslations("landing");
  return (
    <Link href="/signup" className="mx-auto flex w-fit items-center gap-2 rounded-full border border-white/20 bg-black/20 px-3.5 py-1.5 text-[14px] font-medium text-white/90 backdrop-blur-sm hover:bg-black/30">
      <Sparkles className="size-3.5" />{t("banner")}<ArrowRight className="size-3.5" />
    </Link>
  );
}

export async function SiteFooter() {
  const t = await getTranslations("landing");
  return (
    <footer className="border-t border-white/10 bg-[#0a0a0a]">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-8 text-[13px] text-[#686868]">
        <span>{t("footer")}</span>
        <span className="ml-auto flex flex-wrap gap-4">
          {(["offer", "privacy", "demoTerms", "dpa"] as const).map((k) => <Link key={k} href={`/legal/${k}`} className="hover:text-[#ededed]">{t(`legal.${k}`)}</Link>)}
        </span>
      </div>
    </footer>
  );
}
