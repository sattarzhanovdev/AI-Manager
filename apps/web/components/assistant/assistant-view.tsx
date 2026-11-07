"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Lock, Play, Plus, X } from "lucide-react";
import { Button, Field, Input, PageHeader, Select, Textarea, cn, toast } from "@all/ui";
import type { AssistantSettings, PhoneNumber } from "@/lib/data/types";
import type { Plan } from "@all/db";
import { updateAssistant, updateNumber } from "@/lib/actions";
import { formatPhone } from "@/lib/format";
import { TestCall } from "./test-call";

const VOICES = [
  { id: "aigul", name: "Айгуль", desc: "тёплый женский" }, { id: "dana", name: "Дана", desc: "деловой женский" },
  { id: "timur", name: "Тимур", desc: "спокойный мужской" }, { id: "ermek", name: "Эрмек", desc: "энергичный мужской" },
];

export function AssistantView({ settings, numbers, plan, members, canEdit, autoTest, engine }: {
  settings: AssistantSettings; numbers: PhoneNumber[]; plan: Plan; members: { userId: string; name: string }[]; canEdit: boolean; autoTest: boolean;
  engine: { llm: boolean; model?: string; mock: boolean };
}) {
  const t = useTranslations("assistant");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const router = useRouter();
  const [s, setS] = React.useState(settings);
  const [dirty, setDirty] = React.useState<Partial<AssistantSettings>>({});
  const [pending, start] = React.useTransition();
  const set = <K extends keyof AssistantSettings>(k: K, v: AssistantSettings[K]) => { setS((x) => ({ ...x, [k]: v })); setDirty((d) => ({ ...d, [k]: v })); };
  const disclosureOk = /виртуальн|ассистент|помощник|бот|AI|ИИ/i.test(s.greeting);

  const save = () => start(async () => {
    const r = await updateAssistant(dirty);
    if (!r.ok) { toast.error(r.error); return; }
    setDirty({}); toast(t("saved")); router.refresh();
  });
  const preview = (text: string) => {
    window.speechSynthesis?.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = "ru-RU"; u.rate = s.speed;
    window.speechSynthesis?.speak(u);
  };

  const section = "flex flex-col gap-3 border-b border-line px-4 py-4 xl:px-6";
  const h = "font-display text-[15px] font-medium tracking-[-0.01em]";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t("title")}>
        {Object.keys(dirty).length > 0 && <span className="text-xs text-fg-muted">{Object.keys(dirty).length} изменений</span>}
        <Button size="sm" variant="primary" loading={pending} disabled={!canEdit || !Object.keys(dirty).length || !disclosureOk} onClick={save}>{tc("save")}</Button>
      </PageHeader>
      <div className="grid min-h-0 flex-1 grid-cols-1 max-lg:overflow-y-auto lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-h-0 lg:overflow-y-auto">
          <fieldset disabled={!canEdit} className="contents">
            <section className={section}>
              <h2 className={h}>{t("voice")}</h2>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {VOICES.map((v) => (
                  <button key={v.id} type="button" onClick={() => set("voice", v.id)}
                    className={cn("flex items-center gap-2 rounded-[10px] border px-3 py-2 text-left", s.voice === v.id ? "border-fg-muted bg-active" : "border-line hover:border-line-strong")}>
                    <span className="min-w-0 flex-1"><span className="block text-[13px]">{v.name}</span><span className="block text-xs text-fg-muted">{v.desc}</span></span>
                    <span role="button" tabIndex={0} aria-label={t("voiceListen")} onClick={(e) => { e.stopPropagation(); preview(s.greeting); }} className="inline-flex size-6 items-center justify-center rounded-full border border-line hover:bg-hover"><Play className="size-3" /></span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label={`${t("speed")}: ${s.speed.toFixed(2)}×`}><input type="range" min={0.8} max={1.3} step={0.05} value={s.speed} onChange={(e) => set("speed", Number(e.target.value))} className="accent-[var(--text)]" /></Field>
              </div>
              <div>
                <p className="mb-1.5 text-xs text-fg-muted">{t("pronunciation")}</p>
                <div className="flex flex-col gap-1.5">
                  {s.pronunciation.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_28px] gap-2">
                      <Input value={p.word} placeholder={t("word")} onChange={(e) => set("pronunciation", s.pronunciation.map((x, j) => (j === i ? { ...x, word: e.target.value } : x)))} />
                      <Input value={p.say} placeholder={t("say")} onChange={(e) => set("pronunciation", s.pronunciation.map((x, j) => (j === i ? { ...x, say: e.target.value } : x)))} />
                      <button type="button" aria-label={tc("delete")} onClick={() => set("pronunciation", s.pronunciation.filter((_, j) => j !== i))} className="inline-flex size-8 items-center justify-center rounded-full text-fg-faint hover:bg-hover hover:text-fg"><X className="size-4" /></button>
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" icon={<Plus />} className="w-fit" onClick={() => set("pronunciation", [...s.pronunciation, { word: "", say: "" }])}>{tc("add")}</Button>
                </div>
              </div>
            </section>

            <section className={section}>
              <h2 className={h}>{t("intro")}</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label={t("name")}><Input value={s.name} onChange={(e) => set("name", e.target.value)} /></Field>
                <Field label={t("farewell")}><Input value={s.farewell} onChange={(e) => set("farewell", e.target.value)} /></Field>
                <Field label={t("greeting")} className="md:col-span-2" hint={t("greetingHint")} error={disclosureOk ? undefined : t("requiredDisclosure")}>
                  <Textarea rows={2} value={s.greeting} onChange={(e) => set("greeting", e.target.value)} aria-invalid={!disclosureOk} />
                </Field>
              </div>
            </section>

            <section className={section}>
              <h2 className={h}>{t("mode")}</h2>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {(["leads", "consult", "booking", "semi"] as const).map((m) => {
                  const inPlan = plan.modes.includes(m);
                  const laterPhase = m === "booking" || m === "semi";
                  const locked = !inPlan || laterPhase;
                  return (
                    <button key={m} type="button" disabled={locked} onClick={() => set("mode", m)}
                      className={cn("flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left disabled:cursor-not-allowed", s.mode === m ? "border-fg-muted bg-active" : "border-line enabled:hover:border-line-strong", locked && "opacity-60")}>
                      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", s.mode === m ? "border-fg bg-fg text-bg" : "border-line-strong")}>{s.mode === m && <Check className="size-3" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[13px]">{t(`modes.${m}`)}{locked && <Lock className="size-3 text-fg-faint" />}</span>
                        <span className="block text-xs text-fg-muted">{t(`modesHint.${m}`)}</span>
                        {/* Недоступные режимы — с пояснением и кнопкой «Сменить тариф» */}
                        {!inPlan && <Link href="/app/billing" className="mt-1 inline-block text-xs text-fg underline">{tc("unavailablePlan")} · {tc("changePlan")}</Link>}
                        {inPlan && laterPhase && <span className="mt-1 block text-xs text-fg-faint">{tc("comingPhase")}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {numbers.length > 0 && <section className={section}>
              <h2 className={h}>{t("schedule")}</h2>
              <p className="-mt-2 text-xs text-fg-muted">{t("scheduleHint")}</p>
              <ul className="rounded-[10px] border border-line">
                {numbers.map((n) => <NumberRow key={n.id} n={n} />)}
              </ul>
            </section>}

            <section className={section}>
              <h2 className={h}>{t("handoff")}</h2>
              <p className="-mt-1 rounded-[10px] bg-subtle px-3 py-2 text-xs text-fg-muted">{t("mandatoryRules")}</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label={t("handoffRules")} className="md:col-span-2"><Textarea rows={2} value={s.handoffRules} onChange={(e) => set("handoffRules", e.target.value)} /></Field>
                <Field label={t("handoffQueue")}>
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((m) => {
                      const on = s.handoffQueue.includes(m.userId);
                      return <button key={m.userId} type="button" onClick={() => set("handoffQueue", on ? s.handoffQueue.filter((x) => x !== m.userId) : [...s.handoffQueue, m.userId])}
                        className={cn("h-7 rounded-full border px-2.5 text-xs", on ? "border-fg-muted bg-active text-fg" : "border-line text-fg-muted")}>{on && `${s.handoffQueue.indexOf(m.userId) + 1}. `}{m.name}</button>;
                    })}
                  </div>
                </Field>
                <Field label={t("handoffTimeout")}><Input type="number" min={10} max={60} value={s.handoffTimeoutS} onChange={(e) => set("handoffTimeoutS", Number(e.target.value))} /></Field>
                <Field label={t("noAnswerPhrase")} className="md:col-span-2"><Textarea rows={2} value={s.noAnswerPhrase} onChange={(e) => set("noAnswerPhrase", e.target.value)} /></Field>
              </div>
            </section>

            <section className={cn(section, "border-b-0")}>
              <h2 className={h}>{t("limits")}</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label={t("maxCall")}><Input type="number" min={2} max={60} value={s.maxCallMinutes} onChange={(e) => set("maxCallMinutes", Number(e.target.value))} /></Field>
                <Field label={t("onLimit")}>
                  <Select value={s.onLimit} onChange={(e) => set("onLimit", e.target.value as AssistantSettings["onLimit"])}>
                    <option value="leads_only">{t("onLimitOpts.leads_only")}</option><option value="all_human">{t("onLimitOpts.all_human")}</option>
                  </Select>
                </Field>
              </div>
              <p className="text-xs text-fg-faint">{te("receive.always")}: AI берёт все звонки; {te("receive.no_answer").toLowerCase()}: сначала звонят сотрудники.</p>
            </section>
          </fieldset>
        </div>
        {/* На телефоне тест AI — первым: это главный сценарий демо */}
        <aside className="flex min-h-0 flex-col border-l border-line max-lg:order-first max-lg:h-[78dvh] max-lg:border-b max-lg:border-l-0">
          <TestCall greeting={s.greeting} autoStart={autoTest} voiceRate={s.speed} engine={engine} />
        </aside>
      </div>
    </div>
  );
}

function NumberRow({ n }: { n: PhoneNumber }) {
  const t = useTranslations("assistant");
  const te = useTranslations("enums");
  const [receive, setReceive] = React.useState(n.receive);
  const [sec, setSec] = React.useState(n.noAnswerSeconds ?? 15);
  const save = async (p: Parameters<typeof updateNumber>[1]) => { const r = await updateNumber(n.id, p); if (!r.ok) toast.error(r.error); else toast(t("saved")); };
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
      <span className="w-40 text-[13px] tabular-nums">{formatPhone(n.e164)}</span>
      <Select value={receive} className="w-56" onChange={(e) => { const v = e.target.value as PhoneNumber["receive"]; setReceive(v); void save({ receive: v }); }}>
        {(["always", "no_answer", "schedule"] as const).map((r) => <option key={r} value={r}>{te(`receive.${r}`)}</option>)}
      </Select>
      {receive === "no_answer" && (
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Input type="number" min={5} max={60} value={sec} onChange={(e) => setSec(Number(e.target.value))} onBlur={() => save({ noAnswerSeconds: sec })} className="w-16" />с
        </label>
      )}
    </li>
  );
}
