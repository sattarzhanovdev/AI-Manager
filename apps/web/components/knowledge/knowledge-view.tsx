"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, ChevronRight, GitCompare, History, Loader2, Upload, HelpCircle, Table2 } from "lucide-react";
import {
  Button, ConfirmDialog, Field, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Pill, Select, Sheet, Textarea, Tooltip, cn, toast,
} from "@all/ui";
import { BLOCKS, blockProgress, completeness, missingRequired, type BlockDef, type FieldDef, type FieldValues } from "@all/dialog";
import type { Faq, Service, UnansweredQuestion, Weekday } from "@all/db";
import { answerUnanswered, publishQuestionnaire, rollbackQuestionnaire, setField } from "@/lib/actions";
import type { QuestionnaireState } from "@/lib/data/types";
import { relativeTime } from "@/lib/format";
import { AiPreview } from "./ai-preview";
import { FieldEditor } from "./field-editor";

type BlockKey = number | "unanswered";

export function KnowledgeView({ q, canEdit, canPublish, initialBlock, unansweredId }: { q: QuestionnaireState; canEdit: boolean; canPublish: boolean; initialBlock?: number; unansweredId?: string }) {
  const t = useTranslations("knowledge");
  const tc = useTranslations("common");
  const router = useRouter();
  const [fields, setFields] = React.useState<FieldValues>(q.fields);
  const [block, setBlock] = React.useState<BlockKey>(unansweredId ? "unanswered" : initialBlock ?? 1);
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved">("idle");
  const [changed, setChanged] = React.useState(new Set(q.changedSincePublish));
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [rollbackTo, setRollbackTo] = React.useState<number | null>(null);
  const [diffOpen, setDiffOpen] = React.useState(false);
  const [unanswered, setUnanswered] = React.useState(q.unanswered);
  const [focusKey, setFocusKey] = React.useState<string>();
  React.useEffect(() => { setFields(q.fields); setChanged(new Set(q.changedSincePublish)); setUnanswered(q.unanswered); }, [q]);

  const counts = { services: q.services.filter((s) => s.active).length, staff: q.staff.length, faq: q.faq.filter((f) => f.active).length };
  // Индекс полноты обновляется сразу при вводе
  const index = completeness(fields, counts);
  const missing = missingRequired(fields, counts);
  const contradictions = React.useMemo(() => findContradictions(q.services, q.faq), [q.services, q.faq]);
  const visibleBlocks = BLOCKS;

  // Автосохранение черновика на каждом поле (с задержкой 600 мс)
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const update = (key: string, value: unknown) => {
    setFields((f) => ({ ...f, [key]: value }));
    setChanged((s) => new Set(s).add(key));
    setSaving("saving");
    const prev = timers.current.get(key);
    if (prev) clearTimeout(prev);
    timers.current.set(key, setTimeout(async () => {
      const r = await setField(key, value === "" ? null : value);
      if (!r.ok) { toast.error(r.error); setSaving("idle"); return; }
      setSaving("saved");
    }, 600));
  };

  const goToField = (b: number, key?: string) => { setBlock(b); setFocusKey(key); };
  const current = typeof block === "number" ? BLOCKS.find((b) => b.id === block)! : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Липкая полоса: статус, изменения, сравнить, опубликовать, откатить */}
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5">
        <h1 className="font-display text-base font-semibold tracking-[-0.01em]">{t("title")}</h1>
        <Pill tone="neutral">{t("draft", { version: q.draft.version })}</Pill>
        {q.published && <Pill tone="success">{t("published", { version: q.published.version })}</Pill>}
        <span className="text-xs text-fg-muted">{changed.size ? t("changes", { count: changed.size }) : t("noChanges")}</span>
        <span className="flex items-center gap-1 text-xs text-fg-faint" aria-live="polite">
          {saving === "saving" && <><Loader2 className="size-3 animate-spin" />{tc("saving")}</>}
          {saving === "saved" && <><Check className="size-3" />{tc("saved")}</>}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={<GitCompare />} onClick={() => setDiffOpen(true)} disabled={!changed.size}>{t("compare")}</Button>
          <Menu>
            <MenuTrigger disabled={!canPublish} className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs text-fg-secondary hover:bg-hover disabled:opacity-50"><History className="size-3.5" />{t("rollback")}</MenuTrigger>
            <MenuContent>
              <MenuLabel>{t("versions")}</MenuLabel>
              {q.versions.map((v) => (
                <MenuItem key={v.version} onSelect={() => v.status !== "published" && setRollbackTo(v.version)}>
                  v{v.version} · {v.publishedAt ? relativeTime(v.publishedAt) : ""} {v.status === "published" ? "· текущая" : ""}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          <Tooltip content={canPublish ? (missing.length ? `${missing.length} обязательных не заполнено` : "") : "Публикует собственник"}>
            <span><Button size="sm" variant="primary" icon={<Upload />} disabled={!canPublish} onClick={() => setPublishOpen(true)}>{t("publish")}</Button></span>
          </Tooltip>
        </div>
      </div>
      {index < 50 && <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-warning-bg px-3 text-xs text-warning"><AlertTriangle className="size-3.5" />{t("aiOnlyLeads")}</div>}
      {!canEdit && <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-neutral px-3 text-xs text-fg-muted">{t("noRightsEdit")}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_360px]">
        {/* Слева: блоки с прогрессом, индекс, вопросы без ответа */}
        <nav aria-label={t("blocks")} className="flex min-h-0 flex-col border-r border-line max-lg:hidden">
          <div className="border-b border-line px-3 py-3">
            <div className="flex items-baseline justify-between"><span className="text-xs text-fg-muted">{t("index")}</span><span className="font-display text-2xl font-medium tabular-nums tracking-[-0.03em]">{index}%</span></div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-active"><div className={cn("h-full rounded-full", index < 50 ? "bg-warning" : "bg-fg")} style={{ width: `${index}%` }} /></div>
          </div>
          <button onClick={() => setBlock("unanswered")} className={cn("flex h-9 items-center gap-2 border-b border-line px-3 text-[13px]", block === "unanswered" ? "bg-active" : "hover:bg-hover")}>
            <HelpCircle className="size-4 text-fg-muted" /><span className="flex-1 text-left">{t("unanswered")}</span>
            {unanswered.length > 0 && <span className="rounded-full bg-warning-bg px-1.5 text-[11px] tabular-nums text-warning">{unanswered.length}</span>}
          </button>
          <ol className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {visibleBlocks.map((b) => {
              const p = blockProgress(b, fields, counts);
              const needs = missing.some((m) => m.block === b.id);
              return (
                <li key={b.id}>
                  <button onClick={() => setBlock(b.id)} className={cn("flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-[13px]", block === b.id ? "bg-active text-fg" : "text-fg-secondary hover:bg-hover", !b.phase1a && "opacity-60")}>
                    <span className="w-4 text-right text-[11px] tabular-nums text-fg-faint">{b.id}</span>
                    <span className="flex-1 truncate text-left">{b.title}</span>
                    {needs && <span className="size-1.5 rounded-full bg-warning" aria-label="Есть незаполненные обязательные" />}
                    <Ring value={p} />
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Центр: форма блока */}
        <div className="min-h-0 overflow-y-auto">
          <div className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-line bg-app/95 px-4 backdrop-blur lg:hidden">
            <Select value={String(block)} onChange={(e) => setBlock(e.target.value === "unanswered" ? "unanswered" : Number(e.target.value))} className="w-full">
              <option value="unanswered">{t("unanswered")} ({unanswered.length})</option>
              {BLOCKS.map((b) => <option key={b.id} value={b.id}>{b.id}. {b.title}</option>)}
            </Select>
          </div>
          {block === "unanswered" ? (
            <UnansweredList items={unanswered} canEdit={canEdit} highlight={unansweredId} onAnswered={(id) => { setUnanswered((l) => l.filter((x) => x.id !== id)); router.refresh(); }} />
          ) : current ? (
            <BlockForm block={current} fields={fields} sources={q.fieldSources} onChange={update} canEdit={canEdit} counts={counts} focusKey={focusKey} q={q}
              contradictions={current.table === "faq" || current.table === "services" ? contradictions : []} />
          ) : null}
        </div>

        {/* Справа: как ответит AI */}
        <aside className="flex min-h-0 flex-col border-l border-line max-xl:hidden">
          <AiPreview onGoToField={(f) => {
            const b = BLOCKS.find((x) => x.fields.some((y) => y.key === f) || x.table === f || x.key === f.split(".")[0]);
            if (b) goToField(b.id, f);
          }} />
        </aside>
      </div>

      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} version={q.draft.version} missing={missing} onGo={(m) => { setPublishOpen(false); goToField(m.block, m.key); }}
        onPublished={() => { setChanged(new Set()); router.refresh(); }} />
      <ConfirmDialog open={rollbackTo != null} onOpenChange={(v) => !v && setRollbackTo(null)} title={t("rollbackTitle", { version: rollbackTo ?? 0 })} description={t("rollbackDesc", { version: rollbackTo ?? 0 })}
        confirmLabel={t("rollback")} cancelLabel={tc("cancel")}
        onConfirm={async () => { const r = await rollbackQuestionnaire(rollbackTo!); if (r.ok) { toast.success(t("rolledBack", { version: r.data! })); router.refresh(); } else toast.error(r.error); }} />
      <DiffSheet open={diffOpen} onOpenChange={setDiffOpen} keys={[...changed]} fields={fields} publishedVersion={q.published?.version ?? 0} />
    </div>
  );
}

function Ring({ value }: { value: number }) {
  const r = 6, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0 -rotate-90" aria-label={`${Math.round(value * 100)}%`}>
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--bg-active)" strokeWidth="2" />
      <circle cx="8" cy="8" r={r} fill="none" stroke={value >= 1 ? "var(--success)" : "var(--text-secondary)"} strokeWidth="2" strokeDasharray={c} strokeDashoffset={c * (1 - value)} strokeLinecap="round" />
    </svg>
  );
}

function BlockForm({ block, fields, sources, onChange, canEdit, counts, focusKey, q, contradictions }: {
  block: BlockDef; fields: FieldValues; sources: Record<string, string>; onChange: (k: string, v: unknown) => void; canEdit: boolean;
  counts: { services: number; staff: number; faq: number }; focusKey?: string; q: QuestionnaireState; contradictions: string[];
}) {
  const t = useTranslations("knowledge");
  const te = useTranslations("enums");
  React.useEffect(() => {
    if (!focusKey) return;
    const el = document.getElementById(`f-${focusKey}`);
    el?.scrollIntoView({ block: "center" });
    (el as HTMLElement | null)?.focus?.();
  }, [focusKey, block.id]);

  return (
    <div className="flex flex-col gap-4 px-4 py-3 xl:px-6">
      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-lg font-medium tracking-[-0.02em]">{block.id}. {block.title}</h2>
        <span className="text-xs text-fg-faint">вес {block.weight}%</span>
        {!block.phase1a && <Pill tone="neutral">полное MVP</Pill>}
      </div>
      {contradictions.length > 0 && (
        <div className="rounded-[10px] border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning">
          <div className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle className="size-3.5" />{t("contradictions")}</div>
          {contradictions.map((c) => <p key={c}>{c}</p>)}
        </div>
      )}
      {block.table ? (
        <TableBlockSummary table={block.table} count={counts[block.table]} q={q} />
      ) : (
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
          {block.fields.map((f) => (
            <FieldEditor key={f.key} def={f} value={fields[f.key]} source={sources[f.key]} onChange={(v) => onChange(f.key, v)} disabled={!canEdit} levelLabel={te(`level.${f.level}`)} levelFull={te(`levelFull.${f.level}`)} highlight={focusKey === f.key} />
          ))}
        </div>
      )}
    </div>
  );
}

function TableBlockSummary({ table, count, q }: { table: "services" | "staff" | "faq"; count: number; q: QuestionnaireState }) {
  const t = useTranslations("knowledge");
  const tk = useTranslations("kbTables");
  const rows: string[] =
    table === "services" ? q.services.slice(0, 8).map((s) => s.name) :
    table === "staff" ? q.staff.slice(0, 8).map((s) => `${s.name} — ${s.specialties.join(", ")}`) :
    q.faq.slice(0, 8).map((f) => f.question);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-fg-muted">{t("tableBlockHint")}</p>
      <div className="rounded-[10px] border border-line">
        <div className="flex h-9 items-center justify-between border-b border-line px-3 text-xs text-fg-muted"><span>{tk(table)}</span><span className="tabular-nums">{t("rowsCount", { count })}</span></div>
        <ul>{rows.map((r) => <li key={r} className="flex h-8 items-center border-b border-line px-3 text-[13px] last:border-b-0"><span className="truncate">{r}</span></li>)}</ul>
      </div>
      <Link href={`/app/knowledge/${table}`} className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full bg-accent px-3 text-[13px] font-medium text-accent-fg"><Table2 className="size-4" />{t("openEditor")}<ChevronRight className="size-4" /></Link>
    </div>
  );
}

function UnansweredList({ items, canEdit, highlight, onAnswered }: { items: UnansweredQuestion[]; canEdit: boolean; highlight?: string; onAnswered: (id: string) => void }) {
  const t = useTranslations("knowledge");
  return (
    <div className="flex flex-col gap-3 px-4 py-3 xl:px-6">
      <h2 className="font-display text-lg font-medium tracking-[-0.02em]">{t("unanswered")}</h2>
      <p className="text-xs text-fg-muted">Вопросы из реальных звонков, на которые AI не нашёл ответа. Ответьте один раз — ответ попадёт в FAQ.</p>
      <ul className="rounded-[10px] border border-line">
        {items.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-fg-muted">Все вопросы закрыты</li>}
        {items.map((u) => <UnansweredRow key={u.id} u={u} canEdit={canEdit} open={u.id === highlight} onAnswered={onAnswered} />)}
      </ul>
    </div>
  );
}

function UnansweredRow({ u, canEdit, open: initialOpen, onAnswered }: { u: UnansweredQuestion; canEdit: boolean; open?: boolean; onAnswered: (id: string) => void }) {
  const t = useTranslations("knowledge");
  const [open, setOpen] = React.useState(!!initialOpen);
  const [answer, setAnswer] = React.useState("");
  const [pending, start] = React.useTransition();
  return (
    <li className="border-b border-line last:border-b-0">
      <div className="flex min-h-10 items-center gap-3 px-3">
        <span className="w-8 shrink-0 text-xs tabular-nums text-fg-muted">{t("times", { count: u.count })}</span>
        <span className="min-w-0 flex-1 text-[13px]">{u.text}</span>
        <span className="text-xs text-fg-faint">{relativeTime(u.lastSeenAt)}</span>
        <Button size="sm" disabled={!canEdit} onClick={() => setOpen((o) => !o)}>{t("answer")}</Button>
      </div>
      {open && (
        <form className="flex gap-2 px-3 pb-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await answerUnanswered(u.id, answer); if (r.ok) { toast.success(t("answered")); onAnswered(u.id); } else toast.error(r.error); }); }}>
          <Input autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={t("answerPh")} />
          <Button variant="primary" loading={pending} disabled={answer.trim().length < 2}>{t("answer")}</Button>
        </form>
      )}
    </li>
  );
}

function PublishDialog({ open, onOpenChange, version, missing, onGo, onPublished }: { open: boolean; onOpenChange: (v: boolean) => void; version: number; missing: ReturnType<typeof missingRequired>; onGo: (m: ReturnType<typeof missingRequired>[number]) => void; onPublished: () => void }) {
  const t = useTranslations("knowledge");
  const tc = useTranslations("common");
  if (missing.length) {
    // Публикация без обязательных полей невозможна, список недостающих кликабелен
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={t("missingTitle")} width={440}>
        <ul className="flex flex-col">
          {missing.map((m) => (
            <li key={m.key}><button onClick={() => onGo(m)} className="flex h-9 w-full items-center gap-2 border-b border-line text-left text-[13px] hover:bg-hover">
              <span className="w-6 text-xs tabular-nums text-fg-faint">{m.block}</span><span className="flex-1">{m.label}</span><ChevronRight className="size-4 text-fg-faint" />
            </button></li>
          ))}
        </ul>
      </Sheet>
    );
  }
  return (
    <ConfirmDialog open={open} onOpenChange={onOpenChange} title={t("publishTitle", { version })} description={t("publishDesc")} confirmLabel={t("publish")} cancelLabel={tc("cancel")}
      onConfirm={async () => { const r = await publishQuestionnaire(); if (r.ok) { toast.success(t("published_ok", { version: r.data! })); onPublished(); } else toast.error(r.error); }} />
  );
}

function DiffSheet({ open, onOpenChange, keys, fields, publishedVersion }: { open: boolean; onOpenChange: (v: boolean) => void; keys: string[]; fields: FieldValues; publishedVersion: number }) {
  const t = useTranslations("knowledge");
  const label = (k: string) => BLOCKS.flatMap((b) => b.fields).find((f) => f.key === k)?.label ?? k;
  const show = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "string" ? v : JSON.stringify(v));
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("diffTitle", { version: publishedVersion })} width={560}>
      <ul className="flex flex-col gap-3">
        {keys.map((k) => (
          <li key={k} className="rounded-[10px] border border-line p-2.5">
            <p className="mb-1.5 text-xs font-medium">{label(k)}</p>
            <p className="whitespace-pre-wrap text-[13px] text-success">+ {show(fields[k])}</p>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** Противоречия: цена в FAQ отличается от прайса */
function findContradictions(services: Service[], faq: Faq[]): string[] {
  const out: string[] = [];
  for (const f of faq) {
    const m = f.shortAnswer.match(/(\d[\d\s]*)\s*(сом|тенге|руб)/i);
    if (!m) continue;
    const amount = Number(m[1]!.replace(/\s/g, "")) * 100;
    const sv = services.find((s) => f.question.toLowerCase().includes(s.name.toLowerCase().split(" ")[0]!.slice(0, 5)));
    if (sv && sv.priceMin != null && amount !== sv.priceMin && amount !== sv.priceMax) out.push(`Цена «${sv.name}» в FAQ (${m[0]}) отличается от прайса`);
  }
  return out;
}
