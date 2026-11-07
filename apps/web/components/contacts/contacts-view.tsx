"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Phone, Plus, Trash2, X, Merge, Inbox as InboxIcon, PhoneCall } from "lucide-react";
import {
  Button, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, FilterBar, Input, PageHeader, Pill, SectionTitle, Sheet, Skeleton, SplitView, Tag, Textarea, Tooltip, toast,
  type ColumnDef, type FilterDef, type SavedView,
} from "@all/ui";
import type { Contact } from "@all/db";
import { fetchContact } from "@/lib/read";
import { createContact, eraseContact, mergeContacts, updateContact } from "@/lib/actions";
import { useListState, matchSearch } from "@/lib/use-list-state";
import { useHotkey } from "@/lib/use-hotkeys";
import { formatDateTime, formatPhone, relativeTime } from "@/lib/format";
import { InlineText } from "../leads/lead-card";
import { STATUS_TONE } from "../leads/leads-view";

type Detail = NonNullable<Awaited<ReturnType<typeof fetchContact>>>;

export function ContactsView({ contacts: initial, canErase, open }: { contacts: Contact[]; canErase: boolean; open?: string }) {
  const t = useTranslations("contacts");
  const tc = useTranslations("common");
  const [contacts, setContacts] = React.useState(initial);
  const [createOpen, setCreateOpen] = React.useState(false);
  React.useEffect(() => setContacts(initial), [initial]);
  useHotkey("c", (e) => { e.preventDefault(); setCreateOpen(true); });

  const views: SavedView[] = [
    { id: "all", label: t("views.all"), filters: {} },
    { id: "vip", label: t("views.vip"), filters: { tag: ["vip"] } },
    { id: "new", label: t("views.new"), filters: { fresh: ["yes"] } },
  ];
  const ls = useListState("contacts", views, { open });
  const tags = Array.from(new Set(contacts.flatMap((c) => c.tags)));
  const defs: FilterDef[] = [
    { key: "tag", label: t("colTags"), options: tags.map((x) => ({ value: x, label: x })) },
    { key: "channel", label: t("colChannels"), options: [{ value: "phone", label: "Телефон" }, { value: "telegram", label: "Telegram" }] },
  ];
  const filtered = React.useMemo(() => contacts.filter((c) => {
    const f = ls.filters;
    if (f.tag?.length && !f.tag.some((x) => c.tags.includes(x))) return false;
    if (f.channel?.length && !f.channel.some((x) => c.channels.includes(x))) return false;
    if (f.fresh?.length && Date.now() - new Date(c.createdAt).getTime() > 7 * 86400_000) return false;
    return matchSearch(ls.search, c.name, c.phone);
  }).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)), [contacts, ls.filters, ls.search]);

  const columns = React.useMemo<ColumnDef<Contact, unknown>[]>(() => [
    { id: "name", header: t("colName"), size: 220, accessorFn: (c) => c.name ?? "", cell: ({ row }) => row.original.name ?? <span className="text-fg-faint">{t("unnamed")}</span> },
    { id: "phone", header: t("colPhone"), size: 170, accessorFn: (c) => c.phone, cell: ({ row }) => <span className="tabular-nums text-fg-secondary">{formatPhone(row.original.phone)}</span> },
    { id: "channels", header: t("colChannels"), size: 130, enableSorting: false, cell: ({ row }) => <span className="text-fg-muted">{row.original.channels.map((c) => (c === "phone" ? "☎" : "Telegram")).join(" · ")}</span> },
    { id: "last", header: t("colLast"), size: 140, accessorFn: (c) => c.lastSeenAt, cell: ({ row }) => <Tooltip content={formatDateTime(row.original.lastSeenAt)}><span className="text-fg-muted">{relativeTime(row.original.lastSeenAt)}</span></Tooltip> },
    { id: "count", header: t("colCount"), size: 100, meta: { align: "right" }, accessorFn: (c) => c.interactionsCount },
    { id: "tags", header: t("colTags"), size: 160, enableSorting: false, cell: ({ row }) => <span className="flex gap-1">{row.original.tags.map((x) => <Tag key={x}>{x}</Tag>)}</span> },
  ], [t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t("title")} meta={<span className="tabular-nums">{filtered.length}</span>}>
        <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreateOpen(true)}>{tc("create")}</Button>
      </PageHeader>
      <SplitView storageKey="contacts" onClose={() => ls.setOpenId(undefined)}
        list={<>
          <FilterBar defs={defs} values={ls.filters} onChange={ls.changeFilters} search={ls.search} onSearch={ls.setSearch} searchPlaceholder={t("searchPlaceholder")}
            views={ls.views} activeView={ls.view} onView={ls.applyView} density={ls.density} onDensity={ls.setDensity} onSaveView={ls.saveView}
            labels={{ addFilter: tc("addFilter"), clear: tc("clearFilters"), density: tc("density"), any: tc("any"), saveView: tc("saveView") }} />
          <DataTable data={filtered} columns={columns} getRowId={(c) => c.id} activeId={ls.openId} onOpen={(c) => ls.setOpenId(c.id)} density={ls.density} storageKey="contacts:table"
            columnsLabel={tc("columns")} empty={<EmptyState title={t("empty")} action={<Button size="sm" onClick={() => setCreateOpen(true)}>{tc("create")}</Button>} />} />
        </>}
        detail={ls.openId ? <ContactCard key={ls.openId} id={ls.openId} all={contacts} canErase={canErase} onClose={() => ls.setOpenId(undefined)}
          onChanged={(c) => setContacts((list) => list.map((x) => (x.id === c.id ? c : x)))}
          onRemoved={(ids) => { setContacts((list) => list.filter((x) => !ids.includes(x.id))); }} /> : undefined}
      />
      <CreateContactSheet open={createOpen} onOpenChange={setCreateOpen} onCreated={(c) => { setContacts((l) => [c, ...l.filter((x) => x.id !== c.id)]); ls.setOpenId(c.id); }} />
    </div>
  );
}

