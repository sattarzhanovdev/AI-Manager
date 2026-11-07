import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { AdminNav } from "@/components/admin/admin-nav";

/** Суперадминка — только команда платформы (platform_role в JWT). В mock-режиме открыта для проверки. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (env.DATA_SOURCE === "supabase" && !s.member) redirect("/app");
  const t = await getTranslations("admin");
  return (
    <div className="flex h-dvh overflow-hidden bg-app">
      <aside className="flex w-52 shrink-0 flex-col border-r border-line max-md:hidden">
        <Link href="/admin" className="flex h-11 items-center gap-2 border-b border-line px-3 text-[13px] font-medium">
          <span className="flex size-6 items-center justify-center rounded-[6px] bg-accent font-display text-[11px] font-semibold text-accent-fg">A</span>{t("title")}
        </Link>
        <AdminNav />
        {env.DATA_SOURCE === "mock" && <p className="border-t border-line p-3 text-[11px] text-fg-faint">Демо-режим: доступ открыт для проверки. В проде — только platform_role.</p>}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
