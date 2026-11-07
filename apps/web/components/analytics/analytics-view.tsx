"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Expand, Lock, Table2, BarChart3 } from "lucide-react";
import { PageHeader, Panel, Select, Sheet, cn } from "@all/ui";
import type { getAnalytics } from "@/lib/data/queries";

type Data = ReturnType<typeof getAnalytics>;
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function AnalyticsView({ data, days, branches }: { data: Data; days: number; branches: { id: string; name: string }[] }) {
  const t = useTranslations("analytics");
  const te = useTranslations("enums");
  const router = useRouter();
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [asTable, setAsTable] = React.useState<Record<string, boolean>>({});

  const charts: { key: string; title: string; render: (big: boolean) => React.ReactNode; table: () => React.ReactNode }[] = [
    {
      key: "funnel", title: t("funnel"),
      render: () => <Funnel steps={data.funnel.map((f) => ({ label: t(`funnelSteps.${f.key}`), value: f.value, href: f.key === "leads" || f.key === "won" ? `/app/leads${f.key === "won" ? "?view=all" : ""}` : `/app/calls${f.key === "target" ? "" : ""}` }))} />,
      table: () => <SimpleTable head={["Шаг", "Значение"]} rows={data.funnel.map((f) => [t(`funnelSteps.${f.key}`), f.value])} />,
    },
    {
      key: "load", title: t("load"),
      render: (big) => <Heatmap heat={data.heat} big={big} />,
      table: () => <SimpleTable head={["День", ...Array.from({ length: 24 }, (_, h) => String(h))]} rows={data.heat.map((r, i) => [DAYS[i]!, ...r])} />,
    },
    {
      key: "handoffs", title: t("handoffs"),
      render: () => (
        <div className="flex flex-col gap-3 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Link href="/app/calls?view=all" className="rounded-[10px] border border-line p-2 hover:bg-hover"><p className="text-xs text-fg-muted">{t("share")}</p><p className="font-display text-xl tabular-nums">{Math.round(data.transfers.share * 100)}%</p></Link>
            <div className="rounded-[10px] border border-line p-2"><p className="text-xs text-fg-muted">{t("answeredByStaff")}</p><p className="font-display text-xl tabular-nums">{data.transfers.total ? Math.round((data.transfers.answered / data.transfers.total) * 100) : 0}%</p></div>
          </div>
          <p className="text-xs text-fg-muted">{t("reasons")}</p>
          <ul className="flex flex-col gap-1.5">
            {Object.entries(data.transfers.reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k}><Link href="/app/calls" className="group flex items-center gap-2 text-[13px]">
                <span className="w-40 truncate">{te(`handoffReason.${k}` as "handoffReason.complaint")}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-active"><span className="block h-full rounded-full bg-fg-secondary group-hover:bg-fg" style={{ width: `${(v / data.transfers.total) * 100}%` }} /></span>
                <span className="w-8 text-right tabular-nums text-fg-muted">{v}</span>
              </Link></li>
            ))}
          </ul>
        </div>
      ),
      table: () => <SimpleTable head={["Причина", "Звонков"]} rows={Object.entries(data.transfers.reasons).map(([k, v]) => [te(`handoffReason.${k}` as "handoffReason.complaint"), v])} />,
    },
    {
      key: "byDay", title: t("byDay"),
      render: (big) => <ByDay rows={data.byDay} big={big} />,
      table: () => <SimpleTable head={["День", t("callsCount"), t("leadsCount")]} rows={data.byDay.map((d) => [d.day, d.calls, d.leads])} />,
    },
  ];
  const locked = [t("topics"), t("quality"), t("chats")];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t("title")}>
        <Select size_="sm" value={String(days)} onChange={(e) => router.push(`/app/analytics?days=${e.target.value}`)} className="w-36" aria-label={t("period")}>
          <option value="7">7 дней</option><option value="30">30 дней</option>
        </Select>
        <Select size_="sm" className="w-36" aria-label={t("branch")}><option>Все филиалы</option>{branches.map((b) => <option key={b.id}>{b.name}</option>)}</Select>
        <Select size_="sm" className="w-32" aria-label={t("channel")}><option>Все каналы</option><option>Телефон</option></Select>
      </PageHeader>
      <div className="grid min-h-0 flex-1 auto-rows-[minmax(260px,1fr)] grid-cols-1 gap-3 overflow-auto p-3 md:grid-cols-2 xl:grid-cols-3">
        {charts.map((c) => (
          <Panel key={c.key} title={c.title} bodyClassName="overflow-auto" aside={
            <span className="flex gap-0.5">
              <button aria-label={asTable[c.key] ? t("asChart") : t("asTable")} onClick={() => setAsTable((x) => ({ ...x, [c.key]: !x[c.key] }))} className="inline-flex size-6 items-center justify-center rounded-full text-fg-faint hover:bg-hover hover:text-fg">{asTable[c.key] ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}</button>
              <button aria-label={t("expand")} onClick={() => setExpanded(c.key)} className="inline-flex size-6 items-center justify-center rounded-full text-fg-faint hover:bg-hover hover:text-fg"><Expand className="size-3.5" /></button>
            </span>
          }>
            {asTable[c.key] ? c.table() : c.render(false)}
          </Panel>
        ))}
        {locked.map((l) => (
          <Panel key={l} title={l} aside={<Lock className="size-3.5 text-fg-faint" />}>
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-fg-faint">{t("laterPhase")}</div>
          </Panel>
        ))}
      </div>
      {expanded && (
        <Sheet open onOpenChange={(v) => !v && setExpanded(null)} title={charts.find((c) => c.key === expanded)!.title} width={Math.min(1100, typeof window !== "undefined" ? window.innerWidth : 1100)}>
          <div className="flex flex-col gap-4">{charts.find((c) => c.key === expanded)!.render(true)}{charts.find((c) => c.key === expanded)!.table()}</div>
        </Sheet>
      )}
    </div>
  );
}

