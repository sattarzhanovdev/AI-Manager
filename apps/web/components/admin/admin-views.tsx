"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogIn, Play } from "lucide-react";
import { Button, DataTable, Field, Input, PageHeader, Pill, Sheet, UsageBar, cn, toast, type ColumnDef, type Tone } from "@all/ui";
import type { AdminCompany, DemoCall, DemoLead, ModerationItem } from "@/lib/data/types";
import { supportLogin } from "@/lib/actions";
import { formatDuration, formatMoney, formatPhone, relativeTime } from "@/lib/format";

const STATUS_TONE: Record<AdminCompany["status"], Tone> = { active: "success", moderation: "info", onboarding: "warning", suspended: "danger", closed: "neutral" };

export function CompaniesView({ rows }: { rows: AdminCompany[] }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [open, setOpen] = React.useState<AdminCompany>();
  const [ticket, setTicket] = React.useState("");
  const cols = React.useMemo<ColumnDef<AdminCompany, unknown>[]>(() => [
    { id: "name", header: t("cols.name"), size: 220, accessorFn: (r) => r.name },
    { id: "status", header: t("cols.status"), size: 170, accessorFn: (r) => r.readiness, cell: ({ row }) => <span className="flex items-center gap-2"><Pill tone={STATUS_TONE[row.original.status]}>{row.original.status}</Pill><span className="text-xs tabular-nums text-fg-muted">{row.original.readiness}%</span></span> },
    { id: "plan", header: t("cols.plan"), size: 90, accessorFn: (r) => r.plan },
    { id: "minutes", header: t("cols.minutes"), size: 90, meta: { align: "right" }, accessorFn: (r) => r.minutesUsed },
    { id: "cost", header: t("cols.cost"), size: 110, meta: { align: "right" }, accessorFn: (r) => r.costMinor, cell: ({ row }) => formatMoney(row.original.costMinor, "KGS") },
    { id: "margin", header: t("cols.margin"), size: 90, meta: { align: "right" }, accessorFn: (r) => (r.revenueMinor ? (r.revenueMinor - r.costMinor) / r.revenueMinor : 0),
      cell: ({ row }) => { const m = row.original.revenueMinor ? Math.round(((row.original.revenueMinor - row.original.costMinor) / row.original.revenueMinor) * 100) : 0; return <span className={m < 20 ? "text-danger" : ""}>{m}%</span>; } },
    { id: "kb", header: t("cols.kb"), size: 80, meta: { align: "right" }, accessorFn: (r) => r.kbIndex, cell: ({ row }) => `${row.original.kbIndex}%` },
    { id: "activity", header: t("cols.activity"), size: 120, accessorFn: (r) => r.lastActivityAt, cell: ({ row }) => <span className="text-fg-muted">{relativeTime(row.original.lastActivityAt)}</span> },
  ], [t]);
  return (
    <>
      <PageHeader title={t("nav.companies")} meta={rows.length} />
      <DataTable data={rows} columns={cols} getRowId={(r) => r.id} onOpen={setOpen} activeId={open?.id} storageKey="admin:companies" />
      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(undefined)} title={open?.name ?? ""} width={480}
        footer={<Button variant="primary" icon={<LogIn />} disabled={ticket.length < 3} onClick={async () => { const r = await supportLogin(open!.id, ticket); if (r.ok) { router.push("/app"); router.refresh(); } else toast.error(r.error); }}>{t("loginAs")}</Button>}>
        {open && (
          <div className="flex flex-col gap-4">
            <UsageBar label="Минуты" used={open.minutesUsed} total={1500} unit="мин" />
            <dl className="grid grid-cols-2 gap-2 text-[13px]"><dt className="text-fg-muted">Сфера</dt><dd>{open.sphere}</dd><dt className="text-fg-muted">Выручка</dt><dd>{formatMoney(open.revenueMinor, "KGS")}</dd><dt className="text-fg-muted">Себестоимость</dt><dd>{formatMoney(open.costMinor, "KGS")}</dd></dl>
            <Field label={t("ticket")}><Input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="#2207" /></Field>
            <p className="text-xs text-fg-faint">Вход пишется в аудит компании, в кабинете показывается полоса «Вы смотрите как поддержка».</p>
          </div>
        )}
      </Sheet>
    </>
  );
}

