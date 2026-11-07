"use client";
import * as React from "react";
import { Tooltip as RTooltip } from "radix-ui";
import { cn } from "./cn";

/** Мини-график для KPI и таблиц */
export function Sparkline({ data, className, dashed }: { data: number[]; className?: string; dashed?: number[] }) {
  const max = Math.max(1, ...data, ...(dashed ?? []));
  const w = 64;
  const h = 20;
  const pts = (d: number[]) => d.map((v, i) => `${(i / Math.max(1, d.length - 1)) * w},${h - (v / max) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-5 w-16 overflow-visible", className)} aria-hidden>
      {dashed && <polyline points={pts(dashed)} fill="none" stroke="var(--text-faint)" strokeWidth="1" strokeDasharray="2 2" />}
      <polyline points={pts(data)} fill="none" stroke="var(--text-secondary)" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  );
}

/** KPI 64px: подпись, число, дельта, мини-график */
export function Kpi({
  label, value, delta, deltaTone, spark, href, hint, onClick,
}: { label: string; value: React.ReactNode; delta?: string; deltaTone?: "up" | "down" | "neutral"; spark?: number[]; href?: string; hint?: string; onClick?: () => void }) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-fg-muted">{label}</span>
        {delta && (
          <span className={cn("text-xs tabular-nums", deltaTone === "up" ? "text-success" : deltaTone === "down" ? "text-danger" : "text-fg-faint")}>{delta}</span>
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="font-display text-xl font-medium leading-6 tracking-[-0.02em] tabular-nums text-fg">{value}</span>
        {spark ? <Sparkline data={spark} /> : hint ? <span className="truncate text-xs text-fg-faint">{hint}</span> : null}
      </div>
    </>
  );
  const cls = "flex h-16 min-w-0 flex-col justify-between rounded-[var(--radius-panel)] border border-line bg-bg px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-hover";
  if (href) return <a href={href} className={cls}>{inner}</a>;
  return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

/** Одна строка + кнопка первого действия, без иллюстраций */
export function EmptyState({ title, action, className }: { title: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-10 text-center", className)}>
      <p className="text-[13px] text-fg-muted">{title}</p>
      {action}
    </div>
  );
}

export function ErrorState({ title, retry, requestId, retryLabel = "Повторить" }: { title: string; retry?: () => void; requestId?: string; retryLabel?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center" role="alert">
      <p className="text-[13px] text-fg">{title}</p>
      {retry && <button onClick={retry} className="h-7 rounded-full border border-line-strong px-3 text-xs hover:bg-hover">{retryLabel}</button>}
      {requestId && <p className="font-mono text-[10px] text-fg-faint">request_id: {requestId}</p>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-active", className)} />;
}

/** Полоса расхода с порогами 80% и 100% */
export function UsageBar({ used, total, label, unit, forecast }: { used: number; total: number; label: string; unit: string; forecast?: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const fpct = forecast != null && total > 0 ? Math.min(100, (forecast / total) * 100) : undefined;
  const tone = pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-fg-secondary";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-fg-muted">{label}</span>
        <span className="tabular-nums text-fg">
          {used.toLocaleString("ru-RU")} <span className="text-fg-faint">/ {total.toLocaleString("ru-RU")} {unit}</span>
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-active" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        {fpct != null && <div className="absolute inset-y-0 left-0 bg-fg-faint/40" style={{ width: `${fpct}%` }} />}
        <div className={cn("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-0 w-px bg-bg-app" style={{ left: "80%" }} />
      </div>
    </div>
  );
}

export function Avatar({ name, className }: { name?: string; className?: string }) {
  const initials = (name ?? "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-active text-[9px] font-medium text-fg-secondary", className)} title={name}>
      {initials}
    </span>
  );
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <RTooltip.Provider delayDuration={300}>{children}</RTooltip.Provider>;
}

export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-md bg-elevated px-2 py-1 text-xs text-fg shadow-[var(--shadow-pop)]">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

/** Пары «подпись: значение» в две колонки */
export function DescList({ items, cols = 2 }: { items: { label: string; value: React.ReactNode }[]; cols?: 1 | 2 }) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-2", cols === 2 ? "grid-cols-2" : "grid-cols-1")}>
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-fg-muted">{it.label}</dt>
          <dd className="min-w-0 truncate text-[13px] text-fg">{it.value ?? <span className="text-fg-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between gap-2">
      <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-fg-muted">{children}</h3>
      {aside}
    </div>
  );
}
