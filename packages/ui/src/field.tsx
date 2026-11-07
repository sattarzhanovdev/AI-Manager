"use client";
import * as React from "react";
import { cn } from "./cn";

const control =
  "w-full rounded-[var(--radius-ui)] border border-line bg-bg px-2.5 text-[13px] text-fg placeholder:text-fg-faint " +
  "hover:border-line-strong focus:border-fg-muted focus:outline-none aria-[invalid=true]:border-danger disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { size_?: "sm" | "md" }>(
  function Input({ className, size_ = "md", ...props }, ref) {
    return <input ref={ref} className={cn(control, size_ === "sm" ? "h-7" : "h-8", className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(control, "min-h-16 py-1.5 leading-5", className)} {...props} />;
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { size_?: "sm" | "md" }>(
  function Select({ className, size_ = "md", children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(control, "appearance-none bg-[length:12px] bg-[right_8px_center] bg-no-repeat pr-7", size_ === "sm" ? "h-7" : "h-8", className)}
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
        {...props}>
        {children}
      </select>
    );
  },
);

/** Подпись сверху 12px, ошибка под полем, подсказка справа от подписи */
export function Field({
  label, hint, error, children, className, aside, htmlFor,
}: { label: React.ReactNode; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string; aside?: React.ReactNode; htmlFor?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex items-center gap-2">
        <label htmlFor={htmlFor} className="text-xs text-fg-muted">{label}</label>
        {aside}
      </div>
      {children}
      {error ? <p className="text-xs text-danger" role="alert">{error}</p> : hint ? <p className="text-xs text-fg-faint">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" className={cn("size-3.5 cursor-pointer rounded-[3px] accent-[var(--text)]", className)} {...props} />;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-line-strong transition-colors disabled:opacity-50",
        checked ? "bg-accent" : "bg-active")}
    >
      <span className={cn("size-3 rounded-full transition-transform", checked ? "translate-x-[15px] bg-accent-fg" : "translate-x-[2px] bg-fg-muted")} />
    </button>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line px-1 font-mono text-[10px] text-fg-muted">{children}</kbd>;
}
