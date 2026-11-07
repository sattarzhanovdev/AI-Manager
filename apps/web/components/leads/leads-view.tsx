"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Check, Hand, KanbanSquare, Phone, Plus, Table2 } from "lucide-react";
import {
  Avatar, BulkBar, Button, CardAction, KanbanBoard, type KanbanColumn, DataTable, EmptyState, FilterBar, Menu, MenuContent, MenuItem, MenuTrigger, PageHeader, Pill, Segmented, SplitView, Tooltip, cn, toast,
  type ColumnDef, type FilterDef, type SavedView, type Tone,
} from "@all/ui";
import type { Lead, LeadStatus } from "@all/db";
import { bulkUpdateLeads, updateLead } from "@/lib/actions";
import { useRealtime } from "@/lib/use-realtime";
import { useListState, matchSearch } from "@/lib/use-list-state";
import { useHotkey } from "@/lib/use-hotkeys";
import { formatDateTime, formatPhone, relativeTime } from "@/lib/format";
import { LeadCard } from "./lead-card";
import { CreateLeadSheet } from "./create-lead-sheet";

export const STATUS_TONE: Record<LeadStatus, Tone> = { new: "info", in_progress: "warning", waiting: "neutral", won: "success", lost: "neutral" };
export const STATUSES: LeadStatus[] = ["new", "in_progress", "waiting", "won", "lost"];

export interface MemberLite { userId: string; name: string }

export function useSla() {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  return (l: Lead) => {
    if (!l.dueAt || l.status === "won" || l.status === "lost") return null;
    const ms = new Date(l.dueAt).getTime() - now;
    const abs = Math.abs(ms);
    const label = abs < 3600_000 ? `${Math.round(abs / 60_000)} мин` : abs < 86400_000 ? `${Math.round(abs / 3600_000)} ч` : `${Math.round(abs / 86400_000)} д`;
    return { overdue: ms < 0, label };
  };
}

