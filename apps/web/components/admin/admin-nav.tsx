"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@all/ui";

const ITEMS = ["companies", "demo", "leads", "moderation", "numbers", "quality", "eval", "plans", "incidents"] as const;

export function AdminNav() {
  const t = useTranslations("admin.nav");
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-px p-2">
      {ITEMS.map((k) => {
        const href = k === "companies" ? "/admin" : `/admin/${k}`;
        const active = k === "companies" ? path === "/admin" : path.startsWith(href);
        return <Link key={k} href={href} className={cn("flex h-8 items-center rounded-[8px] px-2.5 text-[13px]", active ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}>{t(k)}</Link>;
      })}
    </nav>
  );
}
