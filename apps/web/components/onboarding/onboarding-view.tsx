"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight, Loader2, Upload, Car, Scissors, Stethoscope, Smile, Wrench, Hospital } from "lucide-react";
import { Button, Field, Input, Pill, cn, toast } from "@all/ui";
import { BLOCKS, completeness, missingRequired, type FieldValues } from "@all/dialog";
import { setField, runQuestionCheck, setAiMode } from "@/lib/actions";
import { FieldEditor } from "../knowledge/field-editor";
import { TestCall } from "../assistant/test-call";

const SPHERES = [
  { key: "autoservice", icon: Car }, { key: "salon", icon: Scissors }, { key: "clinic", icon: Stethoscope },
  { key: "dental", icon: Smile }, { key: "service", icon: Wrench }, { key: "polyclinic", icon: Hospital },
] as const;

/** Поля шага: блоки анкеты, которые заполняются на этом шаге */
const STEP_FIELDS: Record<number, string[]> = {
  3: BLOCKS.find((b) => b.id === 1)!.fields.map((f) => f.key).filter((k) => k !== "company.sphere"),
  4: BLOCKS.find((b) => b.id === 2)!.fields.map((f) => f.key),
  6: [...BLOCKS.find((b) => b.id === 5)!.fields.slice(0, 3), ...BLOCKS.find((b) => b.id === 10)!.fields.slice(0, 3), ...BLOCKS.find((b) => b.id === 11)!.fields.slice(0, 4)].map((f) => f.key),
  7: ["style.assistant_name", "style.greeting", "style.tone"],
};
const ALL_FIELDS = BLOCKS.flatMap((b) => b.fields);