export function LeadsView({ leads: initialLeads, members, me, initial }: { leads: Lead[]; members: MemberLite[]; me: string; initial: { view?: string; open?: string; status?: string; create?: string } }) {
  const t = useTranslations("leads");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const router = useRouter();
  const [leads, setLeads] = React.useState(initialLeads);
  const [fresh, setFresh] = React.useState<Set<string>>(new Set());
  const [mode, setMode] = React.useState<"table" | "kanban">("kanban");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = React.useState(initial.create === "1");
  const sla = useSla();

  React.useEffect(() => setLeads(initialLeads), [initialLeads]);
  React.useEffect(() => { try { const m = localStorage.getItem("leads:mode"); if (m === "kanban" || m === "table") setMode(m); } catch { /* ignore */ } }, []);
  const changeMode = (m: "table" | "kanban") => { setMode(m); try { localStorage.setItem("leads:mode", m); } catch { /* ignore */ } };

  // Новая заявка появляется у всех операторов ≤ 3 с
  useRealtime((e) => {
    if (e.type === "lead.created") {
      setLeads((list) => (list.some((l) => l.id === e.lead.id) ? list : [e.lead, ...list]));
      setFresh((s) => new Set(s).add(e.lead.id));
      setTimeout(() => setFresh((s) => { const n = new Set(s); n.delete(e.lead.id); return n; }), 3000);
    }
    if (e.type === "lead.updated") setLeads((list) => list.map((l) => (l.id === e.lead.id ? e.lead : l)));
  });
  useHotkey("c", (e) => { e.preventDefault(); setCreateOpen(true); });

  const views: SavedView[] = [
    { id: "all", label: t("views.all"), filters: { status: ["new", "in_progress", "waiting"] } },
    { id: "mine", label: t("views.mine"), filters: { assignee: [me] } },
    { id: "new", label: t("views.new"), filters: { status: ["new"], assignee: ["none"] } },
    { id: "overdue", label: t("views.overdue"), filters: { overdue: ["yes"] } },
    { id: "complaints", label: t("views.complaints"), filters: { tag: ["complaint"] } },
  ];
  const ls = useListState("leads", views, { view: initial.view ?? (initial.status === "new" ? "new" : undefined), open: initial.open });

  const defs: FilterDef[] = [
    { key: "status", label: t("filters.status"), options: STATUSES.map((s) => ({ value: s, label: te(`leadStatus.${s}`) })) },
    { key: "type", label: t("filters.type"), options: (["booking", "consultation", "order", "complaint", "reschedule", "callback", "other"] as const).map((s) => ({ value: s, label: te(`leadType.${s}`) })) },
    { key: "source", label: t("filters.source"), options: (["call", "chat", "manual"] as const).map((s) => ({ value: s, label: te(`leadSource.${s}`) })) },
    { key: "assignee", label: t("filters.assignee"), options: [{ value: "none", label: t("unassigned") }, ...members.map((m) => ({ value: m.userId, label: m.name }))] },
    { key: "tag", label: t("filters.tag"), options: (["complaint", "urgent", "missed", "vip"] as const).map((s) => ({ value: s, label: te(`leadTag.${s}`) })) },
    { key: "priority", label: t("filters.priority"), options: [{ value: "urgent", label: t("priority.urgent") }, { value: "normal", label: t("priority.normal") }] },
  ];

  const filtered = React.useMemo(() => {
    const f = ls.filters;
    const has = (k: string) => (f[k]?.length ?? 0) > 0;
    return leads.filter((l) => {
      if (has("status") && !f.status!.includes(l.status)) return false;
      if (has("type") && !f.type!.includes(l.type)) return false;
      if (has("source") && !f.source!.includes(l.source)) return false;
      if (has("assignee") && !f.assignee!.includes(l.assigneeId ?? "none")) return false;
      if (has("tag") && !f.tag!.some((tg) => l.tags.includes(tg as Lead["tags"][number]) || (tg === "complaint" && l.type === "complaint"))) return false;
      if (has("priority") && !f.priority!.includes(l.priority)) return false;
      if (has("overdue") && !sla(l)?.overdue) return false;
      return matchSearch(ls.search, String(l.number), l.title, l.contactName, l.contactPhone);
    });
  }, [leads, ls.filters, ls.search, sla]);

  const patchLocal = (id: string, p: Partial<Lead>) => setLeads((list) => list.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const assign = async (l: Lead, userId: string | null) => {
    const prev = l.assigneeId;
    patchLocal(l.id, { assigneeId: userId ?? undefined });
    const r = await updateLead(l.id, { assigneeId: userId });
    if (!r.ok) { patchLocal(l.id, { assigneeId: prev }); toast.error(r.error); }
  };
  const nameOf = (id?: string) => members.find((m) => m.userId === id)?.name;

  const columns = React.useMemo<ColumnDef<Lead, unknown>[]>(() => [
    {
      id: "lead", header: t("colLead"), size: 280, accessorFn: (l) => l.title,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 tabular-nums text-xs text-fg-faint">#{row.original.number}</span>
          <span className="truncate">{row.original.title}</span>
          {row.original.tags.filter((x) => x !== "complaint" || row.original.type !== "complaint").map((tg) => <span key={tg} className="shrink-0 rounded-full border border-line px-1.5 text-[10px] text-fg-muted">{te(`leadTag.${tg}`)}</span>)}
        </span>
      ),
    },
    {
      id: "contact", header: t("colContact"), size: 190, accessorFn: (l) => l.contactName ?? l.contactPhone,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-baseline gap-2">
          {row.original.contactName && <span className="truncate">{row.original.contactName}</span>}
          <span className={cn("shrink-0 tabular-nums", row.original.contactName ? "text-xs text-fg-faint max-2xl:hidden" : "text-fg-secondary")}>{formatPhone(row.original.contactPhone)}</span>
        </span>
      ),
    },
    { id: "source", header: t("colSource"), size: 90, accessorFn: (l) => l.source, cell: ({ row }) => <span className="text-fg-muted">{te(`leadSource.${row.original.source}`)}</span> },
    { id: "status", header: t("colStatus"), size: 130, accessorFn: (l) => STATUSES.indexOf(l.status), cell: ({ row }) => <Pill tone={STATUS_TONE[row.original.status]}>{te(`leadStatus.${row.original.status}`)}</Pill> },
    {
      id: "assignee", header: t("colAssignee"), size: 170, accessorFn: (l) => nameOf(l.assigneeId) ?? "",
      cell: ({ row }) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Menu>
            <MenuTrigger className="flex h-6 max-w-full items-center gap-1.5 rounded-full px-1.5 text-left hover:bg-active">
              {row.original.assigneeId ? <><Avatar name={nameOf(row.original.assigneeId)} /><span className="truncate">{nameOf(row.original.assigneeId)}</span></> : <span className="text-fg-faint">{t("unassigned")}</span>}
            </MenuTrigger>
            <MenuContent align="start">
              <MenuItem onSelect={() => assign(row.original, me)}>{t("take")}</MenuItem>
              {members.map((m) => <MenuItem key={m.userId} onSelect={() => assign(row.original, m.userId)}>{m.name}</MenuItem>)}
              <MenuItem onSelect={() => assign(row.original, null)}>{t("unassigned")}</MenuItem>
            </MenuContent>
          </Menu>
        </span>
      ),
    },
    {
      id: "sla", header: t("colSla"), size: 90, meta: { align: "right" }, accessorFn: (l) => (l.dueAt ? new Date(l.dueAt).getTime() : Infinity),
      cell: ({ row }) => { const s = sla(row.original); return s ? <span className={cn("tabular-nums", s.overdue ? "text-danger" : "text-fg-muted")}>{s.overdue ? `−${s.label}` : s.label}</span> : <span className="text-fg-faint">—</span>; },
    },
    { id: "created", header: t("colCreated"), size: 110, accessorFn: (l) => l.createdAt, cell: ({ row }) => <Tooltip content={formatDateTime(row.original.createdAt)}><span className="text-fg-muted">{relativeTime(row.original.createdAt)}</span></Tooltip> },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, te, members, me, sla]);

  const bulk = async (patch: Parameters<typeof bulkUpdateLeads>[1], label: string) => {
    const ids = [...selected];
    const r = await bulkUpdateLeads(ids, patch);
    if (!r.ok) { toast.error(r.error); return; }
    toast(t("bulkDone", { count: ids.length }), { description: label });
    setSelected(new Set());
    router.refresh();
  };
  const exportCsv = () => {
    const rows = filtered.filter((l) => !selected.size || selected.has(l.id));
    const head = ["number", "title", "status", "type", "contact", "phone", "assignee", "created_at"];
    const csv = [head.join(","), ...rows.map((l) => [l.number, l.title, l.status, l.type, l.contactName ?? "", l.contactPhone ?? "", nameOf(l.assigneeId) ?? "", l.createdAt].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const openIdx = filtered.findIndex((l) => l.id === ls.openId);
  const urgentStripe = (l: Lead) => (l.priority === "urgent" || l.type === "complaint" ? "[&>td:first-child]:shadow-[inset_2px_0_0_var(--danger)]" : undefined);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t("title")} meta={<span className="tabular-nums">{filtered.length}</span>}>
        <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setCreateOpen(true)}>{tc("create")}</Button>
      </PageHeader>
      <SplitView storageKey="leads" onClose={() => ls.setOpenId(undefined)}
        list={
          <div className="relative flex min-h-0 flex-1 flex-col">
            <FilterBar defs={defs} values={ls.filters} onChange={ls.changeFilters} search={ls.search} onSearch={ls.setSearch} searchPlaceholder={t("searchPlaceholder")}
              views={ls.views.map((v) => ({ ...v, count: v.id === "new" ? leads.filter((l) => l.status === "new" && !l.assigneeId).length : v.id === "overdue" ? leads.filter((l) => sla(l)?.overdue).length : undefined }))}
              activeView={ls.view} onView={ls.applyView} density={mode === "table" ? ls.density : undefined} onDensity={ls.setDensity} onSaveView={ls.saveView}
              right={<>
                <Button size="sm" variant="ghost" onClick={exportCsv}>{tc("export")}</Button>
                <Segmented label="Вид" value={mode} onChange={changeMode} items={[{ value: "table", label: t("table"), icon: <Table2 /> }, { value: "kanban", label: t("kanban"), icon: <KanbanSquare /> }]} />
              </>}
              labels={{ addFilter: tc("addFilter"), clear: tc("clearFilters"), density: tc("density"), any: tc("any"), saveView: tc("saveView") }} />
            {mode === "table" ? (
              <DataTable data={filtered} columns={columns} getRowId={(l) => l.id} activeId={ls.openId} onOpen={(l) => ls.setOpenId(l.id)}
                selectable selected={selected} onSelectedChange={setSelected} density={ls.density} storageKey="leads:table" highlightIds={fresh}
                rowClassName={urgentStripe} columnsLabel={tc("columns")} empty={<EmptyState title={leads.length ? t("emptyFiltered") : t("empty")} />} />
            ) : (
              <Kanban leads={filtered} activeId={ls.openId} onOpen={(l) => ls.setOpenId(l.id)} nameOf={nameOf} sla={sla} fresh={fresh} me={me}
                onAssign={async (l, uid) => { await assign(l, uid); if (l.status === "new") { patchLocal(l.id, { status: "in_progress" }); void updateLead(l.id, { status: "in_progress" }); } toast(t("assigned")); }}
                onMove={async (l, status) => {
                  if (status === "lost") { ls.setOpenId(l.id); toast(t("lostReason"), { description: t("lostReasonPlaceholder") }); return; }
                  const prev = l.status;
                  patchLocal(l.id, { status });
                  const r = await updateLead(l.id, { status });
                  if (!r.ok) { patchLocal(l.id, { status: prev }); toast.error(r.error); }
                  else toast(t("statusChanged", { status: te(`leadStatus.${status}`) }), { undo: () => { patchLocal(l.id, { status: prev }); void updateLead(l.id, { status: prev }); } });
                }} />
            )}
            <BulkBar count={selected.size} label={tc("selected", { count: selected.size })} onClear={() => setSelected(new Set())} clearLabel={tc("clearSelection")}>
              <Menu>
                <MenuTrigger className="h-7 rounded-full px-2.5 text-xs hover:bg-hover">{t("bulkAssign")}</MenuTrigger>
                <MenuContent>{members.map((m) => <MenuItem key={m.userId} onSelect={() => bulk({ assigneeId: m.userId }, m.name)}>{m.name}</MenuItem>)}</MenuContent>
              </Menu>
              <Menu>
                <MenuTrigger className="h-7 rounded-full px-2.5 text-xs hover:bg-hover">{t("bulkStatus")}</MenuTrigger>
                <MenuContent>{STATUSES.filter((s) => s !== "lost").map((s) => <MenuItem key={s} onSelect={() => bulk({ status: s }, te(`leadStatus.${s}`))}>{te(`leadStatus.${s}`)}</MenuItem>)}</MenuContent>
              </Menu>
              <Menu>
                <MenuTrigger className="h-7 rounded-full px-2.5 text-xs hover:bg-hover">{t("bulkTag")}</MenuTrigger>
                <MenuContent>{(["complaint", "urgent", "missed", "vip"] as const).map((s) => <MenuItem key={s} onSelect={() => bulk({ tags: [s] }, te(`leadTag.${s}`))}>{te(`leadTag.${s}`)}</MenuItem>)}</MenuContent>
              </Menu>
              <button onClick={exportCsv} className="h-7 rounded-full px-2.5 text-xs hover:bg-hover">{tc("export")}</button>
            </BulkBar>
          </div>
        }
        detail={ls.openId ? (
          <LeadCard key={ls.openId} id={ls.openId} members={members} me={me} onClose={() => ls.setOpenId(undefined)}
            onNav={(d) => { const n = filtered[openIdx + d]; if (n) ls.setOpenId(n.id); }}
            onChanged={(l) => patchLocal(l.id, l)} />
        ) : undefined}
      />
      <CreateLeadSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function Kanban({ leads, activeId, onOpen, onMove, nameOf, sla, fresh, me, onAssign }: {
  leads: Lead[]; activeId?: string; onOpen: (l: Lead) => void; onMove: (l: Lead, s: LeadStatus) => void;
  nameOf: (id?: string) => string | undefined; sla: ReturnType<typeof useSla>; fresh: Set<string>; me: string; onAssign: (l: Lead, userId: string) => void;
}) {
  const te = useTranslations("enums");
  const t = useTranslations("leads");
  const NEXT: Partial<Record<LeadStatus, LeadStatus>> = { new: "in_progress", in_progress: "won", waiting: "won" };
  const columns: KanbanColumn<LeadStatus>[] = [
    { key: "new", label: te("leadStatus.new"), tone: STATUS_TONE.new, hint: t("hints.new") },
    { key: "in_progress", label: te("leadStatus.in_progress"), tone: STATUS_TONE.in_progress, hint: t("hints.in_progress") },
    { key: "waiting", label: te("leadStatus.waiting"), tone: STATUS_TONE.waiting, hint: t("hints.waiting") },
    { key: "won", label: te("leadStatus.won"), tone: STATUS_TONE.won, collapsed: true },
    { key: "lost", label: te("leadStatus.lost"), tone: STATUS_TONE.lost, collapsed: true, hint: t("hints.lost") },
  ];
  // Внутри колонки: просроченные и срочные — сверху
  const sorted = [...leads].sort((a, b) => {
    const ua = Number(a.priority === "urgent" || a.type === "complaint") + Number(!!sla(a)?.overdue);
    const ub = Number(b.priority === "urgent" || b.type === "complaint") + Number(!!sla(b)?.overdue);
    return ub - ua || b.createdAt.localeCompare(a.createdAt);
  });
  return (
    <KanbanBoard columns={columns} items={sorted} getId={(l) => l.id} getColumn={(l) => l.status} onMove={onMove} onOpen={onOpen} activeId={activeId}
      storageKey="leads:kanban" highlightIds={fresh} isUrgent={(l) => l.priority === "urgent" || l.type === "complaint"}
      renderCard={(l) => {
        const st = sla(l);
        const next = NEXT[l.status];
        return (
          <>
            <div className="flex items-center gap-1.5 text-[11px] text-fg-faint"><span className="tabular-nums">#{l.number}</span>·<span>{te(`leadType.${l.type}`)}</span>
              {st && <span className={cn("ml-auto tabular-nums", st.overdue ? "font-medium text-danger" : "")}>{st.overdue ? `−${st.label}` : st.label}</span>}
            </div>
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-[18px]">{l.title}</p>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted">
              <span className="min-w-0 flex-1 truncate">{l.contactName ?? formatPhone(l.contactPhone)}</span>
              {l.assigneeId ? <Avatar name={nameOf(l.assigneeId)} /> : <span className="text-[11px] text-warning">{t("unassigned")}</span>}
            </div>
            {/* Быстрые действия без открытия карточки */}
            <div className="mt-1.5 flex flex-wrap gap-1">
              {!l.assigneeId && l.status !== "won" && l.status !== "lost" && <CardAction primary onClick={() => onAssign(l, me)}><Hand />{t("take")}</CardAction>}
              {l.contactPhone && l.status !== "won" && l.status !== "lost" && <CardAction onClick={() => { window.location.href = `tel:${l.contactPhone}`; }}><Phone />{t("callback")}</CardAction>}
              {next && l.assigneeId && <CardAction onClick={() => onMove(l, next)}>{next === "won" ? <Check /> : <ArrowRight />}{te(`leadStatus.${next}`)}</CardAction>}
            </div>
          </>
        );
      }} />
  );
}
