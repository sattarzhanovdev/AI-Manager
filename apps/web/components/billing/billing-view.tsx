"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Download, Plus } from "lucide-react";
import { Button, Field, Input, Menu, MenuContent, MenuItem, MenuTrigger, PageHeader, Panel, Pill, UsageBar, cn, toast, type Tone } from "@all/ui";
import type { Invoice, Plan, Usage } from "@all/db";
import { buyMinutes, setOverage } from "@/lib/actions";
import { formatDate, formatMoney } from "@/lib/format";

const INV_TONE: Record<Invoice["status"], Tone> = { draft: "neutral", issued: "info", paid: "success", overdue: "danger", void: "neutral" };

export function BillingView({ usage, plan, plans, invoices, canManage }: { usage: Usage & { forecast: number }; plan: Plan; plans: Plan[]; invoices: Invoice[]; canManage: boolean }) {
  const t = useTranslations("billing");
  const te = useTranslations("enums");
  const ta = useTranslations("assistant");
  const tc = useTranslations("common");
  const router = useRouter();
  const [policy, setPolicy] = React.useState(usage.overagePolicy);
  const [cap, setCap] = React.useState(String((usage.overageCapMinor ?? 0) / 100));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t("title")} meta={t("period", { from: formatDate(usage.periodStart), to: formatDate(usage.periodEnd) })} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="grid shrink-0 grid-cols-1 gap-4 rounded-[12px] border border-line bg-bg p-4 md:grid-cols-3">
          <div className="flex flex-col gap-1"><UsageBar label={t("minutes")} used={usage.minutesUsed} total={usage.minutesTotal} unit={tc("minutes")} forecast={usage.forecast} /><span className="text-xs text-fg-faint">{t("forecast", { count: usage.forecast.toLocaleString("ru-RU") })}</span></div>
          <UsageBar label={t("dialogs")} used={usage.dialogsUsed} total={usage.dialogsTotal} unit="" />
          <UsageBar label={t("lines")} used={usage.linesBusy} total={usage.linesTotal} unit="" />
        </div>
        <div className="grid shrink-0 grid-cols-1 gap-3 lg:grid-cols-2">
          <Panel title={t("current")} aside={<span className="text-xs text-fg-muted">{formatMoney(plan.priceMinor, plan.currency)} {t("perMonth")}</span>}>
            <div className="flex flex-col gap-3 p-3">
              <div className="flex items-baseline gap-3"><span className="font-display text-2xl font-medium tracking-[-0.03em]">{plan.name}</span></div>
              <dl className="grid grid-cols-3 gap-2 text-[13px]">
                <div><dt className="text-xs text-fg-muted">{t("minutes")}</dt><dd className="tabular-nums">{plan.minutes.toLocaleString("ru-RU")}</dd></div>
                <div><dt className="text-xs text-fg-muted">{t("dialogs")}</dt><dd className="tabular-nums">{plan.aiDialogs.toLocaleString("ru-RU")}</dd></div>
                <div><dt className="text-xs text-fg-muted">{t("lines")}</dt><dd className="tabular-nums">{plan.lines}</dd></div>
              </dl>
              <p className="text-xs text-fg-muted">{t("modes")}: {plan.modes.map((m) => ta(`modes.${m}`)).join(", ")}</p>
              <div className="flex flex-wrap gap-1.5">
                <Menu>
                  <MenuTrigger disabled={!canManage} className="inline-flex h-8 items-center rounded-full border border-line-strong px-3 text-[13px] hover:bg-hover disabled:opacity-50">{t("change")}</MenuTrigger>
                  <MenuContent align="start">{plans.map((p) => <MenuItem key={p.key} icon={p.key === plan.key ? <Check /> : undefined} onSelect={() => toast("Смена тарифа — со следующего периода, менеджер свяжется с вами")}>{p.name} · {formatMoney(p.priceMinor, p.currency)}</MenuItem>)}</MenuContent>
                </Menu>
                {([100, 500, 1000] as const).map((n) => (
                  <Button key={n} icon={<Plus />} disabled={!canManage} onClick={async () => { const r = await buyMinutes(n); if (r.ok) { toast.success(t("bought", { number: r.data! })); router.refresh(); } else toast.error(r.error); }}>{t("buyPack", { count: n })}</Button>
                ))}
              </div>
              <p className="text-xs text-fg-faint">{t("cardsSoon")}</p>
            </div>
          </Panel>
          <Panel title={t("overage")}>
            <div className="flex flex-col gap-2 p-3">
              {(["pay", "stop_ai"] as const).map((p) => (
                <label key={p} className={cn("flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2 text-[13px]", policy === p ? "border-fg-muted bg-active" : "border-line")}>
                  <input type="radio" name="overage" checked={policy === p} disabled={!canManage} onChange={() => setPolicy(p)} className="accent-[var(--text)]" />
                  {p === "pay" ? t("overagePay") : t("overageStop")}
                </label>
              ))}
              {policy === "pay" && <Field label={`${t("overageCap")}, сом`}><Input type="number" value={cap} onChange={(e) => setCap(e.target.value)} className="w-40" /></Field>}
              <Button variant="primary" className="w-fit" disabled={!canManage} onClick={async () => { const r = await setOverage(policy, policy === "pay" ? Math.round(Number(cap) * 100) : undefined); if (r.ok) toast(tc("saved")); else toast.error(r.error); }}>{tc("save")}</Button>
            </div>
          </Panel>
        </div>
        <Panel title={t("invoices")} className="shrink-0">
          <table className="w-full text-[13px]">
            <thead><tr className="[&>th]:h-8 [&>th]:border-b [&>th]:border-line [&>th]:bg-subtle [&>th]:px-3 [&>th]:text-left [&>th]:text-xs [&>th]:font-normal [&>th]:text-fg-muted">
              <th>{t("colNumber")}</th><th>{t("colPeriod")}</th><th className="text-right">{t("colAmount")}</th><th>{t("colStatus")}</th><th className="w-20" />
            </tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="[&>td]:h-9 [&>td]:border-b [&>td]:border-line [&>td]:px-3 hover:bg-hover">
                  <td className="font-mono text-xs">{i.number}</td>
                  <td className="text-fg-muted">{formatDate(i.periodStart)} — {formatDate(i.periodEnd)}</td>
                  <td className="text-right tabular-nums">{formatMoney(i.amountMinor, i.currency)}</td>
                  <td><Pill tone={INV_TONE[i.status]}>{te(`invoiceStatus.${i.status}`)}</Pill></td>
                  <td className="text-right"><a href={`/api/invoices/${i.id}/pdf`} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs text-fg-muted hover:bg-hover hover:text-fg"><Download className="size-3.5" />{t("download")}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