export function OnboardingView({ step, fields: initial, counts, greeting }: { step: number; fields: FieldValues; counts: { services: number; staff: number; faq: number }; greeting: string }) {
  const t = useTranslations("onboarding");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const router = useRouter();
  const [fields, setFields] = React.useState(initial);
  const steps = t.raw("steps") as string[];
  const index = completeness(fields, counts);
  const missing = missingRequired(fields, counts);

  const update = (k: string, v: unknown) => {
    setFields((f) => ({ ...f, [k]: v }));
    void setField(k, v === "" ? null : v); // черновик сохраняется на каждом поле
  };
  const stepRequired = (STEP_FIELDS[step] ?? []).filter((k) => ALL_FIELDS.find((f) => f.key === k)?.level === "required");
  const canNext = step === 1 ? !!fields["company.sphere"] : stepRequired.every((k) => { const v = fields[k]; return v != null && v !== "" && !(typeof v === "object" && !Object.keys(v as object).length); });
  const skipped = (STEP_FIELDS[step] ?? []).filter((k) => ALL_FIELDS.find((f) => f.key === k)?.level !== "required" && !fields[k]);

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-app lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_380px]">
      <aside className="flex flex-col border-r border-line max-lg:hidden">
        <div className="flex h-11 items-center gap-2 border-b border-line px-3 text-[13px] font-medium">
          <span className="flex size-6 items-center justify-center rounded-[6px] bg-accent font-display text-[11px] font-semibold text-accent-fg">A</span>{t("title")}
        </div>
        <div className="border-b border-line px-3 py-3">
          <div className="flex items-baseline justify-between"><span className="text-xs text-fg-muted">Индекс анкеты</span><span className="font-display text-xl tabular-nums">{index}%</span></div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-active"><div className="h-full rounded-full bg-fg" style={{ width: `${index}%` }} /></div>
        </div>
        <ol className="flex-1 p-1.5">
          {steps.map((s, i) => {
            const n = i + 1;
            const done = n < step;
            return (
              <li key={s}><Link href={`/onboarding/${n}`} className={cn("flex h-8 items-center gap-2 rounded-[8px] px-2 text-[13px]", n === step ? "bg-active text-fg" : "text-fg-muted hover:bg-hover")}>
                <span className={cn("flex size-4 items-center justify-center rounded-full border text-[9px] tabular-nums", done ? "border-fg bg-fg text-bg" : "border-line-strong")}>{done ? <Check className="size-2.5" /> : n}</span>{s}
              </Link></li>
            );
          })}
        </ol>
        <Link href="/app" className="border-t border-line px-3 py-2.5 text-xs text-fg-muted hover:text-fg">{t("exit")}</Link>
      </aside>

      <main className="flex min-h-0 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
          <span className="text-xs tabular-nums text-fg-faint">{step} / {steps.length}</span>
          <h1 className="font-display text-base font-semibold tracking-[-0.01em]">{steps[step - 1]}</h1>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 xl:px-8">
          {step === 1 && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {SPHERES.map(({ key, icon: Icon }) => (
                <button key={key} onClick={() => update("company.sphere", key)} className={cn("flex h-24 flex-col items-start justify-between rounded-[12px] border p-3 text-left", fields["company.sphere"] === key ? "border-fg-muted bg-active" : "border-line hover:border-line-strong")}>
                  <Icon className="size-5 text-fg-secondary" /><span className="text-[13px] font-medium">{t(`spheres.${key}`)}</span>
                </button>
              ))}
            </div>
          )}
          {step === 2 && <Autofill onAccept={(k, v) => update(k, v)} />}
          {STEP_FIELDS[step] && (
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
              {STEP_FIELDS[step]!.map((k) => {
                const def = ALL_FIELDS.find((f) => f.key === k)!;
                return <FieldEditor key={k} def={def} value={fields[k]} onChange={(v) => update(k, v)} disabled={false} levelLabel={te(`level.${def.level}`)} levelFull={te(`levelFull.${def.level}`)} />;
              })}
            </div>
          )}
          {step === 5 && (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-fg-muted">Блок 3 анкеты — табличный редактор: вставьте прайс из Excel целиком.</p>
              <p className="text-[13px]">Сейчас услуг: <span className="tabular-nums">{counts.services}</span></p>
              <Link href="/app/knowledge/services" className="inline-flex h-8 w-fit items-center rounded-full bg-accent px-3 text-[13px] font-medium text-accent-fg">Открыть редактор услуг</Link>
            </div>
          )}
          {step === 8 && <CheckStep index={index} missing={missing} />}
          {step === 9 && <NumberStep />}
          {step === 10 && (
            <div className="flex max-w-xl flex-col gap-3">
              <p className="text-[13px] text-fg-muted">{t("moderationEta")}</p>
              {missing.length > 0 && <p className="text-xs text-warning">Не заполнено обязательных полей: {missing.length}</p>}
              <Button variant="primary" className="w-fit" disabled={missing.length > 0} onClick={() => { toast.success(t("sent")); router.push("/app"); }}>{t("moderation")}</Button>
            </div>
          )}
          {skipped.length > 0 && <p className="mt-4 text-xs text-fg-faint">{t("fill")}: {skipped.map((k) => ALL_FIELDS.find((f) => f.key === k)?.label).join(", ")}</p>}
        </div>
        <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-line px-4">
          {step > 1 && <Link href={`/onboarding/${step - 1}`} className="inline-flex h-8 items-center gap-1 rounded-full border border-line-strong px-3 text-[13px] hover:bg-hover"><ChevronLeft className="size-4" />{tc("back")}</Link>}
          {!canNext && <span className="text-xs text-fg-muted">{t("required")}</span>}
          {step < steps.length && (
            <Link href={canNext ? `/onboarding/${step + 1}` : "#"} aria-disabled={!canNext} onClick={(e) => !canNext && e.preventDefault()}
              className={cn("ml-auto inline-flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-[13px] font-medium text-accent-fg", !canNext && "pointer-events-none opacity-50")}>{tc("next")}<ChevronRight className="size-4" /></Link>
          )}
        </footer>
      </main>

      <aside className="flex min-h-0 flex-col border-l border-line max-xl:hidden">
        <div className="flex h-11 shrink-0 items-center border-b border-line px-3 text-[13px] font-medium">{t("checkNow")}</div>
        {step >= 3 ? <TestCall greeting={String(fields["style.greeting"] ?? greeting)} /> : <p className="p-4 text-xs text-fg-muted">{t("testFromStep")}</p>}
      </aside>
    </div>
  );
}

