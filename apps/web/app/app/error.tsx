"use client";
import { useTranslations } from "next-intl";
import { Button } from "@all/ui";
export default function CabinetError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("common");
  return <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6"><p>{t("cabinetLoadError")}</p><Button onClick={reset}>{t("retry")}</Button></div>;
}
