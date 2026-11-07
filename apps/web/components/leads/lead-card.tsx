"use client";
import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarPlus, Check, ChevronDown, ChevronUp, Phone, X, Hand, Ban } from "lucide-react";
import {
  Avatar, Button, Dash, ErrorState, Menu, MenuContent, MenuItem, MenuTrigger, Pill, Popover, PopoverContent, PopoverTrigger, SectionTitle, Select, Skeleton, Textarea, Tooltip, cn, toast,
} from "@all/ui";
import type { Lead, LeadEvent, LeadStatus } from "@all/db";
import { fetchLead } from "@/lib/read";
import { commentLead, updateLead } from "@/lib/actions";
import { formatDateTime, formatPhone, relativeTime } from "@/lib/format";
import { CallPlayer, useCallPlayback } from "../calls/call-player";
import { STATUSES, STATUS_TONE, useSla, type MemberLite } from "./leads-view";

type Detail = NonNullable<Awaited<ReturnType<typeof fetchLead>>>;

const FIELDS_BY_TYPE: Record<Lead["type"], string[]> = {
  booking: ["service", "preferred_time", "branch", "car", "comment"],
  reschedule: ["service", "preferred_time", "branch", "comment"],
  consultation: ["service", "car", "comment"],
  complaint: ["service", "comment"],
  callback: ["comment"],
  order: ["service", "comment"],
  other: ["comment"],
};

export function LeadCard({ id, members, me, onClose, onNav, onChanged }: { id: string; members: MemberLite[]; me: string; onClose: () => void; onNav: (d: 1 | -1) => void; onChanged: (l: Lead) => void }) {
  const tc = useTranslations("common");
  const [data, setData] = React.useState<Detail | null | undefined>(undefined);
  const [error, setError] = React.useState(false);
  const load = React.useCallback(() => { setError(false); fetchLead(id).then(setData).catch(() => setError(true)); }, [id]);
  React.useEffect(load, [load]);
  if (error) return <ErrorState title={tc("errorTitle")} retry={load} retryLabel={tc("retry")} />;
  if (data === undefined) return <div className="flex flex-col gap-3 p-4"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;
  if (data === null) return <ErrorState title={tc("notFound")} />;
  return <Body d={data} members={members} me={me} onClose={onClose} onNav={onNav} reload={load}
    onPatched={(l) => { setData({ ...data, lead: l }); onChanged(l); }} />;
}

