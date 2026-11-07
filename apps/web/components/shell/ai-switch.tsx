"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, Check } from "lucide-react";
import { Menu, MenuContent, MenuTrigger, cn, toast } from "@all/ui";
import { DropdownMenu } from "radix-ui";
import type { AiMode } from "@all/db";
import { setAiMode } from "@/lib/actions";

const DOT: Record<AiMode, string> = { on: "bg-success", leads_only: "bg-warning", all_human: "bg-fg-faint", off: "bg-danger" };
export const AI_MODES: AiMode[] = ["on", "leads_only", "all_human", "off"];

/** Переключатель AI: применяется к новым звонкам ≤ 10 с, пишется в аудит */
export function AiSwitch({ mode, disabled }: { mode: AiMode; disabled?: boolean }) {
  const t = useTranslations("ai");
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [current, setCurrent] = React.useState(mode);
  React.useEffect(() => setCurrent(mode), [mode]);

  const change = (m: AiMode) => {
    if (m === current) return;
    const prev = current;
    setCurrent(m);
    start(async () => {
      const r = await setAiMode(m);
      if (!r.ok) { setCurrent(prev); toast.error(r.error); return; }
      toast(`${t("label")}: ${t(m)}`, { description: t("applied"), undo: () => { void setAiMode(prev).then(() => router.refresh()); setCurrent(prev); } });
      router.refresh();
    });
  };

  return (
    <Menu>
      <MenuTrigger disabled={disabled || pending} title={disabled ? "Переключать AI может собственник или админ" : undefined}
        className="inline-flex h-8 items-center gap-2 rounded-full border border-line px-3 text-[13px] hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60">
        <span className={cn("size-2 rounded-full", DOT[current], current === "on" && "live-dot")} aria-hidden />
        <span className="text-fg-muted max-sm:hidden">{t("label")}:</span>
        <span className="font-medium">{t(current)}</span>
        <ChevronDown className="size-3.5 text-fg-faint" />
      </MenuTrigger>
      <MenuContent>
        {AI_MODES.map((m) => (
          <DropdownMenu.Item key={m} onSelect={() => change(m)}
            className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-hover">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[m])} />
            <span className="flex-1">
              <span className="block text-[13px]">{t(m)}</span>
              <span className="block text-xs text-fg-muted">{t(`${m}Hint`)}</span>
            </span>
            {m === current && <Check className="mt-1 size-3.5" />}
          </DropdownMenu.Item>
        ))}
      </MenuContent>
    </Menu>
  );
}
