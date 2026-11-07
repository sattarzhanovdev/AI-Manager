"use client";
import * as React from "react";
import { Dialog, DropdownMenu, Popover as RPopover, Tabs as RTabs } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "./cn";

/** Боковая панель 480–640px для создания и редактирования; футер закреплён */
export function Sheet({
  open, onOpenChange, title, description, children, footer, width = 520,
}: { open: boolean; onOpenChange: (v: boolean) => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex max-w-full flex-col border-l border-line bg-elevated shadow-[var(--shadow-pop)] focus:outline-none"
          style={{ width }}
        >
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-sm font-medium text-fg">{title}</Dialog.Title>
              {description ? <Dialog.Description className="truncate text-xs text-fg-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{String(title)}</Dialog.Description>}
            </div>
            <Dialog.Close className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg" aria-label="Закрыть">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Подтверждение опасного действия — единственный случай модалки */
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel, cancelLabel = "Отмена", onConfirm, danger, children,
}: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; confirmLabel: string; cancelLabel?: string; onConfirm: () => void; danger?: boolean; children?: React.ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-panel)] border border-line bg-elevated p-4 shadow-[var(--shadow-pop)]">
          <Dialog.Title className="text-sm font-medium text-fg">{title}</Dialog.Title>
          {description && <Dialog.Description className="mt-1 text-[13px] text-fg-muted">{description}</Dialog.Description>}
          {children && <div className="mt-3">{children}</div>}
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close className="h-8 rounded-full border border-line-strong px-3 text-[13px] hover:bg-hover">{cancelLabel}</Dialog.Close>
            <button
              onClick={() => { onConfirm(); onOpenChange(false); }}
              className={cn("h-8 rounded-full px-3 text-[13px] font-medium", danger ? "bg-danger text-white" : "bg-accent text-accent-fg")}
            >{confirmLabel}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export function MenuContent({ children, align = "end" }: { children: React.ReactNode; align?: "start" | "end" | "center" }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content align={align} sideOffset={4} className="z-50 min-w-44 rounded-[var(--radius-ui)] bg-elevated p-1 shadow-[var(--shadow-pop)]">
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}
export function MenuItem({ children, onSelect, danger, icon, shortcut }: { children: React.ReactNode; onSelect?: () => void; danger?: boolean; icon?: React.ReactNode; shortcut?: string }) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn("flex h-7 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[highlighted]:bg-hover [&_svg]:size-3.5",
        danger ? "text-danger" : "text-fg")}
    >
      {icon}<span className="flex-1">{children}</span>{shortcut && <span className="text-xs text-fg-faint">{shortcut}</span>}
    </DropdownMenu.Item>
  );
}
export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-line" />;
}
export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <DropdownMenu.Label className="px-2 py-1 text-xs text-fg-faint">{children}</DropdownMenu.Label>;
}

export const Popover = RPopover.Root;
export const PopoverTrigger = RPopover.Trigger;
export function PopoverContent({ children, className, align = "start" }: { children: React.ReactNode; className?: string; align?: "start" | "end" | "center" }) {
  return (
    <RPopover.Portal>
      <RPopover.Content align={align} sideOffset={4} className={cn("z-50 rounded-[var(--radius-ui)] bg-elevated p-2 shadow-[var(--shadow-pop)] focus:outline-none", className)}>
        {children}
      </RPopover.Content>
    </RPopover.Portal>
  );
}

export function Tabs({ value, onValueChange, items, className }: { value: string; onValueChange: (v: string) => void; items: { value: string; label: React.ReactNode; count?: number }[]; className?: string }) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange}>
      <RTabs.List className={cn("flex h-8 items-center gap-0.5", className)}>
        {items.map((it) => (
          <RTabs.Trigger key={it.value} value={it.value}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[13px] text-fg-muted hover:text-fg data-[state=active]:bg-active data-[state=active]:text-fg">
            {it.label}
            {it.count != null && <span className="tabular-nums text-xs text-fg-faint">{it.count}</span>}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
    </RTabs.Root>
  );
}

/** Сегментированный переключатель: Таблица / Канбан, День / Неделя */
export function Segmented<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode; icon?: React.ReactNode }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center gap-0.5 rounded-full border border-line p-0.5">
      {items.map((it) => (
        <button key={it.value} type="button" role="radio" aria-checked={value === it.value} onClick={() => onChange(it.value)}
          className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs [&_svg]:size-3.5",
            value === it.value ? "bg-active text-fg" : "text-fg-muted hover:text-fg")}>
          {it.icon}{it.label}
        </button>
      ))}
    </div>
  );
}
