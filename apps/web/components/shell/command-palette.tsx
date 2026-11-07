"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import { ArrowRight, Phone, User, Inbox, Plus, Power, Upload, PhoneCall } from "lucide-react";
import type { AiMode } from "@all/db";
import { setAiMode, publishQuestionnaire } from "@/lib/actions";
import { formatPhone, relativeTime } from "@/lib/format";
import { toast } from "@all/ui";

interface SearchResult {
  calls: { id: string; caller: string; name?: string; at: string }[];
  contacts: { id: string; name?: string; phone?: string }[];
  leads: { id: string; number: number; title: string }[];
}

const PAGES = ["overview", "calls", "leads", "contacts", "knowledge", "assistant", "analytics", "integrations", "team", "billing", "settings"] as const;
const HREF: Record<(typeof PAGES)[number], string> = {
  overview: "/app", calls: "/app/calls", leads: "/app/leads", contacts: "/app/contacts", knowledge: "/app/knowledge", assistant: "/app/assistant",
  analytics: "/app/analytics", integrations: "/app/integrations", team: "/app/team", billing: "/app/billing", settings: "/app/settings",
};

export function CommandPalette({ open, onOpenChange, canToggleAi }: { open: boolean; onOpenChange: (v: boolean) => void; canToggleAi: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [res, setRes] = React.useState<SearchResult>({ calls: [], contacts: [], leads: [] });

  React.useEffect(() => {
    if (!open) { setQ(""); return; }
  }, [open]);
  React.useEffect(() => {
    if (q.trim().length < 2) { setRes({ calls: [], contacts: [], leads: [] }); return; }
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then(setRes).catch(() => undefined);
    }, 120);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [q]);

  const go = (href: string) => { onOpenChange(false); router.push(href); };
  const item = "flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13px] data-[selected=true]:bg-hover [&_svg]:size-4 [&_svg]:text-fg-muted";
  const group = "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-faint";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[620px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-[14px] border border-line-strong bg-elevated shadow-[var(--shadow-pop)]">
          <Dialog.Title className="sr-only">{t("palette.placeholder")}</Dialog.Title>
          <Command label={t("palette.placeholder")} shouldFilter={true}>
            <Command.Input value={q} onValueChange={setQ} placeholder={t("palette.placeholder")} autoFocus
              className="h-12 w-full border-b border-line bg-transparent px-4 text-sm placeholder:text-fg-faint focus:outline-none" />
            <Command.List className="max-h-[420px] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-[13px] text-fg-muted">{t("palette.empty")}</Command.Empty>
              {res.calls.length > 0 && (
                <Command.Group heading={t("palette.calls")} className={group}>
                  {res.calls.map((c) => (
                    <Command.Item key={c.id} value={`call ${c.caller} ${c.name ?? ""} ${q}`} onSelect={() => go(`/app/calls?open=${c.id}`)} className={item}>
                      <Phone /> <span className="flex-1">{c.name ?? formatPhone(c.caller)}</span><span className="text-xs text-fg-faint">{relativeTime(c.at)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {res.contacts.length > 0 && (
                <Command.Group heading={t("palette.contacts")} className={group}>
                  {res.contacts.map((c) => (
                    <Command.Item key={c.id} value={`contact ${c.name ?? ""} ${c.phone ?? ""} ${q}`} onSelect={() => go(`/app/contacts?open=${c.id}`)} className={item}>
                      <User /> <span className="flex-1">{c.name ?? "—"}</span><span className="text-xs tabular-nums text-fg-faint">{formatPhone(c.phone)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {res.leads.length > 0 && (
                <Command.Group heading={t("palette.leads")} className={group}>
                  {res.leads.map((l) => (
                    <Command.Item key={l.id} value={`lead ${l.number} ${l.title} ${q}`} onSelect={() => go(`/app/leads?open=${l.id}`)} className={item}>
                      <Inbox /> <span className="tabular-nums text-fg-muted">#{l.number}</span> <span className="flex-1 truncate">{l.title}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading={t("palette.actions")} className={group}>
                <Command.Item onSelect={() => go("/app/leads?create=1")} className={item}><Plus /> {t("palette.createLead")}</Command.Item>
                <Command.Item onSelect={() => go("/app/assistant?test=1")} className={item}><PhoneCall /> {t("palette.testCall")}</Command.Item>
                <Command.Item onSelect={async () => { onOpenChange(false); const r = await publishQuestionnaire(); if (r.ok) toast.success(t("knowledge.published_ok", { version: r.data ?? 0 })); else toast.error(r.error); router.refresh(); }} className={item}>
                  <Upload /> {t("palette.publish")}
                </Command.Item>
                {canToggleAi && (["on", "leads_only", "all_human", "off"] as AiMode[]).map((m) => (
                  <Command.Item key={m} value={`ai ${t(`ai.${m}`)}`} onSelect={async () => { onOpenChange(false); await setAiMode(m); toast(`${t("ai.label")}: ${t(`ai.${m}`)}`, { description: t("ai.applied") }); router.refresh(); }} className={item}>
                    <Power /> {t("palette.toggleAi", { mode: t(`ai.${m}`) })}
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading={t("palette.goto")} className={group}>
                {PAGES.map((p) => (
                  <Command.Item key={p} value={`go ${t(`nav.${p}`)}`} onSelect={() => go(HREF[p])} className={item}>
                    <ArrowRight /> {t(`nav.${p}`)}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
