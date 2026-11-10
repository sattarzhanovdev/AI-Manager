"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Copy, Link2, Plus, UserMinus, X, Crown } from "lucide-react";
import {
  Avatar, Button, Checkbox, ConfirmDialog, DataTable, Field, Input, PageHeader, Pill, SectionTitle, Select, Sheet, SplitView, Tooltip, toast, type ColumnDef,
} from "@all/ui";
import type { Member, MemberRole } from "@all/db";
import { disableMember, inviteMember, linkTelegram, updateMember } from "@/lib/actions";
import { formatPhone, relativeTime } from "@/lib/format";

const MATRIX: [string, Record<MemberRole, string>][] = [
  ["Звонки, заявки, чаты", { owner: "Все", admin: "Все", staff: "Свои", accountant: "Нет" }],
  ["Слушать аудио", { owner: "Да", admin: "Да", staff: "Свои", accountant: "Нет" }],
  ["Редактировать анкету", { owner: "Да", admin: "По разрешению", staff: "Нет", accountant: "Нет" }],
  ["Публиковать анкету и AI", { owner: "Да", admin: "Нет", staff: "Нет", accountant: "Нет" }],
  ["Переключатель AI", { owner: "Да", admin: "Да", staff: "Нет", accountant: "Нет" }],
  ["Команда и роли", { owner: "Да", admin: "Нет", staff: "Нет", accountant: "Нет" }],
  ["Интеграции", { owner: "Да", admin: "По разрешению", staff: "Нет", accountant: "Нет" }],
  ["Тариф, счета", { owner: "Да", admin: "Нет", staff: "Нет", accountant: "Да" }],
  ["Экспорт и удаление", { owner: "Да", admin: "Нет", staff: "Нет", accountant: "Нет" }],
];

export function TeamView({ members, branches }: { members: Member[]; branches: { id: string; name: string }[] }) {
  const t = useTranslations("team");
  const te = useTranslations("enums");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = React.useState<string>();
  const [invite, setInvite] = React.useState(false);
  const columns = React.useMemo<ColumnDef<Member, unknown>[]>(() => [
    { id: "name", header: t("colName"), size: 230, accessorFn: (m) => m.name, cell: ({ row }) => <span className="flex items-center gap-2"><Avatar name={row.original.name} />{row.original.name}</span> },
    { id: "role", header: t("colRole"), size: 130, accessorFn: (m) => m.role, cell: ({ row }) => te(`role.${row.original.role}`) },
    { id: "branches", header: t("colBranches"), size: 170, enableSorting: false, cell: ({ row }) => <span className="text-fg-muted">{row.original.branchIds.map((id) => branches.find((b) => b.id === id)?.name).filter(Boolean).join(", ") || "—"}</span> },
    { id: "tg", header: t("colTelegram"), size: 120, accessorFn: (m) => m.telegramLinked, cell: ({ row }) => (row.original.telegramLinked ? <Pill tone="success">{t("linked")}</Pill> : <Pill>{t("notLinked")}</Pill>) },
    { id: "last", header: t("colLastSeen"), size: 130, accessorFn: (m) => m.lastSeenAt ?? "", cell: ({ row }) => <span className="text-fg-muted">{row.original.lastSeenAt ? relativeTime(row.original.lastSeenAt) : "—"}</span> },
    { id: "status", header: t("colStatus"), size: 110, accessorFn: (m) => (m.disabledAt ? 1 : 0), cell: ({ row }) => (row.original.disabledAt ? <Pill tone="danger">{t("disabled")}</Pill> : row.original.lastSeenAt ? <Pill tone="success">{t("active")}</Pill> : <Pill tone="info">{t("invited")}</Pill>) },
  ], [t, te, branches]);
  const current = members.find((m) => m.id === open);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t("title")} meta={members.filter((m) => !m.disabledAt).length}>
        <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setInvite(true)}>{t("invite")}</Button>
      </PageHeader>
      <SplitView storageKey="team" onClose={() => setOpen(undefined)}
        list={<DataTable data={members} columns={columns} getRowId={(m) => m.id} activeId={open} onOpen={(m) => setOpen(m.id)} storageKey="team:table" columnsLabel={tc("columns")} />}
        detail={current ? <MemberCard key={current.id} m={current} members={members} branches={branches} onClose={() => setOpen(undefined)} onChanged={() => router.refresh()} /> : undefined} />
      <InviteSheet open={invite} onOpenChange={setInvite} onDone={() => router.refresh()} />
    </div>
  );
}

