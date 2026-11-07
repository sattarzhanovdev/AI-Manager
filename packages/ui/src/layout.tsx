"use client";
import * as React from "react";
import { Plus, X, Search, Rows3, Rows2, Rows4 } from "lucide-react";
import { cn } from "./cn";
import { Popover, PopoverContent, PopoverTrigger, Segmented } from "./overlay";
import type { Density } from "./data-table";

/**
 * Таблица слева, деталь справа. Разделитель тянется, ширина сохраняется, Esc закрывает деталь.
 * На узком экране деталь открывается поверх списка (стеком).
 */
export function SplitView({
  list, detail, onClose, storageKey = "split", defaultWidth = 45, minPct = 30, maxPct = 65,
}: { list: React.ReactNode; detail?: React.ReactNode; onClose?: () => void; storageKey?: string; defaultWidth?: number; minPct?: number; maxPct?: number }) {
  const [pct, setPct] = React.useState(defaultWidth);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    try { const v = Number(localStorage.getItem(`${storageKey}:w`)); if (v >= minPct && v <= maxPct) setPct(v); } catch { /* ignore */ }
  }, [storageKey, minPct, maxPct]);
  React.useEffect(() => {
    if (!detail || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "Escape" && !t.closest("input, textarea, select, [role=dialog], [role=menu]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, onClose]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => {
      const p = Math.min(maxPct, Math.max(minPct, ((rect.right - ev.clientX) / rect.width) * 100));
      setPct(p);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPct((p) => { try { localStorage.setItem(`${storageKey}:w`, String(Math.round(p))); } catch { /* ignore */ } return p; });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div ref={ref} className="relative flex min-h-0 flex-1">
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", detail && "max-md:hidden")}>{list}</div>
      {detail && (
        <>
          <div role="separator" aria-orientation="vertical" aria-label="Изменить ширину"
            onPointerDown={startDrag}
            className="group relative w-px shrink-0 cursor-col-resize bg-line max-md:hidden">
            <span className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-line-strong/50" />
          </div>
          <aside className="flex min-h-0 min-w-0 flex-col bg-bg max-md:!w-full" style={{ width: `${pct}%` }}>{detail}</aside>
        </>
      )}
    </div>
  );
}

export interface FilterOption { value: string; label: string }
export interface FilterDef { key: string; label: string; options: FilterOption[]; multi?: boolean }
export type FilterValues = Record<string, string[]>;
export interface SavedView { id: string; label: string; filters: FilterValues; count?: number }

/** Чипсы фильтров + «Добавить фильтр», поиск, плотность, сохранённые виды */
export function FilterBar({
  defs, values, onChange, search, onSearch, searchPlaceholder, views, activeView, onView, density, onDensity, right, labels, onSaveView,
}: {
  defs: FilterDef[]; values: FilterValues; onChange: (v: FilterValues) => void;
  search?: string; onSearch?: (s: string) => void; searchPlaceholder?: string;
  views?: SavedView[]; activeView?: string; onView?: (v: SavedView) => void;
  density?: Density; onDensity?: (d: Density) => void; right?: React.ReactNode;
  onSaveView?: (name: string) => void;
  labels: { addFilter: string; clear: string; density: string; any: string; saveView?: string };
}) {
  const active = defs.filter((d) => (values[d.key]?.length ?? 0) > 0);
  const inactive = defs.filter((d) => !(values[d.key]?.length));
  const set = (key: string, vals: string[]) => onChange({ ...values, [key]: vals });

  return (
    <div className="flex flex-col gap-2 border-b border-line px-3 py-2">
      {views && views.length > 0 && (
        <div className="-mx-1 flex items-center gap-0.5 overflow-x-auto">
          {views.map((v) => (
            <button key={v.id} type="button" onClick={() => onView?.(v)}
              className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px]",
                activeView === v.id ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}>
              {v.label}
              {v.count != null && <span className="text-xs tabular-nums text-fg-faint">{v.count}</span>}
            </button>
          ))}
          {onSaveView && active.length > 0 && <SaveView label={labels.saveView ?? "Save view"} onSave={onSaveView} />}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {onSearch && (
          <label className="relative flex h-7 w-56 items-center max-sm:w-full">
            <Search className="pointer-events-none absolute left-2 size-3.5 text-fg-faint" />
            <input data-page-search value={search} onChange={(e) => onSearch(e.target.value)} placeholder={searchPlaceholder}
              className="h-7 w-full rounded-full border border-line bg-transparent pl-7 pr-2 text-[13px] placeholder:text-fg-faint focus:border-fg-muted focus:outline-none" />
          </label>
        )}
        {active.map((d) => (
          <FilterChip key={d.key} def={d} value={values[d.key] ?? []} onChange={(v) => set(d.key, v)} anyLabel={labels.any} />
        ))}
        {inactive.length > 0 && (
          <Popover>
            <PopoverTrigger className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-xs text-fg-muted hover:text-fg">
              <Plus className="size-3.5" /> {labels.addFilter}
            </PopoverTrigger>
            <PopoverContent className="w-56 p-1">
              {inactive.map((d) => (
                <Popover key={d.key}>
                  <PopoverTrigger className="flex h-7 w-full items-center rounded-md px-2 text-left text-[13px] hover:bg-hover">{d.label}</PopoverTrigger>
                  <PopoverContent className="w-56 p-1"><OptionList def={d} value={[]} onChange={(v) => set(d.key, v)} /></PopoverContent>
                </Popover>
              ))}
            </PopoverContent>
          </Popover>
        )}
        {active.length > 0 && (
          <button type="button" onClick={() => onChange({})} className="h-7 px-1.5 text-xs text-fg-faint hover:text-fg">{labels.clear}</button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {right}
          {onDensity && density && (
            <Segmented label={labels.density} value={density} onChange={onDensity}
              items={[{ value: "compact", label: "", icon: <Rows4 /> }, { value: "default", label: "", icon: <Rows3 /> }, { value: "comfy", label: "", icon: <Rows2 /> }]} />
          )}
        </div>
      </div>
    </div>
  );
}

function SaveView({ label, onSave }: { label: string; onSave: (name: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs text-fg-faint hover:text-fg">
        <Plus className="size-3.5" /> {label}
      </PopoverTrigger>
      <PopoverContent className="w-60">
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onSave(name.trim()); setName(""); setOpen(false); } }} className="flex gap-1.5">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={label}
            className="h-7 min-w-0 flex-1 rounded-[8px] border border-line bg-bg px-2 text-[13px] focus:border-fg-muted focus:outline-none" />
          <button className="h-7 rounded-full bg-accent px-2.5 text-xs font-medium text-accent-fg">OK</button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function OptionList({ def, value, onChange }: { def: FilterDef; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex max-h-72 flex-col overflow-y-auto">
      {def.options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button"
            onClick={() => onChange(def.multi === false ? [o.value] : on ? value.filter((x) => x !== o.value) : [...value, o.value])}
            className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-hover">
            <span className={cn("flex size-3.5 items-center justify-center rounded-[3px] border text-[10px]", on ? "border-fg bg-fg text-bg" : "border-line-strong")}>{on ? "✓" : ""}</span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function FilterChip({ def, value, onChange, anyLabel }: { def: FilterDef; value: string[]; onChange: (v: string[]) => void; anyLabel: string }) {
  const labels = def.options.filter((o) => value.includes(o.value)).map((o) => o.label);
  return (
    <span className="inline-flex h-7 items-center rounded-full border border-line-strong bg-hover text-xs">
      <Popover>
        <PopoverTrigger className="inline-flex h-full items-center gap-1 pl-2.5 pr-1">
          <span className="text-fg-muted">{def.label}:</span>
          <span className="max-w-40 truncate text-fg">{labels.length ? labels.join(", ") : anyLabel}</span>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1"><OptionList def={def} value={value} onChange={onChange} /></PopoverContent>
      </Popover>
      <button type="button" onClick={() => onChange([])} className="mr-1 inline-flex size-5 items-center justify-center rounded-full text-fg-faint hover:text-fg" aria-label={`Убрать фильтр ${def.label}`}>
        <X className="size-3" />
      </button>
    </span>
  );
}

/** Плавающая полоса массовых действий при выборе строк */
export function BulkBar({ count, label, children, onClear, clearLabel }: { count: number; label: string; children: React.ReactNode; onClear: () => void; clearLabel: string }) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line-strong bg-elevated p-1 pl-3 shadow-[var(--shadow-pop)]">
        <span className="text-[13px] tabular-nums text-fg">{label}</span>
        <span className="mx-1 h-4 w-px bg-line" />
        {children}
        <button type="button" onClick={onClear} className="h-7 rounded-full px-2.5 text-xs text-fg-muted hover:bg-hover hover:text-fg">{clearLabel}</button>
      </div>
    </div>
  );
}

/** Заголовок рабочего экрана — 16px/600, без больших H1 */
export function PageHeader({ title, children, meta }: { title: React.ReactNode; children?: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5">
      <h1 className="font-display text-base font-semibold tracking-[-0.01em] text-fg">{title}</h1>
      {meta && <div className="text-xs text-fg-muted">{meta}</div>}
      <div className="ml-auto flex items-center gap-1.5">{children}</div>
    </div>
  );
}

export function Panel({ title, aside, children, className, bodyClassName }: { title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col rounded-[var(--radius-panel)] border border-line bg-bg", className)}>
      {title && (
        <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
          <h2 className="truncate text-[13px] font-medium text-fg">{title}</h2>
          {aside}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