/** Автозаполнение: ссылки и прайс → прогресс разбора → найденное с источником и галочками «Принять» */
function Autofill({ onAccept }: { onAccept: (k: string, v: string) => void }) {
  const t = useTranslations("onboarding");
  const [links, setLinks] = React.useState("https://motor.kg\nhttps://2gis.kg/bishkek/firm/motor");
  const [phase, setPhase] = React.useState<"idle" | "parsing" | "done">("idle");
  const [progress, setProgress] = React.useState(0);
  const found = [
    { key: "company.description", label: "Описание", value: "Ремонт и обслуживание японских и корейских автомобилей с 2012 года.", source: "сайт" },
    { key: "branch.address", label: "Адрес", value: "ул. Ахунбаева, 119", source: "2ГИС" },
    { key: "branch.landmarks", label: "Ориентиры", value: "за АЗС «Газпром»", source: "2ГИС" },
    { key: "branch.phones", label: "Телефон", value: "+996555123456", source: "2ГИС" },
    { key: "payment.methods", label: "Способы оплаты", value: "Наличные\nКарта\nQR MBank", source: "сайт" },
  ];
  const [accepted, setAccepted] = React.useState<Set<string>>(new Set(found.map((f) => f.key)));
  const run = () => {
    setPhase("parsing"); setProgress(0);
    const id = setInterval(() => setProgress((p) => { if (p >= 100) { clearInterval(id); setPhase("done"); return 100; } return p + 10; }), 180);
  };
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Field label={t("autofillLinks")}><textarea value={links} onChange={(e) => setLinks(e.target.value)} rows={3} className="rounded-[10px] border border-line bg-bg px-2.5 py-1.5 text-[13px] focus:border-fg-muted focus:outline-none" /></Field>
      <label className="flex h-16 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-strong text-[13px] text-fg-muted hover:bg-hover"><Upload className="size-4" />{t("autofillPrice")}<input type="file" className="sr-only" accept=".xlsx,.csv,.pdf,image/*" /></label>
      <Button variant="primary" className="w-fit" onClick={run} loading={phase === "parsing"}>{t("autofillRun")}</Button>
      {phase === "parsing" && <div className="flex items-center gap-2 text-xs text-fg-muted"><Loader2 className="size-3.5 animate-spin" />{t("parsing")} {progress}%</div>}
      {phase === "done" && (
        <div className="rounded-[10px] border border-line">
          <div className="flex h-9 items-center justify-between border-b border-line px-3 text-xs text-fg-muted"><span>{t("autofillFound")}: {found.length}</span>
            <Button size="sm" variant="primary" onClick={() => { found.filter((f) => accepted.has(f.key)).forEach((f) => onAccept(f.key, f.value)); toast.success(`Принято: ${accepted.size}`); }}>{t("accept")}</Button>
          </div>
          <ul>{found.map((f) => (
            <li key={f.key} className="flex items-start gap-2.5 border-b border-line px-3 py-2 last:border-b-0">
              <input type="checkbox" className="mt-1 accent-[var(--text)]" checked={accepted.has(f.key)} onChange={() => setAccepted((s) => { const n = new Set(s); if (n.has(f.key)) n.delete(f.key); else n.add(f.key); return n; })} aria-label={f.label} />
              <span className="min-w-0 flex-1"><span className="block text-xs text-fg-muted">{f.label}</span><span className="block whitespace-pre-line text-[13px]">{f.value}</span></span>
              <Pill>{f.source}</Pill>
            </li>
          ))}</ul>
        </div>
      )}
    </div>
  );
}

function CheckStep({ index, missing }: { index: number; missing: ReturnType<typeof missingRequired> }) {
  const [res, setRes] = React.useState<{ question: string; cannot: boolean; field: string }[]>();
  const [pending, start] = React.useTransition();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3"><span className="font-display text-4xl font-medium tabular-nums tracking-[-0.035em]">{index}%</span><span className="text-xs text-fg-muted">индекс полноты</span></div>
      <Button variant="primary" className="w-fit" loading={pending} onClick={() => start(async () => { const r = await runQuestionCheck(); if (r.ok) setRes(r.data); })}>Проверить 30 вопросами</Button>
      {res && <p className="text-[13px]">AI отвечает на {res.filter((r) => !r.cannot).length} из {res.length}</p>}
      <ul className="flex flex-col">
        {[...missing.map((m) => ({ label: m.label, href: `/app/knowledge?block=${m.block}` })), ...(res ?? []).filter((r) => r.cannot).map((r) => ({ label: `Нет ответа: ${r.question}`, href: r.field === "faq" ? "/app/knowledge/faq" : "/app/knowledge" }))].map((x) => (
          <li key={x.label}><Link href={x.href} className="flex h-8 items-center gap-2 border-b border-line text-[13px] hover:bg-hover"><span className="size-1.5 rounded-full bg-warning" />{x.label}</Link></li>
        ))}
      </ul>
    </div>
  );
}

function NumberStep() {
  const t = useTranslations("onboarding");
  const ta = useTranslations("ai");
  const [kind, setKind] = React.useState<"forward" | "platform">("forward");
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-xs text-fg-muted">{t("forwardTitle")}</p>
      <div className="grid grid-cols-2 gap-2">
        {(["forward", "platform"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={cn("rounded-[12px] border p-3 text-left text-[13px]", kind === k ? "border-fg-muted bg-active" : "border-line")}>{k === "forward" ? t("forward") : t("platformNumber")}</button>
        ))}
      </div>
      {kind === "forward" ? (
        <ul className="flex flex-col gap-1.5 font-mono text-xs">
          <li className="rounded-[10px] bg-subtle px-3 py-2">MegaCom: **61*0312900100*11*15#</li>
          <li className="rounded-[10px] bg-subtle px-3 py-2">O!: **61*0312900100**15#</li>
          <li className="rounded-[10px] bg-subtle px-3 py-2">Beeline: **61*0312900100**15#</li>
        </ul>
      ) : <p className="text-[13px]">Вам будет выделен номер +996 312 900 2XX после модерации.</p>}
      <Field label="Режим приёма AI">
        <div className="flex gap-1.5">{(["on", "leads_only"] as const).map((m) => <Button key={m} size="sm" onClick={async () => { await setAiMode(m); toast(ta(m)); }}>{ta(m)}</Button>)}</div>
      </Field>
      <Input readOnly value="Тестовый звонок на номер станет доступен после модерации" className="text-fg-muted" />
    </div>
  );
}
