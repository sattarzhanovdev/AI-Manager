"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertOctagon, AlertTriangle, Clock, PhoneMissed, HelpCircle, PlugZap, Check, CircleDashed } from "lucide-react";
import { Kpi, Panel, PageHeader, Pill, Button, Menu, MenuContent, MenuItem, MenuTrigger, cn, toast, EmptyState } from "@all/ui";
import type { OverviewData } from "@/lib/data/repo";
import { updateLead, markCallback } from "@/lib/actions";
import { useRealtime } from "@/lib/use-realtime";
import { relativeTime, formatPhone, formatDateTime, fmtInt } from "@/lib/format";
import { STATUS_TONE, STATUSES } from "../leads/leads-view";

type Data = OverviewData;

const ICON = { complaint: AlertOctagon, urgent: AlertTriangle, sla: Clock, missed: PhoneMissed, unanswered: HelpCircle, integration: PlugZap } as const;
const TONE = { complaint: "text-danger", urgent: "text-danger", sla: "text-warning", missed: "text-warning", unanswered: "text-fg-muted", integration: "text-warning" } as const;

export function Overview({ data, members, integrationCount, me, mvp = false, canKb = true }: { data: Data; members: { userId: string; name: string }[]; integrationCount: number; me: string; mvp?: boolean; canKb?: boolean }) {
  const t = useTranslations("overview");
  const tm = useTranslations("mvp");
  const te = useTranslations("enums");
  const tl = useTranslations("leads");
  const ta = useTranslations("ai");
  const router = useRouter();
  const [done, setDone] = React.useState<Set<string>>(new Set());
  const k = data.kpi;

  // KPI и лента обновляются без перезагрузки
  useRealtime((e) => { if (e.type === "call.created" || e.type === "lead.created" || e.type === "lead.updated") router.refresh(); });

  const resolve = (id: string) => setDone((s) => new Set(s).add(id));
  const delta = k.callsToday - k.callsYesterday;
  const items = data.attention.filter((a) => !done.has(a.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t("title")} meta={formatDateTime(new Date().toISOString())} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {/* Ряд из 6 KPI */}
        <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label={t("kpiCalls")} value={k.callsToday} delta={`${delta >= 0 ? "+" : ""}${delta}`} deltaTone={delta >= 0 ? "up" : "down"} spark={k.callsSpark} href="/app/calls?view=today" />
          <Kpi label={t("kpiAnswered")} value={`${k.answeredPct}%`} deltaTone="neutral" href="/app/calls?outcome=missed" />
          <Kpi label={t("kpiNewLeads")} value={k.newLeads} hint={t("withoutOwner")} href="/app/leads?view=new" />
          <Kpi label={t("kpiMissed")} value={k.missed} hint={k.missedReason} href="/app/calls?view=missed" />
          {mvp ? (
            <Kpi label={tm("kpiProcessed")} value={data.leadStats.processed} hint={`${tm("kpiLeadsTotal")}: ${data.leadStats.total}`} href="/app/leads" />
          ) : (
            <Kpi label={t("kpiMinutes")} value={fmtInt(k.minutesLeft)} hint={t("forecast", { count: fmtInt(k.minutesForecast) })} href="/app/billing" />
          )}
          {canKb && <Kpi label={t("kpiKb")} value={`${k.kbIndex}%`} hint={t("unanswered", { count: k.unanswered })} href="/app/knowledge" />}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
          {/* Требует внимания */}
          <Panel title={t("attention")} aside={<span className="text-xs tabular-nums text-fg-faint">{items.length}</span>} bodyClassName="overflow-auto">
            {data.firstWeek ? (
              <div className="flex flex-col gap-3 p-4">
                <p className="text-[13px] text-fg-muted">{t("firstWeek")}</p>
                <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-fg-muted">{t("activation")}</h3>
                {(["act1", "act2", "act3", "act4", "act5"] as const).map((a, i) => (
                  <div key={a} className="flex items-center gap-2 text-[13px]">{i < 2 ? <Check className="size-4 text-success" /> : <CircleDashed className="size-4 text-fg-faint" />}{t(a)}</div>
                ))}
              </div>
            ) : items.length === 0 ? <EmptyState title={t("attentionEmpty")} /> : (
              <ul>
                {items.map((a) => {
                  const Icon = ICON[a.kind];
                  return (
                    <li key={a.id} className="group flex h-10 items-center gap-2.5 border-b border-line px-3 hover:bg-hover">
                      <Icon className={cn("size-4 shrink-0", TONE[a.kind])} />
                      <Link href={a.href} className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="w-36 shrink-0 truncate text-xs text-fg-muted max-sm:hidden">{t(`kinds.${a.kind}`)}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">{a.kind === "missed" ? (a.title.startsWith("+") ? formatPhone(a.title) : a.title) : a.kind === "integration" ? a.subtitle || a.title : a.title}</span>
                        {a.kind !== "missed" && a.kind !== "integration" && a.subtitle && <span className="max-w-40 truncate text-xs text-fg-muted max-md:hidden">{a.kind === "unanswered" ? `${a.subtitle}×` : a.subtitle.startsWith("+") ? formatPhone(a.subtitle) : a.subtitle}</span>}
                      </Link>
                      <span className="w-20 shrink-0 whitespace-nowrap text-right text-xs text-fg-faint">{relativeTime(a.at)}</span>
                      {/* Действие в один клик, без перехода */}
                      <span className="flex w-24 shrink-0 justify-end">
                        {a.leadId && (
                          a.kind === "sla" ? (
                            <Menu>
                              <MenuTrigger className="h-6 rounded-full border border-line-strong px-2.5 text-xs hover:bg-hover">{t("assign")}</MenuTrigger>
                              <MenuContent>
                                {members.map((m) => (
                                  <MenuItem key={m.userId} onSelect={async () => { const r = await updateLead(a.leadId!, { assigneeId: m.userId, status: "in_progress" }); if (r.ok) { resolve(a.id); toast(`${m.name}`); } else toast.error(r.error); }}>{m.name}</MenuItem>
                                ))}
                              </MenuContent>
                            </Menu>
                          ) : (
                            <Button size="sm" onClick={async () => { const r = await updateLead(a.leadId!, { assigneeId: me, status: "in_progress" }); if (r.ok) { resolve(a.id); toast(t("take")); } else toast.error(r.error); }}>{t("take")}</Button>
                          )
                        )}
                        {a.callId && (
                          <span className="flex gap-1">
                            <a href={`tel:${a.phone}`} className="inline-flex h-7 items-center rounded-full border border-line-strong px-2.5 text-xs hover:bg-hover max-md:hidden">☎</a>
                            <Button size="sm" onClick={async () => { const r = await markCallback(a.callId!); if (r.ok) resolve(a.id); }}>{t("callback")}</Button>
                          </span>
                        )}
                        {a.kind === "unanswered" && <Link href={a.href} className="inline-flex h-7 items-center rounded-full border border-line-strong px-2.5 text-xs hover:bg-hover">{t("answer")}</Link>}
                        {a.kind === "integration" && <Link href={a.href} className="inline-flex h-7 items-center rounded-full border border-line-strong px-2.5 text-xs hover:bg-hover">{t("fix")}</Link>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <div className="flex min-h-0 flex-col gap-3">
            <Panel title={t("byHour")} aside={<span className="flex items-center gap-3 text-xs text-fg-muted"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-fg-secondary" />{t("todayLegend")}</span><span className="flex items-center gap-1"><span className="w-3 border-t border-dashed border-fg-faint" />{t("yesterdayLegend")}</span></span>}>
              <HourChart today={data.hours.today} yesterday={data.hours.yesterday} />
            </Panel>
            {mvp ? (
              <>
                <Panel className="shrink-0" title={tm("leadsByStatus")} aside={<Link href="/app/leads" className="text-xs text-fg-muted hover:text-fg">{tm("kpiLeadsTotal")}: <span className="tabular-nums">{data.leadStats.total}</span></Link>}>
                  <ul className="flex flex-col gap-1 px-3 py-2" data-testid="leads-by-status">
                    {STATUSES.map((st) => {
                      const v = data.leadStats.byStatus[st];
                      return (
                        <li key={st} className="grid grid-cols-[120px_1fr_40px] items-center gap-2 text-[13px]">
                          <Pill tone={STATUS_TONE[st]}>{te(`leadStatus.${st}`)}</Pill>
                          <span className="h-1.5 rounded-full bg-subtle"><span className="block h-1.5 rounded-full bg-fg-secondary" style={{ width: `${data.leadStats.total ? (v / data.leadStats.total) * 100 : 0}%` }} /></span>
                          <span className="text-right tabular-nums">{v}</span>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
                <Panel className="min-h-0 flex-1" title={tm("recentActions")} bodyClassName="overflow-auto">
                  {data.recent.length === 0 ? <EmptyState title={tm("recentEmpty")} /> : (
                    <ul data-testid="recent-actions">
                      {data.recent.map((e) => (
                        <li key={e.id} className="flex h-8 items-center gap-2 border-b border-line px-3 text-[13px] last:border-b-0">
                          <span className="w-24 shrink-0 truncate whitespace-nowrap text-xs text-fg-faint">{relativeTime(e.createdAt)}</span>
                          <span className="shrink-0 text-xs text-fg-muted">{e.actorKind === "ai" ? tl("ai") : e.actorKind === "system" ? tl("system") : members.find((m) => m.userId === e.actorId)?.name ?? "—"}</span>
                          <span className="shrink-0 text-xs text-fg-secondary">{tl(`events.${e.action}`)}{e.action === "status" ? ` → ${te(`leadStatus.${String(e.after)}` as "leadStatus.new")}` : ""}</span>
                          <Link href={`/app/leads?open=${e.leadId}`} className="min-w-0 flex-1 truncate hover:underline"><span className="tabular-nums text-fg-faint">#{e.leadNumber}</span> {e.leadTitle}</Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </>
            ) : (
            <Panel title={t("status")} aside={<Link href="/app/assistant" className="text-xs text-fg-muted hover:text-fg">{t("setup")}</Link>}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-3 text-[13px]">
                <dt className="text-xs text-fg-muted">{t("aiStatus")}</dt>
                <dd><Pill tone={data.status.aiMode === "on" ? "success" : data.status.aiMode === "off" ? "danger" : data.status.aiMode === "leads_only" ? "warning" : "neutral"}>{ta(data.status.aiMode)}</Pill></dd>
                <dt className="text-xs text-fg-muted">{t("lines")}</dt>
                <dd className="tabular-nums">{t("linesValue", { busy: data.status.linesBusy, total: data.status.linesTotal })}</dd>
                <dt className="text-xs text-fg-muted">{t("numbers")}</dt>
                <dd className="flex flex-wrap gap-x-3 tabular-nums">{data.status.numbers.map((n) => <span key={n.id}>{formatPhone(n.e164)}</span>)}</dd>
                <dt className="text-xs text-fg-muted">{t("channels")}</dt>
                <dd>{integrationCount ? <Link href="/app/integrations" className="hover:underline">Telegram</Link> : "—"}</dd>
                <dt className="text-xs text-fg-muted">{t("lastPublish")}</dt>
                <dd>{data.status.lastPublish ? <Link href="/app/knowledge" className="hover:underline">v{data.status.lastPublish.version} · {relativeTime(data.status.lastPublish.publishedAt!)}</Link> : "—"}</dd>
              </dl>
            </Panel>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Столбики за сегодня, вчера — пунктиром. Клик по часу ведёт в звонки за час. */
function HourChart({ today, yesterday }: { today: number[]; yesterday: number[] }) {
  const from = 7, to = 23;
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const max = Math.max(1, ...today.slice(from, to), ...yesterday.slice(from, to));
  const nowH = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bishkek", hour: "2-digit", hour12: false }).format(new Date()));
  return (
    <div className="flex h-36 items-end gap-1 px-3 pb-2 pt-3">
      {hours.map((h) => {
        const v = today[h] ?? 0;
        const y = yesterday[h] ?? 0;
        return (
          <Link key={h} href={`/app/calls?view=today&hour=${h}`} className="group flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${h}:00 — ${v}`}>
            <div className="relative flex w-full flex-1 items-end justify-center">
              <div className="absolute inset-x-0 border-t border-dashed border-fg-faint" style={{ bottom: `${(y / max) * 100}%` }} />
              <div className={cn("w-full max-w-5 rounded-t-[3px] transition-colors group-hover:bg-fg", h > nowH ? "bg-transparent" : "bg-fg-secondary/80")} style={{ height: `${(v / max) * 100}%` }} />
            </div>
            <span className={cn("text-[10px] tabular-nums", h === nowH ? "text-fg" : "text-fg-faint")}>{h}</span>
          </Link>
        );
      })}
    </div>
  );
}
