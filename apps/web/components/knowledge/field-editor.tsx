"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { Input, Select, Textarea, Tooltip, cn } from "@all/ui";
import type { FieldDef } from "@all/dialog";
import type { Weekday } from "@all/db";

/** Поле анкеты: подпись, уровень О/Р/Д, источник автозаполнения, подсказка «Что указать» и пример */
export function FieldEditor({ def, value, source, onChange, disabled, levelLabel, levelFull, highlight }: { def: FieldDef; value: unknown; source?: string; onChange: (v: unknown) => void; disabled: boolean; levelLabel: string; levelFull: string; highlight?: boolean }) {
  const t = useTranslations("knowledge");
  const id = `f-${def.key}`;
  const wide = def.kind === "textarea" || def.kind === "hours" || def.kind === "list";
  const empty = value == null || value === "" || (typeof value === "object" && Object.keys(value as object).length === 0);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", wide && "md:col-span-2", highlight && "rounded-[10px] ring-1 ring-fg-muted ring-offset-4 ring-offset-[var(--bg-app)]")}>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-xs text-fg-secondary">{def.label}</label>
        <Tooltip content={levelFull}>
          <span className={cn("rounded px-1 text-[10px] font-medium", def.level === "required" ? (empty ? "bg-warning-bg text-warning" : "bg-active text-fg-secondary") : "text-fg-faint")}>{levelLabel}</span>
        </Tooltip>
        {source && source !== "manual" && <span className="text-[10px] text-fg-faint">{t("source", { source: t(`sources.${source}` as "sources.manual") })}</span>}
      </div>
      {def.kind === "text" && <Input id={id} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={def.example} />}
      {def.kind === "phones" && <Input id={id} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={def.example} />}
      {(def.kind === "textarea" || def.kind === "list") && (
        <Textarea id={id} disabled={disabled} rows={def.kind === "list" ? 3 : 3} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={def.kind === "list" ? `${t("listPh")}${def.example ? `\n${def.example}` : ""}` : def.example} />
      )}
      {def.kind === "select" && (
        <Select id={id} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {def.options?.map((o) => <option key={o} value={o}>{OPTION_LABEL[o] ?? o}</option>)}
        </Select>
      )}
      {def.kind === "hours" && <HoursEditor id={id} value={(value as Record<Weekday, [string, string][]>) ?? {}} onChange={onChange} disabled={disabled} />}
      <p className="text-xs leading-4 text-fg-faint">{def.hint}{def.example && def.kind !== "list" ? <> · {t("example")}: <span className="text-fg-muted">{def.example}</span></> : null}</p>
    </div>
  );
}

const OPTION_LABEL: Record<string, string> = {
  autoservice: "Автосервис", salon: "Салон красоты", clinic: "Клиника", dental: "Стоматология", service: "Сервисная компания", polyclinic: "Поликлиника",
  transfer: "Перевести звонок", callback: "Заявка на перезвон", vy: "На «вы»", name: "По имени", friendly: "Дружелюбный", business: "Деловой", warm: "Тёплый",
};

const DAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export function HoursEditor({ id, value, onChange, disabled }: { id: string; value: Partial<Record<Weekday, [string, string][]>>; onChange: (v: unknown) => void; disabled: boolean }) {
  const te = useTranslations("enums.weekday");
  const t = useTranslations("knowledge");
  const set = (d: Weekday, ranges: [string, string][]) => onChange({ ...value, [d]: ranges });
  return (
    <div id={id} tabIndex={-1} className="grid grid-cols-1 overflow-hidden rounded-[10px] border border-line sm:grid-cols-7">
      {DAYS.map((d) => {
        const ranges = value[d] ?? [];
        const closed = ranges.length === 0;
        return (
          <div key={d} className="flex flex-col gap-1 border-line p-2 max-sm:border-b sm:border-r sm:last:border-r-0">
            <div className="flex items-center justify-between text-xs"><span className="font-medium">{te(d)}</span>
              <button disabled={disabled} onClick={() => set(d, closed ? [["09:00", "18:00"]] : [])} className="text-[10px] text-fg-faint hover:text-fg">{closed ? "+" : "×"}</button>
            </div>
            {closed ? <span className="text-xs text-fg-faint">{t("hoursClosed")}</span> : ranges.map((r, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                <input type="time" disabled={disabled} value={r[0]} onChange={(e) => set(d, ranges.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} className="h-6 rounded border border-line bg-bg px-1 text-xs tabular-nums" aria-label={`${te(d)} с`} />
                <input type="time" disabled={disabled} value={r[1]} onChange={(e) => set(d, ranges.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} className="h-6 rounded border border-line bg-bg px-1 text-xs tabular-nums" aria-label={`${te(d)} до`} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