function Body({ d, members, me, onClose, onNav, onPatched, reload }: { d: Detail; members: MemberLite[]; me: string; onClose: () => void; onNav: (d: 1 | -1) => void; onPatched: (l: Lead) => void; reload: () => void }) {
  const t = useTranslations("leads");
  const te = useTranslations("enums");
  const tc = useTranslations("common");
  const sla = useSla();
  const l = d.lead;
  const st = sla(l);
  const nameOf = (id?: string) => members.find((m) => m.userId === id)?.name;

  const patch = async (p: Parameters<typeof updateLead>[1], ok?: string) => {
    const prev = l;
    onPatched({ ...l, ...p, assigneeId: p.assigneeId === null ? undefined : (p.assigneeId ?? l.assigneeId) } as Lead);
    const r = await updateLead(l.id, p);
    if (!r.ok) { onPatched(prev); toast.error(r.error); return false; }
    if (ok) toast(ok, { undo: () => { onPatched(prev); void updateLead(l.id, { status: prev.status, assigneeId: prev.assigneeId ?? null }); } });
    reload();
    return true;
  };

  const fieldKeys = Array.from(new Set([...(FIELDS_BY_TYPE[l.type] ?? []), ...Object.keys(l.payload)])).sort((a, b) => Number(a === "comment") - Number(b === "comment"));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-4 py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-fg-muted">
              <span className="tabular-nums">#{l.number}</span>·<span>{te(`leadType.${l.type}`)}</span>·<span>{te(`leadSource.${l.source}`)}</span>
              {l.priority === "urgent" && <Pill tone="danger">{t("priority.urgent")}</Pill>}
            </div>
            <InlineText value={l.title} onSave={(v) => patch({ title: v })} className="text-sm font-medium" />
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={() => onNav(-1)} aria-label="K" className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover"><ChevronUp className="size-4" /></button>
            <button onClick={() => onNav(1)} aria-label="J" className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover"><ChevronDown className="size-4" /></button>
            <button onClick={onClose} aria-label="Esc" className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover"><X className="size-4" /></button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Menu>
            <MenuTrigger className="inline-flex h-7 items-center gap-1 rounded-full hover:opacity-90"><Pill tone={STATUS_TONE[l.status]}>{te(`leadStatus.${l.status}`)}</Pill><ChevronDown className="size-3 text-fg-faint" /></MenuTrigger>
            <MenuContent align="start">{STATUSES.filter((s) => s !== "lost").map((s) => <MenuItem key={s} onSelect={() => patch({ status: s }, t("statusChanged", { status: te(`leadStatus.${s}`) }))}>{te(`leadStatus.${s}`)}</MenuItem>)}</MenuContent>
          </Menu>
          <Menu>
            <MenuTrigger className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-2 text-xs hover:bg-hover">
              {l.assigneeId ? <><Avatar name={nameOf(l.assigneeId)} />{nameOf(l.assigneeId)}</> : <span className="text-fg-muted">{t("unassigned")}</span>}
            </MenuTrigger>
            <MenuContent align="start">{members.map((m) => <MenuItem key={m.userId} onSelect={() => patch({ assigneeId: m.userId }, t("assigned"))}>{m.name}</MenuItem>)}</MenuContent>
          </Menu>
          {st && <span className={cn("text-xs tabular-nums", st.overdue ? "text-danger" : "text-fg-muted")}>SLA: {st.overdue ? t("overdue", { time: st.label }) : st.label}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!l.assigneeId && <Button size="sm" variant="primary" icon={<Hand />} onClick={() => patch({ assigneeId: me, status: "in_progress" }, t("assigned"))}>{t("take")}</Button>}
          {l.contactPhone && <a href={`tel:${l.contactPhone}`} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-xs hover:bg-hover"><Phone className="size-3.5" />{t("callback")}</a>}
          <Tooltip content={tc("comingPhase")}><span><Button size="sm" disabled icon={<CalendarPlus />}>{t("book")}</Button></span></Tooltip>
          {l.status !== "won" && <Button size="sm" icon={<Check />} onClick={() => patch({ status: "won" }, t("statusChanged", { status: te("leadStatus.won") }))}>{t("closeWon")}</Button>}
          {l.status !== "lost" && <LostButton onConfirm={(reason) => patch({ status: "lost", lostReason: reason }, t("statusChanged", { status: te("leadStatus.lost") }))} />}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-line px-4 py-3">
          <SectionTitle>{t("fields")}</SectionTitle>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {fieldKeys.map((k) => (
              <div key={k} className={cn("flex min-w-0 flex-col gap-0.5", k === "comment" && "col-span-2")}>
                <dt className="text-xs text-fg-muted">{t.has(`payloadKeys.${k}`) ? t(`payloadKeys.${k}`) : k}</dt>
                <dd><InlineText value={l.payload[k] ?? ""} placeholder="—" multiline={k === "comment"} onSave={(v) => patch({ payload: { ...l.payload, [k]: v } })} /></dd>
              </div>
            ))}
            {l.lostReason && <div className="col-span-2"><dt className="text-xs text-fg-muted">{t("lostReason")}</dt><dd className="text-[13px]">{l.lostReason}</dd></div>}
          </dl>
        </section>

        <section className="border-b border-line px-4 py-3">
          <SectionTitle aside={l.contactId && <Link href={`/app/contacts?open=${l.contactId}`} className="text-xs text-fg-muted hover:text-fg">{tc("open")}</Link>}>{t("colContact")}</SectionTitle>
          <div className="flex items-center gap-2 text-[13px]"><span className="font-medium">{l.contactName ?? "—"}</span><span className="tabular-nums text-fg-muted">{formatPhone(l.contactPhone)}</span></div>
          {d.history.length > 0 && (
            <>
              <p className="mt-2 text-xs text-fg-muted">{t("contactHistory")}</p>
              <ul className="mt-1 flex flex-col">
                {d.history.map((h) => (
                  <li key={h.id}><Link href={h.href ?? "#"} className="flex h-7 items-center gap-2 text-[13px] hover:underline">
                    <span className="w-16 shrink-0 text-xs text-fg-faint">{relativeTime(h.at)}</span><span className="truncate">{h.title}</span>
                  </Link></li>
                ))}
              </ul>
            </>
          )}
        </section>

        {d.call && <RelatedCall call={d.call} />}

        <section className="px-4 py-3">
          <SectionTitle>{t("comments")}</SectionTitle>
          <ol className="flex flex-col gap-2">
            {d.events.map((e) => <EventRow key={e.id} e={e} nameOf={nameOf} />)}
          </ol>
          <CommentBox leadId={l.id} members={members} onSent={reload} />
        </section>
      </div>
    </div>
  );
}

