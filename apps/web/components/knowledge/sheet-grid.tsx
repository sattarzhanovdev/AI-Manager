"use client";
import * as React from "react";
import { cn } from "@all/ui";

/**
 * Табличный редактор «как Excel»: ячейки редактируются по клику и с клавиатуры (Tab, Enter, стрелки),
 * вставка блока из буфера создаёт строки, Enter в последней строке добавляет новую,
 * невалидные ячейки — красная рамка с подсказкой, дубли подсвечены.
 */
export type CellKind = "text" | "money" | "int" | "select" | "chips" | "bool";

export interface GridColumn<R> {
  key: keyof R & string;
  label: string;
  width: number;
  kind: CellKind;
  options?: { value: string; label: string }[];
  /** Сообщение об ошибке или undefined */
  validate?: (row: R) => string | undefined;
  disabled?: (row: R) => boolean;
  placeholder?: string;
  /** Своя форма редактирования (например, мини-редактор недели) */
  onActivate?: (row: R, index: number) => void;
  render?: (row: R) => React.ReactNode;
}

export interface GridRow { _id: string; _dirty?: boolean; _new?: boolean }

const parseCell = (kind: CellKind, raw: string): unknown => {
  const s = raw.trim();
  if (kind === "money") { if (!s) return undefined; const n = Number(s.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : s; }
  if (kind === "int") { if (!s) return undefined; const n = parseInt(s.replace(/\s/g, ""), 10); return Number.isFinite(n) ? n : s; }
  if (kind === "chips") return s ? s.split(/[,;|]/).map((x) => x.trim()).filter(Boolean) : [];
  if (kind === "bool") return !/^(нет|no|false|0|-)$/i.test(s);
  return s;
};
const showCell = (kind: CellKind, v: unknown, options?: { value: string; label: string }[]): string => {
  if (v == null || v === "") return "";
  if (kind === "chips") return (v as string[]).join(", ");
  if (kind === "bool") return v ? "Да" : "Нет";
  if (kind === "select") return options?.find((o) => o.value === v)?.label ?? String(v);
  if (kind === "money" && typeof v === "number") return new Intl.NumberFormat("ru-RU").format(v);
  return String(v);
};

export function SheetGrid<R extends GridRow>({
  rows, setRows, columns, makeRow, duplicateKey, selected, onSelected, disabled,
}: {
  rows: R[]; setRows: (fn: (rows: R[]) => R[]) => void; columns: GridColumn<R>[]; makeRow: () => R;
  duplicateKey?: (r: R) => string; selected: Set<string>; onSelected: (s: Set<string>) => void; disabled?: boolean;
}) {
  const [cursor, setCursor] = React.useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const gridRef = React.useRef<HTMLDivElement>(null);

  const dupes = React.useMemo(() => {
    if (!duplicateKey) return new Set<string>();
    const seen = new Map<string, number>();
    for (const r of rows) { const k = duplicateKey(r).toLowerCase().trim(); if (k) seen.set(k, (seen.get(k) ?? 0) + 1); }
    return new Set(rows.filter((r) => (seen.get(duplicateKey(r).toLowerCase().trim()) ?? 0) > 1).map((r) => r._id));
  }, [rows, duplicateKey]);

  const setCell = (ri: number, key: string, value: unknown) =>
    setRows((rs) => rs.map((r, i) => (i === ri ? { ...r, [key]: value, _dirty: true } : r)));

  const commit = () => {
    if (editing == null) return;
    const col = columns[cursor.c]!;
    setCell(cursor.r, col.key, parseCell(col.kind, draft));
    setEditing(null);
  };
  const startEdit = (initial?: string) => {
    const col = columns[cursor.c];
    const row = rows[cursor.r];
    if (!col || !row || disabled || col.disabled?.(row)) return;
    if (col.onActivate) { col.onActivate(row, cursor.r); return; }
    if (col.kind === "bool") { setCell(cursor.r, col.key, !row[col.key]); return; }
    setDraft(initial ?? showCell(col.kind === "select" ? "text" : col.kind, row[col.key]));
    setEditing(`${cursor.r}:${cursor.c}`);
  };
  const move = (dr: number, dc: number) => {
    setCursor((c) => {
      let r = c.r + dr, col = c.c + dc;
      if (col >= columns.length) { col = 0; r += 1; }
      if (col < 0) { col = columns.length - 1; r -= 1; }
      if (r >= rows.length && dr > 0 && !disabled) { setRows((rs) => [...rs, makeRow()]); }
      return { r: Math.max(0, Math.min(r, rows.length - (dr > 0 ? 0 : 1))), c: Math.max(0, Math.min(col, columns.length - 1)) };
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) {
      if (e.key === "Enter") { e.preventDefault(); commit(); move(1, 0); }
      else if (e.key === "Tab") { e.preventDefault(); commit(); move(0, e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(null); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); move(1, 0); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1, 0); }
    else if (e.key === "ArrowRight") { e.preventDefault(); move(0, 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(0, -1); }
    else if (e.key === "Tab") { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); }
    else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); startEdit(); }
    else if (e.key === "Backspace" || e.key === "Delete") { const col = columns[cursor.c]!; if (!disabled) setCell(cursor.r, col.key, col.kind === "chips" ? [] : undefined); }
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); startEdit(e.key); }
  };

  // Вставка блока из Excel: строки по \n, ячейки по \t, начиная с курсора; недостающие строки создаются
  const onPaste = (e: React.ClipboardEvent) => {
    if (editing || disabled) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").split("\n").filter((l, i, a) => l.length || i < a.length - 1).filter(Boolean);
    setRows((rs) => {
      const next = [...rs];
      lines.forEach((line, i) => {
        const ri = cursor.r + i;
        while (next.length <= ri) next.push(makeRow());
        const cells = line.split("\t");
        const row = { ...next[ri]!, _dirty: true } as R;
        cells.forEach((cell, j) => {
          const col = columns[cursor.c + j];
          if (!col) return;
          let v: unknown = parseCell(col.kind, cell);
          if (col.kind === "select" && col.options) v = col.options.find((o) => o.label.toLowerCase() === cell.trim().toLowerCase() || o.value === cell.trim())?.value ?? v;
          (row as Record<string, unknown>)[col.key] = v;
        });
        next[ri] = row;
      });
      return next;
    });
  };

  React.useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${cursor.r}:${cursor.c}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [cursor]);

  const allSel = rows.length > 0 && rows.every((r) => selected.has(r._id));
  return (
    <div ref={gridRef} tabIndex={0} onKeyDown={onKeyDown} onPaste={onPaste} role="grid" aria-label="Табличный редактор"
      className="min-h-0 flex-1 overflow-auto focus:outline-none">
      <table className="border-separate border-spacing-0 text-[13px]" style={{ tableLayout: "fixed" }}>
        <colgroup><col style={{ width: 40 }} />{columns.map((c) => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="h-8 border-b border-r border-line bg-subtle text-center">
              <input type="checkbox" aria-label="Выбрать все" checked={allSel} onChange={() => onSelected(allSel ? new Set() : new Set(rows.map((r) => r._id)))} className="size-3.5 accent-[var(--text)]" />
            </th>
            {columns.map((c) => <th key={c.key} className="h-8 truncate border-b border-r border-line bg-subtle px-2 text-left text-xs font-normal text-fg-muted">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row._id} className={cn(dupes.has(row._id) && "bg-warning-bg", selected.has(row._id) && "bg-selected")}>
              <td className="h-8 border-b border-r border-line text-center text-[11px] tabular-nums text-fg-faint">
                <label className="flex h-full items-center justify-center gap-1">
                  <input type="checkbox" aria-label={`Строка ${ri + 1}`} checked={selected.has(row._id)} onChange={() => { const n = new Set(selected); if (n.has(row._id)) n.delete(row._id); else n.add(row._id); onSelected(n); }} className="size-3.5 accent-[var(--text)]" />
                </label>
              </td>
              {columns.map((col, ci) => {
                const isCursor = cursor.r === ri && cursor.c === ci;
                const isEditing = editing === `${ri}:${ci}`;
                const err = col.validate?.(row);
                const off = disabled || col.disabled?.(row);
                return (
                  <td key={col.key} data-cell={`${ri}:${ci}`} title={err}
                    onClick={() => { if (isCursor && !isEditing) startEdit(); else { commit(); setCursor({ r: ri, c: ci }); } }}
                    onDoubleClick={() => startEdit()}
                    className={cn("relative h-8 truncate border-b border-r border-line px-2", off && "text-fg-faint", (col.kind === "money" || col.kind === "int") && "text-right tabular-nums",
                      isCursor && "outline outline-2 -outline-offset-2 outline-fg-muted", err && "bg-danger-bg outline outline-1 -outline-offset-1 outline-danger")}>
                    {isEditing ? (
                      col.kind === "select" ? (
                        <select autoFocus value={draft} onChange={(e) => { setCell(ri, col.key, e.target.value); setEditing(null); }} onBlur={() => setEditing(null)}
                          className="absolute inset-0 h-full w-full bg-elevated px-1 text-[13px] focus:outline-none">
                          {col.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
                          className={cn("absolute inset-0 h-full w-full bg-elevated px-2 text-[13px] focus:outline-none", (col.kind === "money" || col.kind === "int") && "text-right")} />
                      )
                    ) : col.render ? col.render(row) : col.kind === "chips" ? (
                      <span className="flex gap-1 overflow-hidden">{((row[col.key] as string[] | undefined) ?? []).map((x) => <span key={x} className="shrink-0 rounded-full border border-line px-1.5 text-[11px] text-fg-secondary">{x}</span>)}</span>
                    ) : showCell(col.kind, row[col.key], col.options) || <span className="text-fg-faint">{off ? "—" : col.placeholder ?? ""}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
