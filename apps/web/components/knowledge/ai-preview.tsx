"use client";
import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PhoneCall, Send, RotateCcw, ShieldCheck } from "lucide-react";
import { Button, Tabs, cn } from "@all/ui";
import type { DialogState, EngineReply } from "@all/dialog";
import { runQuestionCheck, testChat } from "@/lib/actions";

interface CheckRow { question: string; answer: string; source: string; cannot: boolean; field: string }
interface Msg { role: "user" | "ai"; text: string; meta?: EngineReply }

/** «Как ответит AI»: тестовый чат по ЧЕРНОВИКУ и проверка 30 вопросами */
export function AiPreview({ onGoToField }: { onGoToField: (field: string) => void }) {
  const t = useTranslations("knowledge");
  const [tab, setTab] = React.useState("chat");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <h2 className="text-[13px] font-medium">{t("testTitle")}</h2>
        <Link href="/app/assistant?test=1" className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-xs hover:bg-hover"><PhoneCall className="size-3.5" />{t("testCall")}</Link>
      </div>
      <div className="shrink-0 border-b border-line px-2 py-1">
        <Tabs value={tab} onValueChange={setTab} items={[{ value: "chat", label: t("testChat") }, { value: "check", label: t("testCheck") }]} />
      </div>
      {tab === "chat" ? <TestChat /> : <QuestionCheck onGoToField={onGoToField} />}
    </div>
  );
}

function TestChat() {
  const t = useTranslations("knowledge");
  const [msgs, setMsgs] = React.useState<Msg[]>([{ role: "ai", text: "Здравствуйте! Я отвечу так, как ответит ассистент по текущему черновику анкеты." }]);
  const [state, setState] = React.useState<DialogState | undefined>();
  const [text, setText] = React.useState("");
  const [pending, start] = React.useTransition();
  const end = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  const send = (value = text) => {
    const v = value.trim();
    if (!v) return;
    setText("");
    setMsgs((m) => [...m, { role: "user", text: v }]);
    start(async () => {
      const r = await testChat(v, state);
      if (!r.ok) { setMsgs((m) => [...m, { role: "ai", text: r.error }]); return; }
      setState(r.data!.state);
      setMsgs((m) => [...m, { role: "ai", text: r.data!.text, meta: r.data }]);
    });
  };
  const samples = ["Сколько стоит замена масла?", "До скольки работаете в субботу?", "Вы робот?", "Хочу записаться на диагностику"];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 px-3 pt-2 text-[11px] text-fg-faint">{t("testDraftNote")}</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <ul className="flex flex-col gap-2">
          {msgs.map((m, i) => (
            <li key={i} className={cn("flex flex-col gap-1", m.role === "user" ? "items-end" : "items-start")}>
              <span className={cn("max-w-[88%] rounded-[14px] px-3 py-1.5 text-[13px] leading-5", m.role === "user" ? "bg-accent text-accent-fg" : "bg-subtle text-fg ring-1 ring-line")}>{m.text}</span>
              {m.meta && (
                <span className="flex max-w-[88%] flex-wrap gap-1 text-[10px] text-fg-faint">
                  {m.meta.toolCalls.map((tc, j) => <span key={j} className={cn("rounded-full border border-line px-1.5 font-mono", tc.status === "rejected" && "border-danger/40 text-danger")}>{tc.name}</span>)}
                  {m.meta.sources[0] && <span>· {m.meta.sources[0].source}</span>}
                  {m.meta.guard.length > 0 && <span className="flex items-center gap-0.5 text-warning"><ShieldCheck className="size-3" />охрана: {m.meta.guard.join(", ")}</span>}
                  {m.meta.handoff && <span className="text-warning">→ передача человеку</span>}
                </span>
              )}
            </li>
          ))}
          {pending && <li className="text-xs text-fg-faint">…</li>}
        </ul>
        <div ref={end} />
      </div>
      {msgs.length < 2 && (
        <div className="flex shrink-0 flex-wrap gap-1 px-3 pb-2">
          {samples.map((s) => <button key={s} onClick={() => send(s)} className="h-6 rounded-full border border-line px-2 text-[11px] text-fg-muted hover:text-fg">{s}</button>)}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex shrink-0 items-center gap-1.5 border-t border-line p-2">
        <button type="button" onClick={() => { setMsgs(msgs.slice(0, 1)); setState(undefined); }} aria-label="Сначала" className="inline-flex size-8 items-center justify-center rounded-full text-fg-faint hover:bg-hover hover:text-fg"><RotateCcw className="size-3.5" /></button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("testPh")} className="h-8 min-w-0 flex-1 rounded-full border border-line bg-bg px-3 text-[13px] focus:border-fg-muted focus:outline-none" />
        <Button type="submit" size="icon" variant="primary" aria-label="Отправить" disabled={!text.trim()}><Send /></Button>
      </form>
    </div>
  );
}

function QuestionCheck({ onGoToField }: { onGoToField: (field: string) => void }) {
  const t = useTranslations("knowledge");
  const [rows, setRows] = React.useState<CheckRow[]>();
  const [pending, start] = React.useTransition();
  const run = () => start(async () => { const r = await runQuestionCheck(); if (r.ok) setRows(r.data); });
  const ok = rows?.filter((r) => !r.cannot).length ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <Button size="sm" variant="primary" loading={pending} onClick={run}>{t("checkRun")}</Button>
        {rows && <span className="text-xs tabular-nums text-fg-muted">{t("checkOk", { ok, total: rows.length })}</span>}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {rows && [...rows].sort((a, b) => Number(b.cannot) - Number(a.cannot)).map((r) => (
          <li key={r.question} className="border-t border-line px-3 py-2">
            <p className="text-xs font-medium">{r.question}</p>
            <p className={cn("text-xs leading-4", r.cannot ? "text-fg-faint" : "text-fg-secondary")}>{r.answer}</p>
            <div className="mt-0.5 flex items-center gap-2 text-[10px]">
              {r.cannot ? <span className="rounded-full bg-warning-bg px-1.5 text-warning">{t("checkCannot")}</span> : <span className="text-fg-faint">{r.source}</span>}
              {r.cannot && <button onClick={() => onGoToField(r.field)} className="text-fg-muted underline hover:text-fg">{t("goToField")}</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