function Funnel({ steps }: { steps: { label: string; value: number; href: string }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ol className="flex flex-col gap-2 p-3">
      {steps.map((s, i) => (
        <li key={s.label}>
          <Link href={s.href} className="group flex flex-col gap-1">
            <span className="flex items-baseline justify-between text-xs"><span className="text-fg-muted">{s.label}</span>
              <span className="tabular-nums"><span className="text-[13px] text-fg">{s.value}</span>{i > 0 && <span className="ml-1.5 text-fg-faint">{Math.round((s.value / Math.max(1, steps[i - 1]!.value)) * 100)}%</span>}</span>
            </span>
            <span className="h-6 overflow-hidden rounded-[6px] bg-active"><span className="block h-full rounded-[6px] bg-fg-secondary transition-colors group-hover:bg-fg" style={{ width: `${(s.value / max) * 100}%` }} /></span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function Heatmap({ heat, big }: { heat: number[][]; big: boolean }) {
  const max = Math.max(1, ...heat.flat());
  const hours = big ? Array.from({ length: 24 }, (_, i) => i) : Array.from({ length: 15 }, (_, i) => i + 7);
  return (
    <div className="p-3">
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: `24px repeat(${hours.length}, minmax(0,1fr))` }}>
        <span />
        {hours.map((h) => <span key={h} className="text-center text-[9px] tabular-nums text-fg-faint">{h}</span>)}
        {heat.map((row, d) => (
          <React.Fragment key={d}>
            <span className="text-[10px] leading-5 text-fg-muted">{DAYS[d]}</span>
            {hours.map((h) => {
              const v = row[h] ?? 0;
              return <Link key={h} href={`/app/calls?view=all`} title={`${DAYS[d]} ${h}:00 — ${v}`} className={cn("rounded-[3px] hover:ring-1 hover:ring-fg", big ? "h-8" : "h-5")} style={{ background: v ? `rgba(237,237,237,${0.08 + (v / max) * 0.82})` : "var(--bg-active)" }} />;
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function ByDay({ rows, big }: { rows: { day: string; calls: number; leads: number }[]; big: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.calls));
  return (
    <div className={cn("flex items-end gap-[3px] px-3 pb-2 pt-3", big ? "h-80" : "h-full min-h-40")}>
      {rows.map((r) => (
        <Link key={r.day} href={`/app/calls?view=all`} title={`${r.day}: ${r.calls} / ${r.leads}`} className="group relative flex h-full flex-1 flex-col justify-end">
          <span className="block w-full rounded-t-[2px] bg-fg-faint/60 group-hover:bg-fg-secondary" style={{ height: `${(r.calls / max) * 100}%` }} />
          <span className="absolute bottom-0 block w-full rounded-t-[2px] bg-fg-secondary group-hover:bg-fg" style={{ height: `${(r.leads / max) * 100}%` }} />
        </Link>
      ))}
    </div>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-xs">
      <thead><tr>{head.map((h) => <th key={h} className="sticky top-0 h-7 border-b border-line bg-subtle px-2 text-left font-normal text-fg-muted">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={cn("h-7 border-b border-line px-2", typeof c === "number" && "text-right tabular-nums")}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}