function RelatedCall({ call }: { call: NonNullable<Detail["call"]> }) {
  const t = useTranslations("leads");
  const durationMs = call.turns.length ? call.turns.at(-1)!.endMs + 500 : call.durationS * 1000;
  const pb = useCallPlayback(durationMs);
  return (
    <section className="border-b border-line px-4 py-3">
      <SectionTitle aside={<Link href={`/app/calls?open=${call.id}`} className="text-xs text-fg-muted hover:text-fg">{formatDateTime(call.startedAt)}</Link>}>{t("relatedCall")}</SectionTitle>
      {call.turns.length > 0 && <CallPlayer turns={call.turns} durationMs={durationMs} pb={pb} compact />}
      {call.summary && <p className="mt-2 text-[13px] leading-5 text-fg-secondary">{call.summary}</p>}
    </section>
  );
}

function EventRow({ e, nameOf }: { e: LeadEvent; nameOf: (id?: string) => string | undefined }) {
  const t = useTranslations("leads");
  const te = useTranslations("enums");
  const who = e.actorKind === "ai" ? t("ai") : e.actorKind === "system" ? t("system") : nameOf(e.actorId) ?? "—";
  if (e.action === "comment") {
    return (
      <li className="flex gap-2">
        <Avatar name={who} className="mt-0.5" />
        <div className="min-w-0 flex-1 rounded-[10px] bg-subtle px-2.5 py-1.5">
          <div className="flex items-center gap-2 text-xs"><span className="font-medium">{who}</span><span className="text-fg-faint">{relativeTime(e.createdAt)}</span></div>
          <p className="whitespace-pre-wrap text-[13px] leading-5">{e.comment?.split(/(@[А-ЯЁA-Z][а-яёa-z]+)/).map((part, i) => part.startsWith("@") ? <span key={i} className="font-medium text-fg">{part}</span> : part)}</p>
        </div>
      </li>
    );
  }
  let detail = "";
  if (e.action === "status") detail = `${te(`leadStatus.${String(e.before)}` as "leadStatus.new")} → ${te(`leadStatus.${String(e.after)}` as "leadStatus.new")}${e.comment ? `: ${e.comment}` : ""}`;
  if (e.action === "assignee") detail = nameOf(e.after as string) ?? t("unassigned");
  return (
    <li className="flex items-center gap-2 pl-7 text-xs text-fg-muted">
      <span className="text-fg-secondary">{who}</span> {t(`events.${e.action}`)} {detail && <span className="text-fg-secondary">{detail}</span>}
      <span className="ml-auto shrink-0 text-fg-faint">{relativeTime(e.createdAt)}</span>
    </li>
  );
}

