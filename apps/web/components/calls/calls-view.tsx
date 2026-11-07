"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { ThumbsDown, ThumbsUp, Flag, PhoneForwarded } from "lucide-react";
import {
  DataTable, Dash, EmptyState, FilterBar, PageHeader, Pill, SplitView, Tooltip, type ColumnDef, type FilterDef, type SavedView, type Tone,
} from "@all/ui";
import type { Call, CallOutcome } from "@all/db";
import { useRealtime } from "@/lib/use-realtime";
import { useListState, matchSearch } from "@/lib/use-list-state";
import { dayKeyInTz, formatDateTime, formatDuration, formatPhone, hourInTz, relativeTime } from "@/lib/format";
import { CallCard } from "./call-card";

export const OUTCOME_TONE: Record<CallOutcome, Tone> = {
  lead_created: "success", booked: "success", transferred: "info", no_result: "neutral", dropped: "warning", missed: "danger",
};

interface Props {
  calls: Call[];
  branches: { id: string; name: string }[];
  numbers: { id: string; e164: string }[];
  initial: { view?: string; open?: string; outcome?: string; hour?: string };
  tz: string;
}

export function CallsView({ calls: initialCalls, branches, numbers, initial, tz }: Props) {
  const t = useTranslations("calls");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const [calls, setCalls] = React.useState(initialCalls);
  const [fresh, setFresh] = React.useState<Set<string>>(new Set());

  // Новый звонок появляется вверху таблицы без сброса прокрутки
  useRealtime((e) => {
    if (e.type !== "call.created") return;
    setCalls((list) => [e.call, ...list]);
    setFresh((s) => new Set(s).add(e.call.id));
    setTimeout(() => setFresh((s) => { const n = new Set(s); n.delete(e.call.id); return n; }), 3000);
  });

  const views: SavedView[] = [
    { id: "all", label: t("views.all"), filters: {} },
    { id: "today", label: t("views.today"), filters: { period: ["today"] } },
    { id: "missed", label: t("views.missed"), filters: { outcome: ["missed"], callback: ["no"] } },
    { id: "complaints", label: t("views.complaints"), filters: { complaint: ["yes"] } },
    { id: "bad", label: t("views.bad"), filters: { rating: ["down"] } },
  ];
  const ls = useListState("calls", views, {
    view: initial.view, open: initial.open,
    filters: initial.outcome ? { outcome: [initial.outcome] } : initial.view ? views.find((v) => v.id === initial.view)?.filters : undefined,
  });

  const defs: FilterDef[] = [
    { key: "period", label: t("filters.period"), multi: false, options: (["today", "yesterday", "7d", "30d"] as const).map((v) => ({ value: v, label: t(`periods.${v}`) })) },
    { key: "type", label: t("filters.type"), options: (["booking", "consultation", "complaint", "reschedule", "irrelevant", "spam"] as const).map((v) => ({ value: v, label: te(`callType.${v}`) })) },
    { key: "outcome", label: t("filters.outcome"), options: (["lead_created", "transferred", "no_result", "dropped", "missed"] as const).map((v) => ({ value: v, label: te(`callOutcome.${v}`) })) },
    { key: "branch", label: t("filters.branch"), options: branches.map((b) => ({ value: b.id, label: b.name })) },
    { key: "number", label: t("filters.number"), options: numbers.map((n) => ({ value: n.id, label: formatPhone(n.e164) })) },
    { key: "transferred", label: t("filters.transferred"), multi: false, options: [{ value: "yes", label: tc("yes") }, { value: "no", label: tc("no") }] },
    { key: "complaint", label: t("filters.complaint"), multi: false, options: [{ value: "yes", label: tc("yes") }] },
    { key: "flags", label: t("filters.flags"), multi: false, options: [{ value: "yes", label: tc("yes") }] },
    { key: "rating", label: t("filters.rating"), options: [{ value: "up", label: t("ratings.up") }, { value: "down", label: t("ratings.down") }, { value: "none", label: t("ratings.none") }] },
    { key: "duration", label: t("filters.duration"), options: (["short", "mid", "long"] as const).map((v) => ({ value: v, label: t(`durations.${v}`) })) },
  ];

  const filtered = React.useMemo(() => {
    const f = ls.filters;
    const now = Date.now();
    const today = dayKeyInTz(new Date().toISOString(), tz);
    const yesterday = dayKeyInTz(new Date(now - 86400_000).toISOString(), tz);
    const has = (k: string) => (f[k]?.length ?? 0) > 0;
    return calls.filter((c) => {
      if (has("period")) {
        const p = f.period![0];
        const d = dayKeyInTz(c.startedAt, tz);
        if (p === "today" && d !== today) return false;
        if (p === "yesterday" && d !== yesterday) return false;
        if (p === "7d" && now - new Date(c.startedAt).getTime() > 7 * 86400_000) return false;
        if (p === "30d" && now - new Date(c.startedAt).getTime() > 30 * 86400_000) return false;
      }
      if (initial.hour && ls.view === "today" && hourInTz(c.startedAt, tz) !== Number(initial.hour)) return false;
      if (has("type") && (!c.type || !f.type!.includes(c.type))) return false;
      if (has("outcome") && !f.outcome!.includes(c.outcome)) return false;
      if (has("callback") && c.callbackDoneAt) return false;
      if (has("branch") && (!c.branchId || !f.branch!.includes(c.branchId))) return false;
      if (has("number") && !f.number!.includes(c.numberId)) return false;
      if (has("transferred") && (f.transferred![0] === "yes") !== c.transferred) return false;
      if (has("complaint") && c.type !== "complaint") return false;
      if (has("flags") && c.flags.length === 0) return false;
      if (has("rating")) {
        const r = c.rating === 1 ? "up" : c.rating === -1 ? "down" : "none";
        if (!f.rating!.includes(r)) return false;
      }
      if (has("duration")) {
        const d = c.durationS < 30 ? "short" : c.durationS <= 180 ? "mid" : "long";
        if (!f.duration!.includes(d)) return false;
      }
      return matchSearch(ls.search, c.caller, c.contactName, c.summary);
    });
  }, [calls, ls.filters, ls.search, ls.view, tz, initial.hour]);

  const columns = React.useMemo<ColumnDef<Call, unknown>[]>(() => [
    {
      id: "time", header: t("colTime"), size: 110, accessorFn: (c) => c.startedAt,
      cell: ({ row }) => <Tooltip content={formatDateTime(row.original.startedAt, tz)}><span className="text-fg-secondary">{relativeTime(row.original.startedAt)}</span></Tooltip>,
    },
    {
      id: "caller", header: t("colCaller"), size: 230, accessorFn: (c) => c.contactName ?? c.caller,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{row.original.contactName ?? formatPhone(row.original.caller)}</span>
          <span className="shrink-0 text-xs text-fg-faint">{row.original.isNewCaller ? t("new") : t("regular")}</span>
        </span>
      ),
    },
    { id: "duration", header: t("colDuration"), size: 70, accessorFn: (c) => c.durationS, meta: { align: "right" }, cell: ({ row }) => row.original.durationS ? formatDuration(row.original.durationS) : <Dash /> },
    { id: "type", header: t("colType"), size: 120, accessorFn: (c) => c.type ?? "", cell: ({ row }) => (row.original.type ? <span className={row.original.type === "complaint" ? "text-danger" : "text-fg-secondary"}>{te(`callType.${row.original.type}`)}</span> : <Dash />) },
    { id: "outcome", header: t("colOutcome"), size: 160, accessorFn: (c) => c.outcome, cell: ({ row }) => <Pill tone={OUTCOME_TONE[row.original.outcome]}>{te(`callOutcome.${row.original.outcome}`)}</Pill> },
    {
      id: "rating", header: t("colRating"), size: 90, enableSorting: false,
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5 text-fg-muted">
          {row.original.rating === 1 && <ThumbsUp className="size-3.5 text-success" />}
          {row.original.rating === -1 && <ThumbsDown className="size-3.5 text-danger" />}
          {row.original.transferred && <PhoneForwarded className="size-3.5" aria-label={te("callOutcome.transferred")} />}
          {row.original.flags.length > 0 && <Tooltip content={row.original.flags.map((f) => te(`callFlag.${f}`)).join(", ")}><Flag className="size-3.5 text-warning" /></Tooltip>}
          {!row.original.rating && !row.original.flags.length && !row.original.transferred && <Dash />}
        </span>
      ),
    },
    { id: "branch", header: t("colBranch"), size: 110, accessorFn: (c) => c.branchId, cell: ({ row }) => <span className="text-fg-muted">{branches.find((b) => b.id === row.original.branchId)?.name ?? "—"}</span> },
  ], [t, te, tz, branches]);

  const openIdx = filtered.findIndex((c) => c.id === ls.openId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t("title")} meta={<span className="tabular-nums">{filtered.length}</span>} />
      <SplitView storageKey="calls" onClose={() => ls.setOpenId(undefined)}
        list={
          <>
            <FilterBar defs={defs} values={ls.filters} onChange={ls.changeFilters} search={ls.search} onSearch={ls.setSearch} searchPlaceholder={t("searchPlaceholder")}
              views={ls.views.map((v) => ({ ...v, count: v.id === "missed" ? calls.filter((c) => c.outcome === "missed" && !c.callbackDoneAt).length : undefined }))}
              activeView={ls.view} onView={ls.applyView} density={ls.density} onDensity={ls.setDensity}
              onSaveView={ls.saveView}
              labels={{ addFilter: tc("addFilter"), clear: tc("clearFilters"), density: tc("density"), any: tc("any"), saveView: tc("saveView") }} />
            <DataTable data={filtered} columns={columns} getRowId={(c) => c.id} activeId={ls.openId} onOpen={(c) => ls.setOpenId(c.id)}
              density={ls.density} storageKey="calls:table" highlightIds={fresh} columnsLabel={tc("columns")}
              rowClassName={(c) => (c.type === "complaint" ? "[&>td:first-child]:shadow-[inset_2px_0_0_var(--danger)]" : undefined)}
              empty={<EmptyState title={calls.length ? t("emptyFiltered") : t("empty")} />} />
          </>
        }
        detail={ls.openId ? (
          <CallCard key={ls.openId} id={ls.openId} onClose={() => ls.setOpenId(undefined)}
            onNav={(d) => { const n = filtered[openIdx + d]; if (n) ls.setOpenId(n.id); }}
            onChanged={(c) => setCalls((list) => list.map((x) => (x.id === c.id ? { ...x, ...c } : x)))} />
        ) : undefined}
      />
    </div>
  );
}
