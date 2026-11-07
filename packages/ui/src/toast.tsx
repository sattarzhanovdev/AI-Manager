"use client";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";

/** Тосты внизу справа; для обратимых действий — «Отменить» на 5 с */
export function Toaster() {
  return (
    <Sonner position="bottom-right" theme="system" duration={5000}
      toastOptions={{ className: "!rounded-[12px] !border-line !bg-elevated !text-fg !text-[13px] !shadow-[var(--shadow-pop)]" }} />
  );
}

export const toast = Object.assign(
  (message: string, opts?: { undo?: () => void; undoLabel?: string; description?: string }) =>
    sonnerToast(message, {
      description: opts?.description,
      action: opts?.undo ? { label: opts.undoLabel ?? "Отменить", onClick: opts.undo } : undefined,
    }),
  { error: (m: string, d?: string) => sonnerToast.error(m, { description: d }), success: (m: string) => sonnerToast.success(m) },
);