function CommentBox({ leadId, members, onSent }: { leadId: string; members: MemberLite[]; onSent: () => void }) {
  const t = useTranslations("leads");
  const [text, setText] = React.useState("");
  const [pending, start] = React.useTransition();
  const mention = text.match(/@([А-ЯЁа-яёA-Za-z]*)$/)?.[1];
  const suggestions = mention !== undefined ? members.filter((m) => m.name.toLowerCase().startsWith(mention.toLowerCase())).slice(0, 5) : [];
  const send = () => start(async () => {
    const r = await commentLead(leadId, text);
    if (!r.ok) { toast.error(r.error); return; }
    setText(""); onSent();
  });
  return (
    <div className="relative mt-3">
      {suggestions.length > 0 && (
        <ul className="absolute bottom-full mb-1 w-56 rounded-[10px] bg-elevated p-1 shadow-[var(--shadow-pop)]">
          {suggestions.map((m) => (
            <li key={m.userId}><button className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] hover:bg-hover"
              onClick={() => setText(text.replace(/@[А-ЯЁа-яёA-Za-z]*$/, `@${m.name.split(" ")[0]} `))}><Avatar name={m.name} />{m.name}</button></li>
          ))}
        </ul>
      )}
      <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("commentPlaceholder")}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) { e.preventDefault(); send(); } }} />
      <div className="mt-1.5 flex justify-end"><Button size="sm" variant="primary" loading={pending} disabled={!text.trim()} onClick={send}>{t("send")}</Button></div>
    </div>
  );
}

/** Закрытие без результата требует причину */
function LostButton({ onConfirm }: { onConfirm: (reason: string) => Promise<boolean> }) {
  const t = useTranslations("leads");
  const reasons = t.raw("lostReasons") as string[];
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [custom, setCustom] = React.useState("");
  const value = reason === "__other" ? custom.trim() : reason;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-xs hover:bg-hover"><Ban className="size-3.5" />{t("closeLost")}</PopoverTrigger>
      <PopoverContent className="flex w-64 flex-col gap-2 p-2.5">
        <label className="text-xs text-fg-muted" htmlFor="lost-reason">{t("lostReason")}</label>
        <Select id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="" disabled>{t("lostReasonPlaceholder")}</option>
          {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
          <option value="__other">Другое…</option>
        </Select>
        {reason === "__other" && <Textarea rows={2} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t("lostReasonPlaceholder")} />}
        <Button size="sm" variant="primary" disabled={value.length < 2} onClick={async () => { if (await onConfirm(value)) setOpen(false); }}>{t("closeLost")}</Button>
      </PopoverContent>
    </Popover>
  );
}

/** Inline-редактирование: клик → поле → Enter сохраняет, Esc отменяет */
export function InlineText({ value, onSave, className, placeholder, multiline }: { value: string; onSave: (v: string) => unknown; className?: string; placeholder?: string; multiline?: boolean }) {
  const [editing, setEditing] = React.useState(false);
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  const commit = () => { setEditing(false); if (v.trim() !== value) void onSave(v.trim()); };
  if (editing) {
    const common = {
      autoFocus: true, value: v, onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); } if (e.key === "Escape") { e.stopPropagation(); setV(value); setEditing(false); } },
      className: cn("w-full rounded-md border border-fg-muted bg-bg px-1.5 text-[13px] focus:outline-none", className),
    };
    return multiline ? <textarea rows={3} {...common} onChange={(e) => setV(e.target.value)} /> : <input {...common} onChange={(e) => setV(e.target.value)} className={cn(common.className, "h-7")} />;
  }
  return (
    <button type="button" onClick={() => setEditing(true)} className={cn("-mx-1.5 block w-[calc(100%+12px)] rounded-md px-1.5 py-0.5 text-left text-[13px] hover:bg-hover", className)}>
      {value || <Dash />}{!value && placeholder ? "" : null}
    </button>
  );
}