function ContactCard({ id, all, canErase, onClose, onChanged, onRemoved }: { id: string; all: Contact[]; canErase: boolean; onClose: () => void; onChanged: (c: Contact) => void; onRemoved: (ids: string[]) => void }) {
  const t = useTranslations("contacts");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const [d, setD] = React.useState<Detail | null | undefined>(undefined);
  const [eraseOpen, setEraseOpen] = React.useState(false);
  const [tag, setTag] = React.useState("");
  const load = React.useCallback(() => { fetchContact(id).then(setD).catch(() => setD(null)); }, [id]);
  React.useEffect(load, [load]);
  if (d === undefined) return <div className="flex flex-col gap-3 p-4"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-40" /></div>;
  if (d === null) return <ErrorState title={tc("notFound")} />;
  const c = d.contact;
  // Предложение объединить дубли: совпадение последних 7 цифр телефона или имени
  const dupes = all.filter((x) => x.id !== c.id && ((c.name && x.name === c.name) || (c.phone && x.phone && x.phone.slice(-7) === c.phone.slice(-7))));
  const save = async (p: Parameters<typeof updateContact>[1]) => {
    const r = await updateContact(c.id, p);
    if (!r.ok) { toast.error(r.error); return; }
    setD({ ...d, contact: r.data! }); onChanged(r.data!); toast(tc("saved"));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <InlineText value={c.name ?? ""} placeholder={t("unnamed")} onSave={(v) => save({ name: v })} className="text-sm font-medium" />
          <div className="flex items-center gap-2 text-xs text-fg-muted"><InlineText value={formatPhone(c.phone)} onSave={(v) => save({ phone: v })} className="w-auto text-xs tabular-nums" /></div>
        </div>
        <a href={`tel:${c.phone}`} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-accent px-2.5 text-xs font-medium text-accent-fg"><Phone className="size-3.5" />Позвонить</a>
        <button onClick={onClose} aria-label="Esc" className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover"><X className="size-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {dupes.length > 0 && (
          <div className="flex items-center gap-2 border-b border-line bg-warning-bg px-4 py-2 text-xs text-warning">
            <Merge className="size-3.5" />{t("mergeHint")}: {dupes.map((x) => x.name ?? formatPhone(x.phone)).join(", ")}
            <Button size="sm" className="ml-auto" onClick={async () => { const r = await mergeContacts(c.id, dupes.map((x) => x.id)); if (r.ok) { toast(t("merged")); onRemoved(dupes.map((x) => x.id)); load(); } else toast.error(r.error); }}>{t("merge")}</Button>
          </div>
        )}
        <section className="border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {c.tags.map((x) => <Tag key={x} onRemove={() => save({ tags: c.tags.filter((y) => y !== x) })}>{x}</Tag>)}
            <form onSubmit={(e) => { e.preventDefault(); if (tag.trim()) { void save({ tags: [...c.tags, tag.trim()] }); setTag(""); } }}>
              <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder={`+ ${t("addTag")}`} className="h-5 w-24 bg-transparent text-xs placeholder:text-fg-faint focus:outline-none" />
            </form>
          </div>
          <Field label={t("notes")} className="mt-3"><Textarea rows={2} defaultValue={c.notes} placeholder={t("notesPh")} onBlur={(e) => { if (e.target.value !== (c.notes ?? "")) void save({ notes: e.target.value }); }} /></Field>
        </section>
        <section className="border-b border-line px-4 py-3">
          <SectionTitle>{t("leads")}</SectionTitle>
          {d.leads.length === 0 ? <p className="text-xs text-fg-faint">—</p> : (
            <ul className="flex flex-col">{d.leads.map((l) => (
              <li key={l.id}><Link href={`/app/leads?open=${l.id}`} className="flex h-8 items-center gap-2 text-[13px] hover:bg-hover">
                <span className="tabular-nums text-xs text-fg-faint">#{l.number}</span><span className="flex-1 truncate">{l.title}</span><Pill tone={STATUS_TONE[l.status]}>{te(`leadStatus.${l.status}`)}</Pill>
              </Link></li>
            ))}</ul>
          )}
        </section>
        <section className="px-4 py-3">
          <SectionTitle>{t("timeline")}</SectionTitle>
          <ol className="relative flex flex-col gap-2 border-l border-line pl-4">
            {d.timeline.map((i) => (
              <li key={`${i.kind}_${i.id}`} className="relative">
                <span className="absolute -left-[21px] top-0.5 flex size-2.5 items-center justify-center rounded-full bg-bg ring-1 ring-line-strong" />
                <Link href={i.href ?? "#"} className="block hover:underline">
                  <span className="flex items-center gap-1.5 text-xs text-fg-muted">{i.kind === "call" ? <PhoneCall className="size-3" /> : <InboxIcon className="size-3" />}{formatDateTime(i.at)}</span>
                  <span className="line-clamp-2 text-[13px]">{i.title}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
        {canErase && (
          <div className="border-t border-line px-4 py-3">
            <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => setEraseOpen(true)}>{t("erase")}</Button>
          </div>
        )}
      </div>
      <ConfirmDialog open={eraseOpen} onOpenChange={setEraseOpen} danger title={t("eraseTitle")} description={t("eraseDesc")} confirmLabel={tc("delete")} cancelLabel={tc("cancel")}
        onConfirm={async () => { const r = await eraseContact(c.id); if (r.ok) { toast(t("erased")); onRemoved([c.id]); onClose(); } else toast.error(r.error); }} />
    </div>
  );
}

function CreateContactSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (c: Contact) => void }) {
  const t = useTranslations("contacts");
  const tc = useTranslations("common");
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [pending, start] = React.useTransition();
  const submit = () => start(async () => {
    const r = await createContact({ name, phone });
    if (!r.ok) { setError(r.error); return; }
    onCreated(r.data!); onOpenChange(false); setName(""); setPhone(""); setError(undefined); router.refresh();
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("createTitle")} width={440}
      footer={<><Button onClick={() => onOpenChange(false)}>{tc("cancel")}</Button><Button variant="primary" loading={pending} onClick={submit}>{tc("create")}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-3">
        <Field label={t("colName")}><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label={t("colPhone")} error={error}><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+996 555 123 456" aria-invalid={!!error} /></Field>
      </form>
    </Sheet>
  );
}
