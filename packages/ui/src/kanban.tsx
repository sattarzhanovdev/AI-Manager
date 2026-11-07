"use client";
import * as React from "react";
import { cn } from "./cn";
import { Pill, type Tone } from "./pill";

export interface KanbanColumn<K extends string> {
  key: K;
  label: string;
  tone?: Tone;
  /** Подсказка под заголовком: что делать с карточками в колонке */
  hint?: string;
  /** Колонка свёрнута по умолчанию (например, «Закрытые») */
  collapsed?: boolean;
  /** Запрет бросать сюда карточку (с пояснением) */
  dropDisabled?: string;
}

/**
 * Канбан: колонки по статусам, перетаскивание, счётчики, свёрнутые колонки.
 * Клавиатура: стрелки ←/→ на выбранной карточке переносят её в соседнюю колонку, Enter открывает.
 */
export function KanbanBoard<T, K extends string>({
  columns, items, getId, getColumn, renderCard, onMove, onOpen, activeId, storageKey, footer, isUrgent, highlightIds, limit = 100,
}: {
  columns: KanbanColumn<K>[];
  items: T[];
  getId: (t: T) => string;
  getColumn: (t: T) => K;
  renderCard: (t: T) => React.ReactNode;
  onMove: (t: T, to: K) => void;
  onOpen?: (t: T) => void;
  activeId?: string;
  storageKey?: string;
  footer?: (col: K, items: T[]) => React.ReactNode;
  isUrgent?: (t: T) => boolean;
  highlightIds?: Set<string>;
  limit?: number;
}) {
  const [collapsed, setCollapsed] = React.useState<Set<K>>(() => new Set(columns.filter((c) => c.collapsed).map((c) => c.key)));
  const [over, setOver] = React.useState<K | null>(null);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!storageKey) return;
    try { const raw = localStorage.getItem(`${storageKey}:collapsed`); if (raw) setCollapsed(new Set(JSON.parse(raw) as K[])); } catch { /* приватный режим */ }
  }, [storageKey]);
  const toggle = (k: K) => setCollapsed((c) => {
    const n = new Set(c);
    if (n.has(k)) n.delete(k); else n.add(k);
    try { if (storageKey) localStorage.setItem(`${storageKey}:collapsed`, JSON.stringify([...n])); } catch { /* ignore */ }
    return n;
  });

  const byCol = (k: K) => items.filter((i) => getColumn(i) === k);
  const keyMove = (e: React.KeyboardEvent, item: T) => {
    const idx = columns.findIndex((c) => c.key === getColumn(item));
    if (e.key === "Enter") { e.preventDefault(); onOpen?.(item); }
    if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && e.shiftKey) {
      e.preventDefault();
      const next = columns[idx + (e.key === "ArrowRight" ? 1 : -1)];
      if (next && !next.dropDisabled) onMove(item, next.key);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2" role="list">
      {columns.map((col) => {
        const list = byCol(col.key);
        const isCollapsed = collapsed.has(col.key);
        const canDrop = dragging && !col.dropDisabled;
        return (
          <section key={col.key} aria-label={`${col.label}: ${list.length}`} role="listitem"
            onDragOver={(e) => { if (col.dropDisabled) return; e.preventDefault(); setOver(col.key); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
            onDrop={(e) => {
              e.preventDefault(); setOver(null); setDragging(null);
              const id = e.dataTransfer.getData("text/kanban");
              const it = items.find((x) => getId(x) === id);
              if (it && getColumn(it) !== col.key && !col.dropDisabled) onMove(it, col.key);
            }}
            className={cn("flex min-h-0 shrink-0 flex-col rounded-[12px] border bg-bg transition-[width,background-color,border-color]",
              isCollapsed ? "w-10" : "w-[280px]",
              over === col.key ? "border-fg-muted bg-hover" : canDrop ? "border-dashed border-line-strong" : "border-line",
              dragging && col.dropDisabled && "opacity-50")}>
            <header className={cn("flex shrink-0 border-b border-line", isCollapsed ? "h-full flex-col items-center gap-2 py-2" : "min-h-9 flex-col justify-center px-2.5 py-1.5")}>
              <button type="button" onClick={() => toggle(col.key)} aria-expanded={!isCollapsed}
                className={cn("flex min-w-0 items-center gap-2", isCollapsed && "flex-col")} title={isCollapsed ? "Развернуть" : "Свернуть"}>
                <Pill tone={col.tone ?? "neutral"} className={isCollapsed ? "[writing-mode:vertical-rl]" : ""}>{col.label}</Pill>
                <span className="text-xs tabular-nums text-fg-muted">{list.length}</span>
              </button>
              {!isCollapsed && col.hint && <p className="mt-0.5 truncate text-[11px] text-fg-faint">{col.hint}</p>}
            </header>
            {!isCollapsed && (
              <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-1.5">
                {list.length === 0 && <li className="rounded-[10px] border border-dashed border-line px-2 py-4 text-center text-[11px] text-fg-faint">{dragging && !col.dropDisabled ? "Перетащите сюда" : "Пусто"}</li>}
                {list.slice(0, limit).map((it) => {
                  const id = getId(it);
                  return (
                    <li key={id} draggable tabIndex={0}
                      onDragStart={(e) => { e.dataTransfer.setData("text/kanban", id); e.dataTransfer.effectAllowed = "move"; setDragging(id); }}
                      onDragEnd={() => { setDragging(null); setOver(null); }}
                      onClick={() => onOpen?.(it)} onFocus={() => setFocused(id)} onKeyDown={(e) => keyMove(e, it)}
                      className={cn("group cursor-grab rounded-[10px] border border-line bg-subtle p-2 outline-none hover:border-line-strong focus-visible:ring-1 focus-visible:ring-fg-muted active:cursor-grabbing",
                        activeId === id && "border-fg-muted", dragging === id && "opacity-40",
                        isUrgent?.(it) && "shadow-[inset_2px_0_0_var(--danger)]", highlightIds?.has(id) && "animate-[flash_3s_ease-out]", focused === id && "")}>
                      {renderCard(it)}
                    </li>
                  );
                })}
                {list.length > limit && <li className="px-2 py-1 text-center text-[11px] text-fg-faint">ещё {list.length - limit} — уточните фильтр</li>}
              </ul>
            )}
            {!isCollapsed && footer?.(col.key, list)}
          </section>
        );
      })}
    </div>
  );
}

/** Кнопка быстрого действия на карточке: не открывает карточку и не начинает перетаскивание */
export function CardAction({ children, onClick, primary, title }: { children: React.ReactNode; onClick: () => void; primary?: boolean; title?: string }) {
  return (
    <button type="button" title={title} draggable={false}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] [&_svg]:size-3",
        primary ? "bg-accent font-medium text-accent-fg hover:bg-accent-hover" : "border border-line-strong text-fg-secondary hover:bg-hover hover:text-fg")}>
      {children}
    </button>
  );
}