function MemberCard({ m, members, branches, onClose, onChanged }: { m: Member; members: Member[]; branches: { id: string; name: string }[]; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations("team");
  const te = useTranslations("enums");
  const tc = useTranslations("common");
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [reassign, setReassign] = React.useState("");
  const [link, setLink] = React.useState<string>();
  const [phone, setPhone] = React.useState(m.transferPhone ? formatPhone(m.transferPhone) : "");
  const save = async (p: Parameters<typeof updateMember>[1]) => { const r = await updateMember(m.id, p); if (r.ok) { toast(tc("saved")); onChanged(); } else toast.error(r.error); };
  const isOwner = m.role === "owner";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
        <Avatar name={m.name} className="size-7 text-[11px]" />
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{m.name}</p><p className="truncate text-xs text-fg-muted">{m.email ?? formatPhone(m.phone)}</p></div>
        <button onClick={onClose} aria-label="Esc" className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover"><X className="size-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("role")}>
            <Select value={m.role} disabled={isOwner || !!m.disabledAt} onChange={(e) => save({ role: e.target.value as MemberRole })}>
              {(isOwner ? ["owner"] : ["admin", "staff", "accountant"]).map((r) => <option key={r} value={r}>{te(`role.${r as MemberRole}`)}</option>)}
            </Select>
          </Field>
          <Field label={t("transferPhone")}><Input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => phone && save({ transferPhone: phone })} placeholder="+996 …" /></Field>
        </div>
        {m.role === "admin" && (
          <section className="mt-4">
            <SectionTitle>{t("permissions")}</SectionTitle>
            {(["edit_questionnaire", "integrations"] as const).map((p) => (
              <label key={p} className="flex h-8 items-center gap-2 text-[13px]"><Checkbox checked={!!m.permissions[p]} onChange={(e) => save({ permissions: { ...m.permissions, [p]: e.target.checked } })} />{t(`perm.${p}`)}</label>
            ))}
          </section>
        )}
        <section className="mt-4">
          <SectionTitle>{t("branches")}</SectionTitle>
          {branches.map((b) => (
            <label key={b.id} className="flex h-8 items-center gap-2 text-[13px]"><Checkbox checked={m.branchIds.includes(b.id)} onChange={(e) => save({ branchIds: e.target.checked ? [...m.branchIds, b.id] : m.branchIds.filter((x) => x !== b.id) })} />{b.name}</label>
          ))}
        </section>
        <section className="mt-4">
          <SectionTitle>{t("colTelegram")}</SectionTitle>
          {m.telegramLinked ? <Pill tone="success">{t("linked")}</Pill> : (
            link ? (
              <div className="flex gap-1.5"><Input readOnly value={link} /><Button size="icon" aria-label={tc("copy")} onClick={() => { void navigator.clipboard.writeText(link); toast(tc("copied")); }}><Copy /></Button></div>
            ) : <Button size="sm" icon={<Link2 />} onClick={async () => { const r = await linkTelegram(m.id); if (r.ok) setLink(r.data); }}>{t("linkTelegram")}</Button>
          )}
        </section>
        <section className="mt-4">
          <SectionTitle>{t("matrix")}</SectionTitle>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-xs">
            {MATRIX.map(([label, v]) => <React.Fragment key={label}><dt className="text-fg-muted">{label}</dt><dd className="text-right">{v[m.role]}</dd></React.Fragment>)}
          </dl>
        </section>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 border-t border-line px-4 py-2.5">
        {!isOwner && !m.disabledAt && <Button size="sm" variant="danger" icon={<UserMinus />} onClick={() => setDisableOpen(true)}>{t("disable")}</Button>}
        {!isOwner && m.role === "admin" && (
          <Tooltip content={t("transferOwnerHint")}><span><Button size="sm" icon={<Crown />} disabled>{t("transferOwner")}</Button></span></Tooltip>
        )}
      </div>
      <ConfirmDialog open={disableOpen} onOpenChange={setDisableOpen} danger title={t("disableTitle", { name: m.name })} description={t("disableDesc")} confirmLabel={t("disable")} cancelLabel={tc("cancel")}
        onConfirm={async () => { const r = await disableMember(m.id, reassign || undefined); if (r.ok) { toast(t("disabledOk", { count: r.data ?? 0 })); onChanged(); } else toast.error(r.error); }}>
        <Field label={t("reassignTo")}>
          <Select value={reassign} onChange={(e) => setReassign(e.target.value)}>
            <option value="">Без ответственного</option>
            {members.filter((x) => x.id !== m.id && !x.disabledAt && x.role !== "accountant").map((x) => <option key={x.id} value={x.userId}>{x.name}</option>)}
          </Select>
        </Field>
      </ConfirmDialog>
    </div>
  );
}

function InviteSheet({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const t = useTranslations("team");
  const te = useTranslations("enums");
  const tc = useTranslations("common");
  const [contact, setContact] = React.useState("");
  const [role, setRole] = React.useState<"admin" | "staff" | "accountant">("staff");
  const [inviteUrl, setInviteUrl] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const [pending, start] = React.useTransition();
  const submit = () => start(async () => {
    const r = await inviteMember({ contact, role });
    if (!r.ok) { setError(r.error); return; }
    if (r.data && "inviteUrl" in r.data && r.data.inviteUrl) { setInviteUrl(new URL(r.data.inviteUrl, window.location.origin).href); setError(undefined); onDone(); return; }
    toast.success(t("invitedOk")); setContact(""); setError(undefined); onOpenChange(false); onDone();
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("inviteTitle")} width={440}
      footer={<><Button onClick={() => onOpenChange(false)}>{tc("cancel")}</Button><Button variant="primary" loading={pending} onClick={submit}>{t("invite")}</Button></>}>
      {inviteUrl && <Field label={t("inviteLink")}><Input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} /></Field>}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-3">
        <Field label={t("contact")} error={error}><Input autoFocus value={contact} onChange={(e) => setContact(e.target.value)} placeholder="name@company.kg / +996 …" aria-invalid={!!error} /></Field>
        <Field label={t("role")}><Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>{(["admin", "staff", "accountant"] as const).map((r) => <option key={r} value={r}>{te(`role.${r}`)}</option>)}</Select></Field>
      </form>
    </Sheet>
  );
}
