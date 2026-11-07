import * as React from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const tones: Record<Tone, string> = {
  neutral: "bg-neutral text-fg-secondary [--dot:var(--text-faint)]",
  success: "bg-success-bg text-success [--dot:var(--success)]",
  warning: "bg-warning-bg text-warning [--dot:var(--warning)]",
  danger: "bg-danger-bg text-danger [--dot:var(--danger)]",
  info: "bg-info-bg text-info [--dot:var(--info)]",
  accent: "bg-accent text-accent-fg [--dot:var(--accent-fg)]",
};

/** Статус: точка + текст. Цвет никогда не единственный носитель смысла. */
export function Pill({ tone = "neutral", children, dot = true, className }: { tone?: Tone; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium", tones[tone], className)}>
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-[var(--dot)]" aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Tag({ children, onRemove, className }: { children: React.ReactNode; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-full border border-line px-2 text-xs text-fg-secondary", className)}>
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} className="-mr-1 text-fg-faint hover:text-fg" aria-label="Убрать">×</button>
      )}
    </span>
  );
}
