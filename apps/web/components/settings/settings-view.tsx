"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Copy, KeyRound, ShieldCheck, Trash2, Download, Lock } from "lucide-react";
import { Button, ConfirmDialog, Field, Input, PageHeader, Pill, Select, cn, toast } from "@all/ui";
import type { AuditEntry, Branch, Company, Member } from "@all/db";
import type { ApiKey, NotificationPref, PhoneNumber } from "@/lib/data/types";
import { createApiKey, eraseByPhone, requestExport, revokeApiKey, setLocale, setNotificationPref, updateCompany } from "@/lib/actions";
import { formatDateTime, formatPhone } from "@/lib/format";

import { SessionList, type SessionItem } from "./session-list";
import { TABS, type Tab } from "./tabs";

interface Props {
  sessions?: SessionItem[];
  tab: Tab; company: Company; branches: Branch[]; numbers: PhoneNumber[]; members: Member[]; prefs: Record<string, NotificationPref[]>;
  apiKeys: ApiKey[]; audit: AuditEntry[]; me: Member; isOwner: boolean; locale: string;
}

export function SettingsView(p: Props) {
  const t = useTranslations("settings");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t("title")} />
      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <nav aria-label={t("title")} className="flex shrink-0 gap-0.5 border-line p-2 md:w-52 md:flex-col md:border-r max-md:overflow-x-auto max-md:border-b">
          {TABS.map((x) => (
            <Link key={x} href={`/app/settings/${x}`} aria-current={p.tab === x ? "page" : undefined}
              className={cn("flex h-8 shrink-0 items-center rounded-[8px] px-2.5 text-[13px]", p.tab === x ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}>
              {t(`tabs.${x}`)}
            </Link>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="max-w-[960px] px-4 py-4 xl:px-6">
            {p.tab === "company" && <CompanyTab {...p} />}
            {p.tab === "branches" && <BranchesTab branches={p.branches} />}
            {p.tab === "notifications" && <NotificationsTab members={p.isOwner ? p.members.filter((m) => !m.disabledAt) : [p.me]} prefs={p.prefs} />}
            {p.tab === "numbers" && <NumbersTab numbers={p.numbers} branches={p.branches} />}
            {p.tab === "api" && <ApiTab keys={p.apiKeys} canManage={p.isOwner} />}
            {p.tab === "webhooks" && <Locked text={t("webhooksPhase")} />}
            {p.tab === "data" && <DataTab canManage={p.isOwner} />}
            {p.tab === "security" && <SecurityTab audit={p.audit} isOwner={p.isOwner} sessions={p.sessions} />}
          </div>
        </div>
      </div>
    </div>
  );
}

const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-3 font-display text-[15px] font-medium tracking-[-0.01em]">{children}</h2>;
function Locked({ text }: { text: string }) { return <p className="flex items-center gap-2 rounded-[10px] border border-line p-4 text-[13px] text-fg-muted"><Lock className="size-4" />{text}</p>; }

function CompanyTab({ company, isOwner, locale }: Props) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [name, setName] = React.useState(company.name);
  const [tz, setTz] = React.useState(company.timezone);
  const [currency, setCurrency] = React.useState(company.currency);
  return (
    <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); const r = await updateCompany({ name, timezone: tz, currency }); if (r.ok) { toast(tc("saved")); router.refresh(); } else toast.error(r.error); }}>
      <Field label={t("companyName")}><Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isOwner} /></Field>
      <Field label={t("sphere")}><Input value={company.sphere} disabled /></Field>
      <Field label={t("timezone")}><Select value={tz} onChange={(e) => setTz(e.target.value)} disabled={!isOwner}>{["Asia/Bishkek", "Asia/Almaty", "Europe/Moscow", "Asia/Novosibirsk"].map((z) => <option key={z}>{z}</option>)}</Select></Field>
      <Field label={t("currency")}><Select value={currency} onChange={(e) => setCurrency(e.target.value as Company["currency"])} disabled={!isOwner}>{["KGS", "KZT", "RUB", "USD"].map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <Field label={t("locale")}><Select value={locale} onChange={async (e) => { await setLocale(e.target.value as "ru"); router.refresh(); }}><option value="ru">Русский</option><option value="ky">Кыргызча</option></Select></Field>
      <div className="md:col-span-2"><Button variant="primary" disabled={!isOwner}>{tc("save")}</Button></div>
    </form>
  );
}

