"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Check, Download, Loader2, Percent, Plus, Trash2, Upload } from "lucide-react";
import { Button, Field, Input, PageHeader, Popover, PopoverContent, PopoverTrigger, Select, Sheet, Tabs, toast } from "@all/ui";
import type { Faq, Service, StaffMember, Weekday } from "@all/db";
import { bulkPrice, deleteRows, upsertFaq, upsertServices, upsertStaff } from "@/lib/actions";
import { SheetGrid, type GridColumn, type GridRow } from "./sheet-grid";

type Table = "services" | "staff" | "faq";

type ServiceRow = GridRow & { id?: string; name?: string; synonyms?: string[]; priceType?: Service["priceType"]; priceMin?: number; priceMax?: number; currency?: string; durationMin?: number; staff?: string[]; active?: boolean };
type StaffRow = GridRow & { id?: string; name?: string; specialties?: string[]; services?: string[]; branchId?: string; hours?: Partial<Record<Weekday, [string, string][]>>; languages?: string[]; transferPhone?: string; bookable?: boolean };
type FaqRow = GridRow & { id?: string; question?: string; synonyms?: string[]; shortAnswer?: string; longAnswer?: string; source?: string; active?: boolean };
type AnyRow = ServiceRow & StaffRow & FaqRow;

let seq = 0;
const tmp = () => `new_${Date.now()}_${++seq}`;

