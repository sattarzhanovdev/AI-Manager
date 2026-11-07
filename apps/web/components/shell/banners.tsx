"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, PowerOff } from "lucide-react";
import type { AiMode } from "@all/db";
import { cn } from "@all/ui";
import { setAiMode } from "@/lib/actions";

export interface BannerData {
  limitPct: number;
  integrationError?: string;
  unpaid?: boolean;
  support?: boolean;
  kbLow?: boolean;
}

function Bar({ tone, children }: { tone: "danger" | "warning"; children: React.ReactNode }) {
  return (
    <div role="status" className={cn("flex min-h-8 shrink-0 items-center gap-2 border-b border-line px-3 text-xs",
      tone === "danger" ? "bg-danger-bg text-danger" : "bg-warning-bg text-warning")}>
      {children}
    </div>
  );
}

/** Баннеры под верхней полосой: AI выключен, лимит 80/100%, ошибка интеграции, неоплата */
export function Banners({ data, aiMode, canToggleAi }: { data: BannerData; aiMode: AiMode; canToggleAi: boolean }) {
  const t = useTranslations("banners");
  const ta = useTranslations("ai");
  const router = useRouter();
  return (
    <>
      {aiMode === "off" && (
        <Bar tone="danger">
          <PowerOff className="size-3.5" /> {ta("bannerOff")}
          {canToggleAi && <button className="ml-auto h-6 rounded-full bg-danger px-2.5 font-medium text-white" onClick={async () => { await setAiMode("on"); router.refresh(); }}>{ta("turnOn")}</button>}
        </Bar>
      )}
      {data.limitPct >= 100 ? (
        <Bar tone="danger"><AlertTriangle className="size-3.5" /> {t("limit100")}<Link href="/app/billing" className="ml-auto font-medium underline">{t("buy")}</Link></Bar>
      ) : data.limitPct >= 80 ? (
        <Bar tone="warning"><AlertTriangle className="size-3.5" /> {t("limit80", { pct: Math.round(data.limitPct) })}<Link href="/app/billing" className="ml-auto font-medium underline">{t("buy")}</Link></Bar>
      ) : null}
      {data.kbLow && <Bar tone="warning"><AlertTriangle className="size-3.5" /> {t("kbLow")}<Link href="/app/knowledge" className="ml-auto font-medium underline">{t("fix")}</Link></Bar>}
      {data.integrationError && <Bar tone="warning"><AlertTriangle className="size-3.5" /> {t("integrationError", { name: data.integrationError })}<Link href="/app/integrations" className="ml-auto font-medium underline">{t("fix")}</Link></Bar>}
      {data.unpaid && <Bar tone="danger"><AlertTriangle className="size-3.5" /> {t("unpaid")}<Link href="/app/billing" className="ml-auto font-medium underline">{t("pay")}</Link></Bar>}
    </>
  );
}
