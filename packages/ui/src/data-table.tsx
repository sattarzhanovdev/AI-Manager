"use client";
import * as React from "react";
import {
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState, type VisibilityState, type ColumnSizingState, type Row,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { cn } from "./cn";
import { Checkbox } from "./field";
import { Menu, MenuContent, MenuTrigger, MenuLabel } from "./overlay";
import { DropdownMenu } from "radix-ui";

export type Density = "compact" | "default" | "comfy";
const ROW_H: Record<Density, number> = { compact: 28, default: 32, comfy: 40 };

export type { ColumnDef };

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  getRowId: (row: T) => string;
  /** Открытая запись (подсвечена, деталь справа) */
  activeId?: string;
  onOpen?: (row: T) => void;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (s: Set<string>) => void;
  density?: Density;
  rowClassName?: (row: T) => string | undefined;
  /** Подсветка новых строк из Realtime на 3 с */
  highlightIds?: Set<string>;
  storageKey?: string;
  empty?: React.ReactNode;
  columnsLabel?: string;
  className?: string;
}

function useStored<S>(key: string | undefined, initial: S): [S, React.Dispatch<React.SetStateAction<S>>] {
  const [v, setV] = React.useState<S>(initial);
  React.useEffect(() => {
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (raw) setV(JSON.parse(raw) as S);
    } catch { /* приватный режим */ }
  }, [key]);
  React.useEffect(() => {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* приватный режим */ }
  }, [key, v]);
  return [v, setV];
}

/**
 * Таблица кабинета: липкая шапка, сортировка, ресайз, видимость колонок, выбор строк с Shift,
 * виртуализация от 200 строк, J/K и стрелки, Enter открывает деталь.
 */
