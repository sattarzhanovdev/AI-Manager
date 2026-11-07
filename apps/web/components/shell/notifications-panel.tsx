"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Sheet, Button, EmptyState, cn } from "@all/ui";
import type { AppNotification } from "@all/db";
import { markNotificationsRead } from "@/lib/actions";
import { relativeTime } from "@/lib/format";

const GROUP: Record<AppNotification["kind"], "leads" | "calls" | "system"> = {
  lead_new: "leads", lead_urgent: "leads", complaint: "leads", chat_takeover: "leads",
  call_missed: "calls", limit_80: "system", limit_100: "system", integration_error: "system", payment_due: "system", kb_published: "system",
};

export function NotificationsPanel({ open, onOpenChange, items, onRead }: { open: boolean; onOpenChange: (v: boolean) => void; items: AppNotification[]; onRead: (ids?: string[]) => void }) {
  const t = useTranslations("notifications");
  const groups = (["leads", "calls", "system"] as const).map((g) => ({ g, list: items.filter((n) => GROUP[n.kind] === g) })).filter((x) => x.list.length);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("title")} width={400}
      footer={<Button size="sm" onClick={async () => { await markNotificationsRead(); onRead(); }}>{t("readAll")}</Button>}>
      {items.length === 0 ? <EmptyState title={t("empty")} /> : (
        <div className="-mx-4 -my-3">
          {groups.map(({ g, list }) => (
            <section key={g}>
              <h3 className="sticky top-0 bg-elevated px-4 pb-1 pt-3 text-xs text-fg-muted">{t(`groups.${g}`)}</h3>
              <ul>
                {list.map((n) => (
                  <li key={n.id}>
                    <Link href={n.href ?? "#"} onClick={() => { void markNotificationsRead([n.id]); onRead([n.id]); onOpenChange(false); }}
                      className={cn("flex gap-2.5 px-4 py-2 hover:bg-hover", n.readAt && "opacity-60")}>
                      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : n.kind === "complaint" || n.kind === "lead_urgent" ? "bg-danger" : "bg-fg")} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-5">{n.title}</span>
                        {n.body && <span className="block truncate text-xs text-fg-muted">{n.body}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-fg-faint">{relativeTime(n.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}