export function TableEditor({ table, services, staff, faq, branches, canEdit, prefillQuestion }: {
  table: Table; services: Service[]; staff: StaffMember[]; faq: Faq[]; branches: { id: string; name: string }[]; canEdit: boolean; prefillQuestion?: string;
}) {
  const t = useTranslations("kbTables");
  const te = useTranslations("enums");
  const tc = useTranslations("common");
  const router = useRouter();

  const initialRows = React.useMemo<AnyRow[]>(() => {
    if (table === "services") return services.map((s) => ({ _id: s.id, id: s.id, name: s.name, synonyms: s.synonyms, priceType: s.priceType, priceMin: s.priceMin != null ? s.priceMin / 100 : undefined, priceMax: s.priceMax != null ? s.priceMax / 100 : undefined, currency: s.currency, durationMin: s.durationMin, staff: s.staffIds.map((id) => staff.find((x) => x.id === id)?.name ?? id), active: s.active }) as AnyRow);
    if (table === "staff") return staff.map((s) => ({ _id: s.id, id: s.id, name: s.name, specialties: s.specialties, services: s.serviceIds.map((id) => services.find((x) => x.id === id)?.name ?? id), branchId: s.branchId, hours: s.hours, languages: s.languages, transferPhone: s.transferPhone, bookable: s.bookable }) as AnyRow);
    const rows = faq.map((f) => ({ _id: f.id, id: f.id, question: f.question, synonyms: f.synonyms, shortAnswer: f.shortAnswer, longAnswer: f.longAnswer, source: f.source, active: f.active }) as AnyRow);
    // «Добавить ответ в анкету» из звонка открывает FAQ с заполненным вопросом
    if (prefillQuestion) rows.unshift({ _id: tmp(), _new: true, _dirty: true, question: prefillQuestion, synonyms: [], source: "call", active: true } as AnyRow);
    return rows;
  }, [table, services, staff, faq, prefillQuestion]);

  const [rows, setRowsState] = React.useState<AnyRow[]>(initialRows);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved" | "invalid">("idle");
  const [hoursFor, setHoursFor] = React.useState<number | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  React.useEffect(() => setRowsState(initialRows), [initialRows]);
  const setRows = React.useCallback((fn: (r: AnyRow[]) => AnyRow[]) => setRowsState(fn), []);

  const makeRow = (): AnyRow => ({ _id: tmp(), _new: true, ...(table === "services" ? { priceType: "exact", currency: "KGS", synonyms: [], staff: [], active: true } : table === "staff" ? { specialties: [], services: [], languages: ["ru"], bookable: true, hours: {} } : { synonyms: [], source: "manual", active: true }) } as AnyRow);

  const columns: GridColumn<AnyRow>[] = table === "services" ? [
    { key: "name", label: t("cols.name"), width: 230, kind: "text", validate: (r) => (!r.name || r.name.length < 2 ? "Укажите название" : undefined) },
    { key: "synonyms", label: t("cols.synonyms"), width: 220, kind: "chips", placeholder: "через запятую" },
    { key: "priceType", label: t("cols.priceType"), width: 130, kind: "select", options: (["exact", "range", "after_inspection"] as const).map((v) => ({ value: v, label: te(`priceType.${v}`) })) },
    { key: "priceMin", label: t("cols.priceMin"), width: 100, kind: "money", disabled: (r) => r.priceType === "after_inspection",
      validate: (r) => (r.priceType !== "after_inspection" && (r.priceMin == null || typeof r.priceMin !== "number") ? "Укажите цену числом" : undefined) },
    { key: "priceMax", label: t("cols.priceMax"), width: 100, kind: "money", disabled: (r) => r.priceType !== "range",
      validate: (r) => (r.priceType === "range" && typeof r.priceMax === "number" && typeof r.priceMin === "number" && r.priceMax < r.priceMin ? "«До» меньше «от»" : undefined) },
    { key: "currency", label: t("cols.currency"), width: 70, kind: "select", options: ["KGS", "KZT", "RUB", "USD"].map((v) => ({ value: v, label: v })) },
    { key: "durationMin", label: t("cols.duration"), width: 70, kind: "int", validate: (r) => (r.durationMin != null && typeof r.durationMin !== "number" ? "Число минут" : undefined) },
    { key: "staff", label: t("cols.staff"), width: 150, kind: "chips" },
    { key: "active", label: t("cols.active"), width: 80, kind: "bool" },
  ] : table === "staff" ? [
    { key: "name", label: t("cols.name"), width: 160, kind: "text", validate: (r) => (!r.name ? "Укажите имя" : undefined) },
    { key: "specialties", label: t("cols.specialties"), width: 180, kind: "chips" },
    { key: "services", label: t("cols.services"), width: 220, kind: "chips" },
    { key: "branchId", label: t("cols.branch"), width: 120, kind: "select", options: branches.map((b) => ({ value: b.id, label: b.name })) },
    { key: "hours", label: t("cols.hours"), width: 170, kind: "text", onActivate: (_r, i) => setHoursFor(i), render: (r) => <span className="text-fg-secondary">{hoursSummary(r.hours)}</span> },
    { key: "languages", label: t("cols.languages"), width: 90, kind: "chips" },
    { key: "transferPhone", label: t("cols.transferPhone"), width: 150, kind: "text", validate: (r) => (r.transferPhone && !/^\+?[\d\s()-]{9,}$/.test(r.transferPhone) ? "Телефон в формате +996…" : undefined) },
    { key: "bookable", label: t("cols.bookable"), width: 110, kind: "bool" },
  ] : [
    { key: "question", label: t("cols.question"), width: 260, kind: "text", validate: (r) => (!r.question || r.question.length < 3 ? "Вопрос слишком короткий" : undefined) },
    { key: "synonyms", label: t("cols.qSynonyms"), width: 180, kind: "chips" },
    { key: "shortAnswer", label: t("cols.shortAnswer"), width: 300, kind: "text", validate: (r) => (!r.shortAnswer ? "Нужен короткий ответ для звонка" : r.shortAnswer.length > 400 ? "Слишком длинно для звонка" : undefined) },
    { key: "longAnswer", label: t("cols.longAnswer"), width: 280, kind: "text" },
    { key: "source", label: t("cols.source"), width: 90, kind: "text", disabled: () => true },
    { key: "active", label: t("cols.active"), width: 80, kind: "bool" },
  ];

  const invalidCount = rows.filter((r) => (r._dirty || r._new) && !isBlank(r, table) && columns.some((c) => c.validate?.(r))).length;

  // Автосохранение изменённых строк через 1 с
  const save = React.useCallback(async (snapshot: AnyRow[]) => {
    const dirty = snapshot.filter((r) => r._dirty && !isBlank(r, table));
    if (!dirty.length) return;
    if (dirty.some((r) => columns.some((c) => c.validate?.(r)))) { setSaving("invalid"); return; }
    setSaving("saving");
    const nameToStaff = (n: string) => staff.find((s) => s.name.toLowerCase() === n.toLowerCase())?.id;
    const nameToService = (n: string) => services.find((s) => s.name.toLowerCase() === n.toLowerCase())?.id;
    let r: { ok: boolean; error?: string; data?: { id: string }[] | undefined };
    if (table === "services") {
      r = await upsertServices(dirty.map((x) => ({
        id: x.id, name: x.name!, synonyms: x.synonyms ?? [], priceType: x.priceType ?? "exact",
        priceMin: x.priceType === "after_inspection" || x.priceMin == null ? undefined : Math.round(Number(x.priceMin) * 100),
        priceMax: x.priceType !== "range" || x.priceMax == null ? undefined : Math.round(Number(x.priceMax) * 100),
        currency: (x.currency ?? "KGS") as Service["currency"], durationMin: x.durationMin, staffIds: (x.staff ?? []).map(nameToStaff).filter((v): v is string => !!v), branchIds: [], active: x.active ?? true,
      })));
    } else if (table === "staff") {
      const res = await upsertStaff(dirty.map((x) => ({ id: x.id, name: x.name!, specialties: x.specialties ?? [], serviceIds: (x.services ?? []).map(nameToService).filter((v): v is string => !!v), branchId: x.branchId, hours: (x.hours ?? {}) as Record<string, [string, string][]>, languages: x.languages ?? ["ru"], transferPhone: x.transferPhone || undefined, bookable: x.bookable ?? true })));
      r = { ...res, data: undefined };
    } else {
      r = await upsertFaq(dirty.map((x) => ({ id: x.id, question: x.question!, synonyms: x.synonyms ?? [], shortAnswer: x.shortAnswer!, longAnswer: x.longAnswer, source: x.source ?? "manual", active: x.active ?? true })));
    }
    if (!r.ok) { setSaving("idle"); toast.error(r.error ?? ""); return; }
    const ids = r.data?.map((d) => d.id);
    setRowsState((rs) => {
      let k = 0;
      return rs.map((row) => {
        if (!dirty.some((d) => d._id === row._id)) return row;
        const newId = row.id ?? ids?.[k];
        k++;
        return { ...row, id: newId, _dirty: false, _new: false };
      });
    });
    setSaving("saved");
    router.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, services, staff, router]);

  React.useEffect(() => {
    if (!rows.some((r) => r._dirty) || !canEdit) return;
    const id = setTimeout(() => void save(rows), 1000);
    return () => clearTimeout(id);
  }, [rows, save, canEdit]);

  const removeSelected = async () => {
    const ids = rows.filter((r) => selected.has(r._id) && r.id).map((r) => r.id!);
    const r = await deleteRows(table, ids);
    if (!r.ok) { toast.error(r.error); return; }
    setRowsState((rs) => rs.filter((x) => !selected.has(x._id)));
    toast(t("deleted", { count: selected.size }));
    setSelected(new Set());
    router.refresh();
  };

  const exportCsv = () => {
    const head = columns.map((c) => c.label);
    const body = rows.filter((r) => !isBlank(r, table)).map((r) => columns.map((c) => {
      const v = r[c.key];
      const s = Array.isArray(v) ? v.join("; ") : c.key === "hours" ? hoursSummary(r.hours) : v == null ? "" : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    }).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + [head.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `${table}.csv`;
    a.click();
  };

  const tabs = [{ value: "services", label: t("services") }, { value: "staff", label: t("staff") }, { value: "faq", label: t("faq") }];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={<span className="flex items-center gap-2"><Link href="/app/knowledge" aria-label={tc("back")} className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover"><ArrowLeft className="size-4" /></Link>{t(table)}</span>}
        meta={<span className="flex items-center gap-1.5 tabular-nums">{rows.filter((r) => !isBlank(r, table)).length}
          {saving === "saving" && <><Loader2 className="size-3 animate-spin" />{tc("saving")}</>}
          {saving === "saved" && <><Check className="size-3" />{tc("saved")}</>}
          {saving === "invalid" && <span className="text-danger">{t("invalid")}</span>}
        </span>}>
        <Tabs value={table} onValueChange={(v) => router.push(`/app/knowledge/${v}`)} items={tabs} />
      </PageHeader>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        <Button size="sm" variant="primary" icon={<Plus />} disabled={!canEdit} onClick={() => setRowsState((rs) => [...rs, makeRow()])}>{t("addRow")}</Button>
        <Button size="sm" icon={<Upload />} disabled={!canEdit} onClick={() => setImportOpen(true)}>{t("import")}</Button>
        <Button size="sm" variant="ghost" icon={<Download />} onClick={exportCsv}>{tc("export")}</Button>
        {table === "services" && selected.size > 0 && <BulkPrice onApply={async (pct) => { const ids = rows.filter((r) => selected.has(r._id) && r.id).map((r) => r.id!); const r = await bulkPrice(ids, pct); if (r.ok) { toast(`${pct > 0 ? "+" : ""}${pct}%`); router.refresh(); } else toast.error(r.error); }} label={t("bulkPrice")} ph={t("bulkPricePh")} />}
        {selected.size > 0 && <Button size="sm" variant="danger" icon={<Trash2 />} disabled={!canEdit} onClick={removeSelected}>{t("deleteRows")} ({selected.size})</Button>}
        <span className="ml-auto text-xs text-fg-faint max-md:hidden">{t("pasteHint")}{table === "services" ? ` · ${t("afterInspectionNote")}` : ""}{invalidCount ? ` · ${invalidCount} с ошибками` : ""}</span>
      </div>
      <SheetGrid rows={rows} setRows={setRows} columns={columns} makeRow={makeRow} selected={selected} onSelected={setSelected} disabled={!canEdit}
        duplicateKey={(r) => (table === "faq" ? r.question ?? "" : r.name ?? "")} />
      {table === "staff" && hoursFor != null && rows[hoursFor] && (
        <HoursSheet value={rows[hoursFor]!.hours ?? {}} name={rows[hoursFor]!.name ?? ""} onClose={() => setHoursFor(null)}
          onSave={(h) => { setRowsState((rs) => rs.map((r, i) => (i === hoursFor ? { ...r, hours: h, _dirty: true } : r))); setHoursFor(null); }} />
      )}
      <ImportSheet open={importOpen} onOpenChange={setImportOpen} columns={columns}
        onImport={(newRows) => { setRowsState((rs) => [...rs.filter((r) => !isBlank(r, table)), ...newRows.map((x) => ({ ...makeRow(), ...x, _dirty: true }) as AnyRow)]); toast(t("rowsSaved", { count: newRows.length })); }} />
    </div>
  );
}

function isBlank(r: AnyRow, table: Table) {
  return table === "faq" ? !r.question && !r.shortAnswer : !r.name;
}

const DAY_ORDER: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_RU: Record<Weekday, string> = { mon: "Пн", tue: "Вт", wed: "Ср", thu: "Чт", fri: "Пт", sat: "Сб", sun: "Вс" };
function hoursSummary(h?: Partial<Record<Weekday, [string, string][]>>) {
  if (!h) return "—";
  const days = DAY_ORDER.filter((d) => h[d]?.length);
  if (!days.length) return "—";
  const first = h[days[0]!]![0]!;
  const same = days.every((d) => h[d]![0]![0] === first[0] && h[d]![0]![1] === first[1]);
  return same ? `${days.map((d) => DAY_RU[d]).join(", ")} ${first[0]}–${first[1]}` : days.map((d) => `${DAY_RU[d]} ${h[d]![0]![0]}–${h[d]![0]![1]}`).join("; ");
}

function HoursSheet({ value, name, onSave, onClose }: { value: Partial<Record<Weekday, [string, string][]>>; name: string; onSave: (h: Partial<Record<Weekday, [string, string][]>>) => void; onClose: () => void }) {
  const t = useTranslations("kbTables");
  const tc = useTranslations("common");
  const [h, setH] = React.useState(value);
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={`${t("hoursEditor")}: ${name}`} width={440}
      footer={<><Button onClick={onClose}>{tc("cancel")}</Button><Button variant="primary" onClick={() => onSave(h)}>{tc("apply")}</Button></>}>
      <div className="flex flex-col">
        {DAY_ORDER.map((d) => {
          const r = h[d]?.[0];
          return (
            <div key={d} className="flex h-10 items-center gap-3 border-b border-line">
              <label className="flex w-16 items-center gap-2 text-[13px]"><input type="checkbox" checked={!!r} onChange={(e) => setH({ ...h, [d]: e.target.checked ? [["09:00", "18:00"]] : [] })} className="accent-[var(--text)]" />{DAY_RU[d]}</label>
              {r ? <>
                <input type="time" value={r[0]} onChange={(e) => setH({ ...h, [d]: [[e.target.value, r[1]]] })} className="h-7 rounded-md border border-line bg-bg px-1.5 text-[13px] tabular-nums" />
                <span className="text-fg-faint">—</span>
                <input type="time" value={r[1]} onChange={(e) => setH({ ...h, [d]: [[r[0], e.target.value]] })} className="h-7 rounded-md border border-line bg-bg px-1.5 text-[13px] tabular-nums" />
              </> : <span className="text-xs text-fg-faint">выходной</span>}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

function BulkPrice({ onApply, label, ph }: { onApply: (pct: number) => void; label: string; ph: string }) {
  const [v, setV] = React.useState("");
  return (
    <Popover>
      <PopoverTrigger className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-xs hover:bg-hover"><Percent className="size-3.5" />{label}</PopoverTrigger>
      <PopoverContent className="w-52">
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); const n = Number(v); if (Number.isFinite(n) && n !== 0) onApply(n); }}>
          <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={ph} />
          <Button variant="primary">OK</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Импорт CSV/XLSX (XLSX — сохраните как CSV) с сопоставлением колонок */
function ImportSheet({ open, onOpenChange, columns, onImport }: { open: boolean; onOpenChange: (v: boolean) => void; columns: GridColumn<AnyRow>[]; onImport: (rows: Partial<AnyRow>[]) => void }) {
  const t = useTranslations("kbTables");
  const [data, setData] = React.useState<string[][]>([]);
  const [map, setMap] = React.useState<Record<number, string>>({});
  const head = data[0] ?? [];
  const parseCsv = (text: string) => {
    const sep = text.split("\n")[0]!.includes(";") && !text.split("\n")[0]!.includes(",") ? ";" : text.includes("\t") ? "\t" : ",";
    const rows: string[][] = [];
    for (const line of text.replace(/\r/g, "").split("\n")) {
      if (!line.trim()) continue;
      const cells: string[] = [];
      let cur = "", q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (ch === sep && !q) { cells.push(cur); cur = ""; }
        else cur += ch;
      }
      cells.push(cur);
      rows.push(cells);
    }
    setData(rows);
    const auto: Record<number, string> = {};
    rows[0]?.forEach((h, i) => { const c = columns.find((c) => c.label.toLowerCase() === h.trim().toLowerCase() || c.key.toLowerCase() === h.trim().toLowerCase()); if (c) auto[i] = c.key; });
    setMap(auto);
  };
  const doImport = () => {
    const rows = data.slice(1).map((r) => {
      const o: Record<string, unknown> = {};
      r.forEach((cell, i) => {
        const key = map[i];
        const col = columns.find((c) => c.key === key);
        if (!col) return;
        const s = cell.trim();
        o[key!] = col.kind === "money" || col.kind === "int" ? (s ? Number(s.replace(/\s/g, "").replace(",", ".")) : undefined) : col.kind === "chips" ? s.split(/[;,]/).map((x) => x.trim()).filter(Boolean) : col.kind === "bool" ? !/^(нет|no|0|false)$/i.test(s) : col.kind === "select" ? (col.options?.find((x) => x.label.toLowerCase() === s.toLowerCase())?.value ?? s) : s;
      });
      return o as Partial<AnyRow>;
    });
    onImport(rows);
    onOpenChange(false);
    setData([]);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("importTitle")} width={560}
      footer={<Button variant="primary" disabled={data.length < 2} onClick={doImport}>{t("importDo")}</Button>}>
      <div className="flex flex-col gap-3">
        <input type="file" accept=".csv,.tsv,.txt" onChange={async (e) => { const f = e.target.files?.[0]; if (f) parseCsv(await f.text()); }} className="text-[13px] file:mr-3 file:h-8 file:rounded-full file:border file:border-line-strong file:bg-transparent file:px-3 file:text-[13px] file:text-fg" />
        {head.length > 0 && (
          <>
            <p className="text-xs text-fg-muted">{t("importMap")}</p>
            <div className="flex flex-col gap-1.5">
              {head.map((h, i) => (
                <div key={i} className="grid grid-cols-2 items-center gap-2">
                  <span className="truncate text-[13px]">{h} <span className="text-xs text-fg-faint">{data[1]?.[i]}</span></span>
                  <Select value={map[i] ?? ""} onChange={(e) => setMap({ ...map, [i]: e.target.value })}>
                    <option value="">{t("importSkip")}</option>
                    {columns.filter((c) => !c.onActivate).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </Select>
                </div>
              ))}
            </div>
            <Field label=""><span className="text-xs text-fg-muted">{t("importRows", { count: data.length - 1 })}</span></Field>
          </>
        )}
      </div>
    </Sheet>
  );
}
