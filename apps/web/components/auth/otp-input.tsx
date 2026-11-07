"use client";
import * as React from "react";
import { cn } from "@all/ui";

/** 6 ячеек: автопереход, вставка из буфера, Backspace назад */
export function OtpInput({ value, onChange, onComplete, invalid, autoFocus }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; invalid?: boolean; autoFocus?: boolean }) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const set = (v: string) => {
    const clean = v.replace(/\D/g, "").slice(0, 6);
    onChange(clean);
    if (clean.length === 6) onComplete?.(clean);
    refs.current[Math.min(clean.length, 5)]?.focus();
  };
  return (
    <div className="flex gap-2" onPaste={(e) => { e.preventDefault(); set(e.clipboardData.getData("text")); }}>
      {Array.from({ length: 6 }, (_, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} maxLength={1}
          autoFocus={autoFocus && i === 0} aria-label={`Цифра ${i + 1}`} aria-invalid={invalid}
          value={value[i] ?? ""}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "").slice(-1);
            const next = (value.slice(0, i) + d + value.slice(i + 1)).slice(0, 6);
            set(d ? next : value.slice(0, i));
          }}
          onKeyDown={(e) => { if (e.key === "Backspace" && !value[i] && i > 0) { refs.current[i - 1]?.focus(); onChange(value.slice(0, i - 1)); } }}
          className={cn("h-11 w-full min-w-0 rounded-[10px] border bg-bg text-center font-mono text-lg tabular-nums focus:border-fg-muted focus:outline-none",
            invalid ? "border-danger" : "border-line")} />
      ))}
    </div>
  );
}