function BranchesTab({ branches }: { branches: Branch[] }) {
  const t = useTranslations("settings");
  const te = useTranslations("enums.weekday");
  return (
    <>
      <H>{t("tabs.branches")}</H>
      <table className="w-full text-[13px]">
        <thead><tr className="[&>th]:h-8 [&>th]:border-b [&>th]:border-line [&>th]:px-2 [&>th]:text-left [&>th]:text-xs [&>th]:font-normal [&>th]:text-fg-muted"><th>{t("branchName")}</th><th>{t("address")}</th><th>{t("hours")}</th></tr></thead>
        <tbody>{branches.map((b) => (
          <tr key={b.id} className="[&>td]:border-b [&>td]:border-line [&>td]:px-2 [&>td]:py-2 align-top">
            <td className="font-medium">{b.name}</td>
            <td><span className="block">{b.address}</span><span className="text-xs text-fg-muted">{b.landmarks}</span></td>
            <td className="text-xs text-fg-secondary">{(Object.entries(b.hours) as [keyof typeof b.hours, [string, string][]][]).map(([d, r]) => <span key={d} className="mr-2 inline-block">{te(d)} {r.length ? `${r[0]![0]}–${r[0]![1]}` : "—"}</span>)}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="mt-2 text-xs text-fg-faint">График и адрес редактируются в анкете (блок 2) — так AI всегда отвечает по актуальным данным. <Link href="/app/knowledge?block=2" className="underline">Открыть</Link></p>
    </>
  );
}

const EVENTS = ["lead_new", "lead_urgent", "complaint", "call_missed", "limit_80", "integration_error", "payment_due", "kb_published"] as const;
const CHANNELS = ["app", "telegram", "email", "push"] as const;
function NotificationsTab({ members, prefs }: { members: Member[]; prefs: Record<string, NotificationPref[]> }) {
  const t = useTranslations("settings");
  const [state, setState] = React.useState(prefs);
  const [who, setWho] = React.useState(members[0]?.userId ?? "");
  const list = state[who] ?? [];
  const toggle = async (kind: string, ch: (typeof CHANNELS)[number], on: boolean) => {
    setState((s) => ({ ...s, [who]: (s[who] ?? []).map((p) => (p.kind === kind ? { ...p, channels: on ? [...p.channels, ch] : p.channels.filter((c) => c !== ch) } : p)) }));
    const r = await setNotificationPref(who, kind, ch, on);
    if (!r.ok) toast.error(r.error);
  };
  return (
    <>
      <div className="mb-3 flex items-center gap-3"><H>{t("notifMatrix")}</H>
        {members.length > 1 && <Select className="ml-auto w-60" value={who} onChange={(e) => setWho(e.target.value)} aria-label={t("member")}>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select>}
      </div>
      <table className="w-full text-[13px]">
        <thead><tr className="[&>th]:h-8 [&>th]:border-b [&>th]:border-line [&>th]:px-2 [&>th]:text-xs [&>th]:font-normal [&>th]:text-fg-muted"><th className="text-left" />{CHANNELS.map((c) => <th key={c} className="w-24 text-center">{t(`channels.${c}`)}</th>)}</tr></thead>
        <tbody>{EVENTS.map((ev) => {
          const p = list.find((x) => x.kind === ev);
          return (
            <tr key={ev} className="[&>td]:h-9 [&>td]:border-b [&>td]:border-line [&>td]:px-2">
              <td>{t(`events.${ev}`)}</td>
              {CHANNELS.map((c) => <td key={c} className="text-center"><input type="checkbox" aria-label={`${t(`events.${ev}`)} — ${t(`channels.${c}`)}`} checked={!!p?.channels.includes(c)} disabled={c === "push"} onChange={(e) => toggle(ev, c, e.target.checked)} className="size-3.5 accent-[var(--text)]" /></td>)}
            </tr>
          );
        })}</tbody>
      </table>
      <p className="mt-2 text-xs text-fg-faint">Жалобы и срочные заявки повторяются через 15 минут, если никто не взял.</p>
    </>
  );
}

function NumbersTab({ numbers, branches }: { numbers: PhoneNumber[]; branches: Branch[] }) {
  const t = useTranslations("settings");
  const te = useTranslations("enums");
  const ops = t.raw("forwardingOps") as Record<string, string>;
  return (
    <>
      <H>{t("tabs.numbers")}</H>
      <ul className="mb-5 rounded-[10px] border border-line">
        {numbers.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 text-[13px] last:border-b-0">
            <span className="w-40 tabular-nums">{formatPhone(n.e164)}</span>
            <span className="text-fg-muted">{branches.find((b) => b.id === n.branchId)?.name}</span>
            <Pill>{n.kind === "platform" ? "номер платформы" : "переадресация"}</Pill>
            <span className="ml-auto text-xs text-fg-muted">{te(`receive.${n.receive}`)}{n.receive === "no_answer" ? ` · ${n.noAnswerSeconds} с` : ""} · линий: {n.lines}</span>
          </li>
        ))}
      </ul>
      <H>{t("forwarding")}</H>
      <ul className="flex flex-col gap-1.5">{Object.entries(ops).map(([k, v]) => <li key={k} className="rounded-[10px] bg-subtle px-3 py-2 font-mono text-xs">{v.replace("{number}", "0312900100")}</li>)}</ul>
    </>
  );
}

function ApiTab({ keys, canManage }: { keys: ApiKey[]; canManage: boolean }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [shown, setShown] = React.useState<string>();
  return (
    <>
      <div className="mb-3 flex items-center gap-2"><H>{t("tabs.api")}</H><Pill className="mb-3">фаза 3</Pill></div>
      <form className="mb-4 flex gap-2" onSubmit={async (e) => { e.preventDefault(); const r = await createApiKey(name, ["leads:read", "calls:read"]); if (r.ok) { setShown(r.data); setName(""); router.refresh(); } else toast.error(r.error); }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("apiName")} className="w-64" disabled={!canManage} />
        <Button variant="primary" icon={<KeyRound />} disabled={!canManage || name.length < 2}>{t("apiCreate")}</Button>
      </form>
      {shown && (
        <div className="mb-4 rounded-[10px] border border-warning/40 bg-warning-bg p-3">
          <p className="mb-1.5 text-xs text-warning">{t("apiShownOnce")}</p>
          <div className="flex gap-1.5"><Input readOnly value={shown} className="font-mono" /><Button size="icon" aria-label={tc("copy")} onClick={() => { void navigator.clipboard.writeText(shown); toast(tc("copied")); }}><Copy /></Button></div>
        </div>
      )}
      <ul className="rounded-[10px] border border-line">
        {keys.length === 0 && <li className="px-3 py-4 text-center text-xs text-fg-muted">Ключей пока нет</li>}
        {keys.map((k) => (
          <li key={k.id} className="flex items-center gap-3 border-b border-line px-3 py-2 text-[13px] last:border-b-0">
            <span className="flex-1">{k.name}</span><span className="font-mono text-xs text-fg-muted">{k.prefix}…</span><span className="text-xs text-fg-faint">{k.scopes.join(", ")}</span>
            {k.revokedAt ? <Pill tone="neutral">{t("apiRevoked")}</Pill> : <Button size="sm" variant="ghost" disabled={!canManage} onClick={async () => { await revokeApiKey(k.id); router.refresh(); }}>{t("apiRevoke")}</Button>}
          </li>
        ))}
      </ul>
    </>
  );
}

function DataTab({ canManage }: { canManage: boolean }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [phone, setPhone] = React.useState("");
  const [confirm, setConfirm] = React.useState(false);
  if (!canManage) return <Locked text={tc("noAccessHint")} />;
  return (
    <div className="flex flex-col gap-6">
      <section><H>{t("export")}</H><Button icon={<Download />} onClick={async () => { const r = await requestExport(); if (r.ok) { if (r.data?.url) window.location.assign(r.data.url); else toast(t("exportQueued")); } else toast.error(r.error); }}>{t("export")}</Button></section>
      <section>
        <H>{t("eraseByPhone")}</H>
        <div className="flex gap-2"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("erasePh")} className="w-64" /><Button variant="danger" icon={<Trash2 />} disabled={phone.length < 6} onClick={() => setConfirm(true)}>{t("erase")}</Button></div>
      </section>
      <section><H>{t("deleteCompany")}</H><p className="text-xs text-fg-muted">{t("deleteCompanyHint")}</p></section>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} danger title={t("eraseByPhone")} description="Аудио, расшифровки и сообщения будут удалены безвозвратно." confirmLabel={t("erase")} cancelLabel={tc("cancel")}
        onConfirm={async () => { const r = await eraseByPhone(phone); if (r.ok) { toast(t("erasedOk")); setPhone(""); } else toast.error(r.error); }} />
    </div>
  );
}