export function DataTable<T>({
  data, columns, getRowId, activeId, onOpen, selectable, selected, onSelectedChange,
  density = "default", rowClassName, highlightIds, storageKey, empty, columnsLabel = "Колонки", className,
}: DataTableProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [visibility, setVisibility] = useStored<VisibilityState>(storageKey && `${storageKey}:vis`, {});
  const [sizing, setSizing] = useStored<ColumnSizingState>(storageKey && `${storageKey}:size`, {});
  const lastClicked = React.useRef<number | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = React.useState<number>(-1);

  const table = useReactTable({
    data, columns, getRowId: (r) => getRowId(r),
    state: { sorting, columnVisibility: visibility, columnSizing: sizing },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    onColumnSizingChange: setSizing,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    defaultColumn: { size: 140, minSize: 48 },
  });
  const rows = table.getRowModel().rows;
  const rowH = ROW_H[density];
  const virtual = rows.length >= 200;
  const virtualizer = useVirtualizer({
    count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => rowH, overscan: 12, enabled: virtual,
  });

  // Курсор следует за открытой записью
  React.useEffect(() => {
    if (!activeId) return;
    const i = rows.findIndex((r) => r.id === activeId);
    if (i >= 0) setCursor(i);
  }, [activeId, rows]);

  const toggleRow = (row: Row<T>, index: number, shift: boolean) => {
    if (!onSelectedChange) return;
    const next = new Set(selected);
    if (shift && lastClicked.current != null) {
      const [a, b] = [Math.min(lastClicked.current, index), Math.max(lastClicked.current, index)];
      for (let i = a; i <= b; i++) { const r = rows[i]; if (r) next.add(r.id); }
    } else if (next.has(row.id)) next.delete(row.id);
    else next.add(row.id);
    lastClicked.current = index;
    onSelectedChange(next);
  };

  const move = React.useCallback((delta: number, open: boolean) => {
    setCursor((c) => {
      const n = Math.max(0, Math.min(rows.length - 1, c + delta));
      const r = rows[n];
      if (r && open) onOpen?.(r.original);
      if (virtual) virtualizer.scrollToIndex(n);
      else scrollRef.current?.querySelector<HTMLElement>(`[data-index="${n}"]`)?.scrollIntoView({ block: "nearest" });
      return n;
    });
  }, [rows, onOpen, virtual, virtualizer]);

  // J/K — соседняя запись с открытием детали; стрелки — курсор; Enter — открыть; x — выбрать
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j") { e.preventDefault(); move(1, true); }
      else if (e.key === "k") { e.preventDefault(); move(-1, true); }
      else if (e.key === "ArrowDown") { e.preventDefault(); move(1, false); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1, false); }
      else if (e.key === "Enter" && cursor >= 0) { const r = rows[cursor]; if (r) onOpen?.(r.original); }
      else if (e.key === "x" && selectable && cursor >= 0) { const r = rows[cursor]; if (r) toggleRow(r, cursor, false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected?.has(r.id));
  const items = virtual ? virtualizer.getVirtualItems() : rows.map((_, i) => ({ index: i, start: i * rowH, key: i }));
  const totalH = virtual ? virtualizer.getTotalSize() : rows.length * rowH;
  const padTop = virtual ? (items[0]?.start ?? 0) : 0;
  const padBottom = virtual ? totalH - ((items.at(-1)?.start ?? 0) + rowH) : 0;

  return (
    <div ref={scrollRef} className={cn("relative min-h-0 flex-1 overflow-auto", className)} role="grid" aria-rowcount={rows.length}>
      <table className="w-full min-w-max border-separate border-spacing-0 text-[13px]" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {selectable && <col style={{ width: 32 }} />}
          {table.getVisibleLeafColumns().map((c) => <col key={c.id} style={{ width: c.getSize() }} />)}
          <col style={{ width: 36 }} />
        </colgroup>
        <thead className="sticky top-0 z-10">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {selectable && (
                <th className="h-8 border-b border-line bg-subtle pl-3">
                  <Checkbox aria-label="Выбрать все" checked={!!allSelected}
                    onChange={() => onSelectedChange?.(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} />
                </th>
              )}
              {hg.headers.map((h) => {
                const meta = h.column.columnDef.meta as { align?: "right" } | undefined;
                const sorted = h.column.getIsSorted();
                return (
                  <th key={h.id} className={cn("group relative h-8 select-none border-b border-line bg-subtle px-3 text-xs font-normal text-fg-muted", meta?.align === "right" ? "text-right" : "text-left")}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}>
                    {h.isPlaceholder ? null : (
                      <button type="button" disabled={!h.column.getCanSort()} onClick={h.column.getToggleSortingHandler()}
                        className={cn("inline-flex max-w-full items-center gap-1 truncate hover:text-fg disabled:hover:text-fg-muted", meta?.align === "right" && "flex-row-reverse")}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : null}
                      </button>
                    )}
                    {h.column.getCanResize() && (
                      <span onMouseDown={h.getResizeHandler()} onTouchStart={h.getResizeHandler()}
                        className="absolute right-0 top-1.5 h-5 w-1 cursor-col-resize rounded bg-transparent group-hover:bg-line-strong" aria-hidden />
                    )}
                  </th>
                );
              })}
              <th className="h-8 border-b border-line bg-subtle pr-2 text-right">
                <Menu>
                  <MenuTrigger className="inline-flex size-6 items-center justify-center rounded-full text-fg-faint hover:bg-hover hover:text-fg" aria-label={columnsLabel}>
                    <Columns3 className="size-3.5" />
                  </MenuTrigger>
                  <MenuContent>
                    <MenuLabel>{columnsLabel}</MenuLabel>
                    {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => (
                      <DropdownMenu.CheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} onSelect={(e) => e.preventDefault()}
                        className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[highlighted]:bg-hover">
                        <span className="w-3 text-xs">{c.getIsVisible() ? "✓" : ""}</span>
                        {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                      </DropdownMenu.CheckboxItem>
                    ))}
                  </MenuContent>
                </Menu>
              </th>
            </tr>
          ))}
        </thead>
        <tbody>
          {padTop > 0 && <tr style={{ height: padTop }} />}
          {items.map((vi) => {
            const row = rows[vi.index];
            if (!row) return null;
            const isActive = row.id === activeId;
            const isCursor = vi.index === cursor;
            const isSel = selected?.has(row.id);
            return (
              <tr key={row.id} data-index={vi.index} aria-selected={isActive}
                onClick={(e) => { setCursor(vi.index); if (e.shiftKey && selectable) toggleRow(row, vi.index, true); else onOpen?.(row.original); }}
                className={cn("group cursor-pointer transition-colors [&>td]:border-b [&>td]:border-line",
                  isActive ? "bg-selected" : isSel ? "bg-hover" : "hover:bg-hover",
                  isCursor && !isActive && "outline outline-1 -outline-offset-1 outline-line-strong",
                  highlightIds?.has(row.id) && "animate-[flash_3s_ease-out]",
                  rowClassName?.(row.original))}
                style={{ height: rowH }}>
                {selectable && (
                  <td className="pl-3" onClick={(e) => { e.stopPropagation(); toggleRow(row, vi.index, e.shiftKey); }}>
                    <Checkbox aria-label="Выбрать" checked={!!isSel} readOnly />
                  </td>
                )}
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as { align?: "right" } | undefined;
                  return (
                    <td key={cell.id} className={cn("truncate px-3 text-fg", meta?.align === "right" && "text-right tabular-nums")}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
                <td />
              </tr>
            );
          })}
          {padBottom > 0 && <tr style={{ height: padBottom }} />}
        </tbody>
      </table>
      {rows.length === 0 && empty}
    </div>
  );
}

/** Пустое значение — «—» серым, не пустая ячейка */
export function Dash() {
  return <span className="text-fg-faint">—</span>;
}
