"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { RotateCw, Send, Globe, MessageCircle, Camera, Building2, CalendarDays, Sheet as SheetIcon, Webhook, Code2, Bot } from "lucide-react";
import { Button, PageHeader, Pill, Select, Sheet, Tabs, Tooltip, cn, toast, type Tone } from "@all/ui";
import type { Integration, IntegrationLog } from "@all/db";
import { fetchIntegrationLogs } from "@/lib/read";
import { retryIntegrationEvent } from "@/lib/actions";
import { relativeTime, formatDateTime } from "@/lib/format";

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  telegram_notify: Send, telegram_channel: Bot, widget: Globe, whatsapp: MessageCircle, instagram: Camera, bitrix24: Building2, amocrm: Building2,
  google_calendar: CalendarDays, yclients: CalendarDays, google_sheets: SheetIcon, webhooks: Webhook, api: Code2,
};
const TONE: Record<Integration["status"], Tone> = { connected: "success", error: "danger", reconnect: "warning", disabled: "neutral", not_connected: "neutral", plan_locked: "neutral" };
const PHASE: Record<Integration["phase"], string> = { "1a": "1а", "1b": "1б", "2": "2", "3": "3" };

export function IntegrationsView({ items, linked, total, openKey, canManage }: { items: Integration[]; linked: number; total: number; openKey?: string; canManage: boolean }) {
  const t = useTranslations("integrations");
  const te = useTranslations("enums");
  const [open, setOpen] = React.useState<string | undefined>(openKey);
  const groups = (["channels", "crm", "calendars", "sheets", "developers"] as const).map((g) => ({ g, list: items.filter((i) => i.group === g) }));
  const current = items.find((i) => i.key === open);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t("title")} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr className="[&>th]:h-8 [&>th]:border-b [&>th]:border-line [&>th]:bg-subtle [&>th]:px-3 [&>th]:text-left [&>th]:text-xs [&>th]:font-normal [&>th]:text-fg-muted">
              <th>{t("colName")}</th><th className="w-48">{t("colStatus")}</th><th className="w-40 max-md:hidden">{t("colSync")}</th><th className="w-28 text-right max-md:hidden">{t("colErrors")}</th><th className="w-36" />
            </tr>
          </thead>
          {groups.map(({ g, list }) => (
            <tbody key={g}>
              <tr><td colSpan={5} className="h-8 border-b border-line bg-app px-3 text-xs font-medium uppercase tracking-[0.06em] text-fg-muted">{t(`groups.${g}`)}</td></tr>
              {list.map((i) => {
                const Icon = ICON[i.key] ?? Globe;
                const locked = i.status === "plan_locked";
                return (
                  <tr key={i.key} onClick={() => setOpen(i.key)} className="cursor-pointer hover:bg-hover [&>td]:h-11 [&>td]:border-b [&>td]:border-line [&>td]:px-3">
                    <td>
                      <span className="flex items-center gap-3">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-line bg-subtle"><Icon className="size-4 text-fg-secondary" /></span>
                        <span className="min-w-0"><span className="block truncate">{t(`names.${i.key}` as "names.api")}</span><span className="block truncate text-xs text-fg-muted max-md:hidden">{t(`desc.${i.key}` as "desc.api")}</span></span>
                      </span>
                    </td>
                    <td><Pill tone={TONE[i.status]}>{locked ? t("phaseNote", { phase: PHASE[i.phase] }) : te(`integrationStatus.${i.status}`)}</Pill></td>
                    <td className="text-fg-muted max-md:hidden">{i.lastSyncAt ? relativeTime(i.lastSyncAt) : "—"}</td>
                    <td className="text-right tabular-nums max-md:hidden">{i.errors24h || <span className="text-fg-faint">0</span>}</td>
                    <td className="text-right">
                      {i.status === "connected" ? <Button size="sm">{t("configure")}</Button> : i.status === "error" || i.status === "reconnect" ? <Button size="sm" variant="primary">{t("reconnect")}</Button> : <Button size="sm" disabled={locked || !canManage}>{t("connect")}</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      {current && <IntegrationSheet i={current} linked={linked} total={total} onClose={() => setOpen(undefined)} canManage={canManage} />}
    </div>
  );
}

function IntegrationSheet({ i, linked, total, onClose, canManage }: { i: Integration; linked: number; total: number; onClose: () => void; canManage: boolean }) {
  const t = useTranslations("integrations");
  const [tab, setTab] = React.useState(i.status === "connected" ? "log" : "connect");
  const [logs, setLogs] = React.useState<IntegrationLog[] | null>(null);
  React.useEffect(() => { if (tab === "log") void fetchIntegrationLogs(i.key).then((l) => setLogs(l ?? [])); }, [tab, i.key]);
  const steps = t.raw("tgSteps") as string[];
  const isCrm = i.group === "crm" || i.group === "sheets";
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={t(`names.${i.key}` as "names.api")} description={t(`desc.${i.key}` as "desc.api")} width={640}>
      <div className="-mt-1 mb-3"><Tabs value={tab} onValueChange={setTab} items={[{ value: "connect", label: t("tabs.connect") }, ...(isCrm ? [{ value: "mapping", label: t("tabs.mapping") }] : []), { value: "log", label: t("tabs.log") }, { value: "settings", label: t("tabs.settings") }]} /></div>
      {tab === "connect" && (
        i.key === "telegram_notify" ? (
          <ol className="flex flex-col gap-2">
            {steps.map((s, n) => <li key={n} className="flex gap-3 rounded-[10px] border border-line p-3 text-[13px]"><span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-active text-xs tabular-nums">{n + 1}</span>{s}</li>)}
            <li className="text-xs text-fg-muted">{t("linked", { count: linked, total })}</li>
          </ol>
        ) : <p className="rounded-[10px] border border-line p-4 text-[13px] text-fg-muted">{t("phaseNote", { phase: PHASE[i.phase] })}. Мастер: авторизация (OAuth или токен) → выбор объекта → сопоставление полей → тест.</p>
      )}
      {tab === "mapping" && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2 text-xs text-fg-muted"><span>{t("leadField")}</span><span>{t("extField")}</span><span>{t("default")}</span></div>
          {[["Тип заявки", "TITLE"], ["Телефон", "PHONE"], ["Имя", "NAME"], ["Комментарий + расшифровка", "COMMENTS"]].map(([a, b]) => (
            <div key={a} className="grid grid-cols-3 gap-2"><span className="flex h-8 items-center text-[13px]">{a}</span><Select disabled><option>{b}</option></Select><Select disabled><option>—</option></Select></div>
          ))}
          <p className="mt-2 text-xs text-fg-faint">{t("mappingPreview")}</p>
        </div>
      )}
      {tab === "log" && (
        logs == null ? <p className="text-xs text-fg-muted">…</p> : logs.length === 0 ? <p className="text-[13px] text-fg-muted">Событий пока нет</p> : (
          <table className="w-full text-xs">
            <thead><tr className="[&>th]:h-7 [&>th]:border-b [&>th]:border-line [&>th]:px-1.5 [&>th]:text-left [&>th]:font-normal [&>th]:text-fg-muted">
              <th>{t("logCols.time")}</th><th>{t("logCols.dir")}</th><th>{t("logCols.event")}</th><th>{t("logCols.status")}</th><th className="text-right">{t("logCols.ms")}</th><th />
            </tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="[&>td]:h-8 [&>td]:border-b [&>td]:border-line [&>td]:px-1.5">
                  <td className="whitespace-nowrap text-fg-muted">{formatDateTime(l.at)}</td>
                  <td>{l.direction === "in" ? t("in") : t("out")}</td>
                  <td className="font-mono">{l.event}</td>
                  <td>{l.status === "ok" ? <Pill tone="success">ok</Pill> : <Tooltip content={l.error ?? ""}><span><Pill tone="danger">{l.status}</Pill></span></Tooltip>}</td>
                  <td className="text-right tabular-nums">{l.ms}</td>
                  <td className="text-right">{l.status !== "ok" && <Button size="sm" disabled={!canManage} icon={<RotateCw />}
                    onClick={async () => { const r = await retryIntegrationEvent(i.key, l.id); if (r.ok) { toast(t("retried")); setLogs(await fetchIntegrationLogs(i.key)); } else toast.error(r.error); }}>{t("retry")}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
      {tab === "settings" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-fg-muted">{t("events")}</p>
          {["lead.created", "lead.urgent", "complaint", "call.missed", "limit"].map((e) => (
            <label key={e} className={cn("flex h-8 items-center gap-2 text-[13px]")}><input type="checkbox" defaultChecked disabled={!canManage} className="accent-[var(--text)]" /><span className="font-mono text-xs">{e}</span></label>
          ))}
        </div>
      )}
    </Sheet>
  );
}