export function DemoLineView({ calls }: { calls: DemoCall[] }) {
  const t = useTranslations("admin");
  const spent = calls.filter((c) => Date.now() - new Date(c.createdAt).getTime() < 86400_000).reduce((s, c) => s + c.costMinor, 0);
  const roles = ["autoservice", "clinic", "salon", "dental", "polyclinic"];
  const byRole = roles.map((r) => ({ r, n: calls.filter((c) => c.roles.includes(r)).length }));
  return (
    <>
      <PageHeader title={t("nav.demo")} meta={t("demoLimits")} />
      <div className="grid shrink-0 grid-cols-1 gap-3 border-b border-line p-3 md:grid-cols-3">
        <div className="rounded-[12px] border border-line bg-bg p-3"><UsageBar label={t("demoBudget")} used={Math.round(spent / 100)} total={500} unit="$" /></div>
        <div className="rounded-[12px] border border-line bg-bg p-3 md:col-span-2">
          <p className="mb-2 text-xs text-fg-muted">{t("demoRoles")}</p>
          <div className="flex flex-wrap gap-2">{byRole.map(({ r, n }) => <span key={r} className="inline-flex h-7 items-center gap-2 rounded-full border border-line px-2.5 text-xs">{r}<span className="tabular-nums text-fg-muted">{n}</span></span>)}</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0"><tr className="[&>th]:h-8 [&>th]:border-b [&>th]:border-line [&>th]:bg-subtle [&>th]:px-3 [&>th]:text-left [&>th]:text-xs [&>th]:font-normal [&>th]:text-fg-muted"><th>Когда</th><th>Номер</th><th>Роль</th><th className="text-right">Длит.</th><th className="text-right">Стоимость</th><th>SMS</th><th /></tr></thead>
          <tbody>{calls.map((c) => (
            <tr key={c.id} className="[&>td]:h-8 [&>td]:border-b [&>td]:border-line [&>td]:px-3 hover:bg-hover">
              <td className="text-fg-muted">{relativeTime(c.createdAt)}</td><td className="tabular-nums">{formatPhone(c.caller)}</td><td>{c.roles.join(", ")}</td>
              <td className="text-right tabular-nums">{formatDuration(c.durationS)}</td><td className="text-right tabular-nums">${(c.costMinor / 100).toFixed(2)}</td>
              <td>{c.summarySent ? <Pill tone="success">отправлено</Pill> : <Pill>нет</Pill>}</td>
              <td className="text-right"><a href={`/demo/${c.token}`} className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs text-fg-muted hover:bg-hover"><Play className="size-3" />{t("listen")}</a></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

const LEAD_TONE: Record<DemoLead["status"], Tone> = { new: "info", contacted: "neutral", meeting: "warning", won: "success", lost: "neutral" };
export function DemoLeadsView({ rows }: { rows: DemoLead[] }) {
  const t = useTranslations("admin");
  const cols = React.useMemo<ColumnDef<DemoLead, unknown>[]>(() => [
    { id: "phone", header: t("leadCols.phone"), size: 160, accessorFn: (r) => r.phone, cell: ({ row }) => <span className="tabular-nums">{formatPhone(row.original.phone)}</span> },
    { id: "calls", header: t("leadCols.calls"), size: 80, meta: { align: "right" }, accessorFn: (r) => r.calls },
    { id: "roles", header: t("leadCols.roles"), size: 180, accessorFn: (r) => r.roles.join(", ") },
    { id: "consent", header: t("leadCols.consent"), size: 100, accessorFn: (r) => r.consent, cell: ({ row }) => (row.original.consent ? "Да" : <span className="text-fg-faint">Нет</span>) },
    { id: "status", header: t("leadCols.status"), size: 120, accessorFn: (r) => r.status, cell: ({ row }) => <Pill tone={LEAD_TONE[row.original.status]}>{row.original.status}</Pill> },
    { id: "owner", header: t("leadCols.owner"), size: 120, accessorFn: (r) => r.owner ?? "" },
    { id: "utm", header: t("leadCols.utm"), size: 140, accessorFn: (r) => r.utm ?? "", cell: ({ row }) => <span className="font-mono text-xs text-fg-muted">{row.original.utm}</span> },
    { id: "go", header: "", size: 130, enableSorting: false, cell: ({ row }) => <a href={`/signup?phone=${encodeURIComponent(row.original.phone)}`} className="text-xs underline">{t("toSignup")}</a> },
  ], [t]);
  return <><PageHeader title={t("nav.leads")} meta={rows.length} /><DataTable data={rows} columns={cols} getRowId={(r) => r.id} storageKey="admin:leads" /></>;
}

export function ModerationView({ rows }: { rows: ModerationItem[] }) {
  const t = useTranslations("admin");
  const [items, setItems] = React.useState(rows);
  return (
    <>
      <PageHeader title={t("moderationQueue")} meta={items.filter((i) => i.status === "queued" || i.status === "in_review").length} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ul className="flex flex-col gap-3">
          {items.map((m) => {
            const left = new Date(m.slaDueAt).getTime() - Date.now();
            return (
              <li key={m.id} className="rounded-[12px] border border-line bg-bg">
                <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
                  <span className="text-[13px] font-medium">{m.company}</span><span className="text-xs text-fg-muted">анкета v{m.version}</span>
                  <Pill tone={m.status === "approved" ? "success" : m.status === "rejected" ? "danger" : "info"}>{m.status}</Pill>
                  <span className={cn("ml-auto text-xs tabular-nums", left < 2 * 3600_000 ? "text-danger" : "text-fg-muted")}>{t("sla")}: {Math.max(0, Math.round(left / 3600_000))} ч</span>
                  <Button size="sm" onClick={() => setItems((l) => l.map((x) => (x.id === m.id ? { ...x, status: "rejected" } : x)))}>{t("reject")}</Button>
                  <Button size="sm" variant="primary" onClick={() => { setItems((l) => l.map((x) => (x.id === m.id ? { ...x, status: "approved" } : x))); toast("Компания активирована"); }}>{t("approve")}</Button>
                </div>
                <div className="px-3 py-2">
                  <p className="mb-1.5 text-xs text-fg-muted">{t("findings")}</p>
                  <ul className="flex flex-col gap-1.5">{m.findings.map((f) => (
                    <li key={f.quote} className="flex items-start gap-2 text-[13px]"><Pill tone={f.severity === "high" ? "danger" : "warning"}>{f.rule}</Pill><q className="text-fg-secondary">{f.quote}</q></li>
                  ))}</ul>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

export function PlaceholderView({ title, rows }: { title: string; rows: [string, string][] }) {
  const t = useTranslations("admin");
  return (
    <>
      <PageHeader title={title} />
      <div className="p-3">
        <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">{rows.map(([k, v]) => <div key={k} className="rounded-[12px] border border-line bg-bg p-3"><dt className="text-xs text-fg-muted">{k}</dt><dd className="font-display text-xl tabular-nums">{v}</dd></div>)}</dl>
        <p className="mt-3 text-xs text-fg-faint">{t("placeholder")}</p>
      </div>
    </>
  );
}
