"use client";
import { useTranslations } from "next-intl";
import { Sheet, Kbd } from "@all/ui";

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useTranslations("shortcuts");
  const rows: [string[], string][] = [
    [["⌘", "K"], t("palette")], [["G", "O/Z/L/I/A"], t("goto")], [["C"], t("create")], [["/"], t("search")],
    [["J", "K"], t("jk")], [["Enter", "Esc"], t("enterEsc")], [["Space"], t("space")], [["←", "→"], t("arrows")], [["?"], t("help")],
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("title")} width={420}>
      <dl className="flex flex-col">
        {rows.map(([keys, label]) => (
          <div key={label} className="flex h-9 items-center justify-between gap-3 border-b border-line">
            <dt className="text-[13px]">{label}</dt>
            <dd className="flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}