function SecurityTab({ audit, isOwner, sessions }: { audit: AuditEntry[]; isOwner: boolean; sessions?: SessionItem[] }) {
  const t = useTranslations("settings");
  const [q, setQ] = React.useState("");
  const rows = audit.filter((a) => !q || `${a.actorName} ${a.action} ${a.entity} ${a.detail ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col gap-6">
      <section className="flex items-center gap-3"><ShieldCheck className="size-5 text-success" /><div><p className="text-[13px]">{t("twofa")}</p><p className="text-xs text-fg-muted">{sessions && !isOwner ? t("twofaOptional") : t("twofaOn")}</p></div></section>
      <section>
        <H>{t("sessions")}</H>
        {sessions ? <SessionList sessions={sessions} /> : <p className="text-xs text-fg-muted">{t("sessionListUnavailable")}</p>}
      </section>
      {isOwner && (
        <section>
          <div className="mb-3 flex items-center gap-3"><H>{t("audit")}</H><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Фильтр" className="mb-3 ml-auto w-56" /></div>
          <table className="w-full text-[13px]">
            <thead><tr className="[&>th]:h-8 [&>th]:border-b [&>th]:border-line [&>th]:px-2 [&>th]:text-left [&>th]:text-xs [&>th]:font-normal [&>th]:text-fg-muted"><th>{t("auditCols.time")}</th><th>{t("auditCols.actor")}</th><th>{t("auditCols.action")}</th><th>{t("auditCols.entity")}</th><th>{t("auditCols.detail")}</th></tr></thead>
            <tbody>{rows.map((a) => <tr key={a.id} className="[&>td]:h-9 [&>td]:border-b [&>td]:border-line [&>td]:px-2"><td className="whitespace-nowrap text-fg-muted">{formatDateTime(a.createdAt)}</td><td>{a.actorName}</td><td className="font-mono text-xs">{a.action}</td><td>{a.entity}</td><td className="text-fg-secondary">{a.detail}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
