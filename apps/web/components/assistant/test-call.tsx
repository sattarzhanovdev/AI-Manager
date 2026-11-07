"use client";
import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bot, Cpu, ExternalLink, Mic, MicOff, PhoneCall, PhoneOff, RotateCcw, Send, Square } from "lucide-react";
import { Button, Tooltip, cn } from "@all/ui";
import { assistantMessage, type AssistantReply, type Result } from "@/lib/actions";

interface Turn { speaker: "ai" | "caller"; text: string; latencyMs?: number; tools?: string[]; lead?: AssistantReply["lead"]; engine?: AssistantReply["engine"]; error?: boolean }

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};
type MicState = "off" | "listening" | "denied" | "missing" | "unsupported" | "error";
type Phase = "idle" | "thinking" | "speaking";

const SAMPLES = ["Здравствуйте, сколько стоит замена масла?", "Хочу записаться на завтра", "Меня зовут Азамат, мой номер +996 700 123 456", "До скольки вы работаете в субботу?"];

/**
 * «Протестировать AI»: браузерное голосовое демо с текстовым fallback.
 * Речь → Web Speech API (распознавание) → серверный ход диалога (LLM или локальный движок) → озвучка speechSynthesis.
 * Полудуплекс: пока AI говорит, микрофон на паузе, чтобы ассистент не слышал сам себя.
 * Это не телефония: звонок не идёт через SIP, соединения с оператором нет.
 */
export type SendFn = (input: { conversationId?: string; message: string; channel: "voice" | "chat" }) => Promise<Result<AssistantReply>>;

export function TestCall({ greeting, autoStart, voiceRate = 1, title, engine = { llm: false, mock: false }, send = assistantMessage }: {
  greeting: string; autoStart?: boolean; voiceRate?: number; title?: string;
  engine?: { llm: boolean; model?: string; mock: boolean };
  /** Обработчик хода; по умолчанию — серверный диалог кабинета с записью заявки в базу */
  send?: SendFn;
}) {
  const t = useTranslations("assistant");
  const [active, setActive] = React.useState(false);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [interim, setInterim] = React.useState("");
  const [typed, setTyped] = React.useState("");
  const [mic, setMic] = React.useState<MicState>("off");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [lastEngine, setLastEngine] = React.useState<{ engine: AssistantReply["engine"]; model?: string; mock?: boolean } | null>(null);
  const conv = React.useRef<string | undefined>(undefined);
  const rec = React.useRef<Recognition | null>(null);
  const voiceOn = React.useRef(false);
  const busy = React.useRef(false);
  const phaseRef = React.useRef<Phase>("idle");
  React.useEffect(() => { phaseRef.current = phase; }, [phase]);
  const end = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns, interim, phase]);

  const pauseMic = () => { try { rec.current?.abort(); } catch { /* уже остановлен */ } };
  const resumeMic = React.useCallback(() => {
    if (!voiceOn.current || !rec.current) return;
    try { rec.current.start(); setMic("listening"); } catch { /* уже запущен */ }
  }, []);

  const speak = React.useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !voiceOn.current) { setPhase("idle"); resumeMic(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    u.rate = voiceRate;
    const ru = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("ru"));
    if (ru) u.voice = ru;
    pauseMic();
    setPhase("speaking");
    const done = () => { setPhase("idle"); resumeMic(); };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  }, [voiceRate, resumeMic]);

  const reply = React.useCallback(async (text: string, channel: "voice" | "chat") => {
    if (busy.current || !text.trim()) return;
    busy.current = true;
    pauseMic();
    setTurns((ts) => [...ts, { speaker: "caller", text }]);
    setPhase("thinking");
    const t0 = performance.now();
    try {
      const r = await send({ conversationId: conv.current, message: text, channel });
      const latency = Math.round(performance.now() - t0);
      if (!r.ok) {
        setTurns((ts) => [...ts, { speaker: "ai", text: r.error, error: true }]);
        setPhase("idle"); resumeMic();
        return;
      }
      const d = r.data!;
      conv.current = d.conversationId;
      setLastEngine({ engine: d.engine, model: d.model, mock: d.mock });
      setTurns((ts) => [...ts, { speaker: "ai", text: d.text, latencyMs: latency, tools: d.tools, lead: d.lead, engine: d.engine }]);
      if (voiceOn.current) speak(d.text); else setPhase("idle");
    } catch {
      setTurns((ts) => [...ts, { speaker: "ai", text: "Сеть недоступна. Проверьте подключение и повторите.", error: true }]);
      setPhase("idle"); resumeMic();
    } finally {
      busy.current = false;
    }
  }, [speak, resumeMic, send]);

  const startRecognition = React.useCallback(async () => {
    const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) { setMic("unsupported"); return false; }
    // Явный запрос доступа к микрофону — понятная ошибка, если доступ запрещён или микрофона нет
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((tr) => tr.stop());
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setMic(name === "NotFoundError" || name === "OverconstrainedError" ? "missing" : "denied");
      return false;
    }
    const r = new Ctor();
    r.lang = "ru-RU"; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let fin = "", mid = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) fin += res[0]!.transcript; else mid += res[0]!.transcript;
      }
      setInterim(mid);
      if (fin.trim()) { setInterim(""); void reply(fin.trim(), "voice"); }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { voiceOn.current = false; setMic("denied"); }
      else if (e.error === "audio-capture") { voiceOn.current = false; setMic("missing"); }
      else if (e.error === "network") { voiceOn.current = false; setMic("error"); }
      // no-speech / aborted — штатно, onend перезапустит
    };
    r.onend = () => { if (voiceOn.current && !busy.current && phaseRef.current === "idle") { try { r.start(); } catch { /* уже запущен */ } } };
    rec.current = r;
    voiceOn.current = true;
    return true;
  }, [reply]);

  const start = React.useCallback(async (withVoice: boolean) => {
    conv.current = undefined;
    setActive(true);
    setTurns([{ speaker: "ai", text: greeting, latencyMs: 0 }]);
    setMic("off");
    if (withVoice && await startRecognition()) speak(greeting);
  }, [greeting, startRecognition, speak]);

  const toggleMic = async () => {
    if (voiceOn.current) { voiceOn.current = false; pauseMic(); window.speechSynthesis?.cancel(); setMic("off"); setPhase("idle"); return; }
    if (await startRecognition()) resumeMic();
  };

  const stop = () => {
    voiceOn.current = false;
    setActive(false);
    pauseMic();
    rec.current = null;
    window.speechSynthesis?.cancel();
    setInterim("");
    setMic("off");
    setPhase("idle");
  };
  React.useEffect(() => () => { voiceOn.current = false; rec.current?.abort(); window.speechSynthesis?.cancel(); }, []);
  React.useEffect(() => { if (autoStart) void start(false); }, [autoStart, start]);

  const micError = mic === "denied" ? t("micDenied") : mic === "missing" ? t("micMissing") : mic === "unsupported" ? t("sttUnsupported") : mic === "error" ? t("sttError") : null;
  const status = phase === "thinking" ? t("thinking") : phase === "speaking" ? t("speaking") : mic === "listening" ? t("listening") : null;
  const eng = lastEngine ?? { engine: engine.llm ? "llm" as const : "offline" as const, model: engine.model, mock: engine.mock };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="test-call">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium">{title ?? t("testAi")}</h2>
        <Tooltip content={eng.engine === "llm" ? eng.model ?? "" : t("engineOfflineHint")}>
          <span data-testid="ai-engine" className={cn("inline-flex h-6 max-w-[62%] shrink-0 items-center gap-1 truncate whitespace-nowrap rounded-full border px-2 text-[11px]", eng.engine === "llm" ? "border-line-strong text-fg-secondary" : "border-warning/40 text-warning")}>
            {eng.engine === "llm" ? <Bot className="size-3" /> : <Cpu className="size-3" />}
            {eng.mock ? t("engineMock") : eng.engine === "llm" ? t("engineLlm", { model: eng.model ?? "LLM" }) : t("engineOffline")}
          </span>
        </Tooltip>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-b border-line p-3">
        {!active ? (
          <>
            <Button variant="primary" className="h-10 justify-center" icon={<PhoneCall />} onClick={() => void start(true)} data-testid="start-voice">{t("voiceStart")}</Button>
            <Button className="h-8 justify-center" icon={<Send />} onClick={() => void start(false)} data-testid="start-text">{t("textStart")}</Button>
          </>
        ) : (
          <div className="flex gap-2">
            <Button variant="danger" className="h-10 flex-1 justify-center" icon={<PhoneOff />} onClick={stop} data-testid="end-call">{t("endCall")}</Button>
            <Button className="h-10" icon={mic === "listening" ? <MicOff /> : <Mic />} onClick={() => void toggleMic()} aria-label={mic === "listening" ? t("micOff") : t("micOn")}>
              {mic === "listening" ? t("micOff") : t("micOn")}
            </Button>
            <Button className="h-10" size="icon" icon={<RotateCcw />} aria-label={t("newDialog")} onClick={() => { stop(); void start(false); }} />
          </div>
        )}
        <p className="text-xs text-fg-faint">{active ? t("testAiHint") : t("voiceNote")}</p>
        {micError && <p role="alert" className="text-xs text-warning">{micError}</p>}
      </div>
      {(phase !== "idle" || mic === "listening") && <div className="glow-line" aria-hidden />}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <p className="mb-2 text-xs uppercase tracking-[0.06em] text-fg-muted">{t("liveTranscript")}</p>
        <ol className="flex flex-col gap-1.5" data-testid="transcript">
          {turns.map((x, i) => (
            <li key={i} className="grid grid-cols-[40px_1fr] gap-2 text-[13px] leading-5" data-speaker={x.speaker}>
              <span className={cn("text-xs", x.speaker === "ai" ? "font-medium text-fg" : "text-fg-muted")}>{x.speaker === "ai" ? "AI" : "Вы"}</span>
              <span className={cn(x.error && "text-danger")}>
                {x.text}
                {x.latencyMs != null && x.latencyMs > 0 && <span className={cn("ml-1.5 text-[10px] tabular-nums", x.latencyMs > 2500 ? "text-danger" : x.latencyMs > 1200 ? "text-warning" : "text-fg-faint")}>{t("latency", { ms: x.latencyMs })}</span>}
                {x.tools && x.tools.length > 0 && <span className="ml-1.5 font-mono text-[10px] text-fg-faint">{x.tools.join(" · ")}</span>}
                {x.lead && (
                  <Link href={`/app/leads?open=${x.lead.id}`} data-testid="lead-created"
                    className="mt-1 flex w-fit items-center gap-1.5 rounded-full border border-success/40 bg-success-bg px-2.5 py-0.5 text-xs text-success hover:underline">
                    {t("leadCreated", { number: x.lead.number })} · {t("openInCrm")}<ExternalLink className="size-3" />
                  </Link>
                )}
              </span>
            </li>
          ))}
          {interim && <li className="grid grid-cols-[40px_1fr] gap-2 text-[13px] italic text-fg-muted"><span className="text-xs">Вы</span><span>{interim}…</span></li>}
          {status && <li className="grid grid-cols-[40px_1fr] gap-2 text-xs text-fg-faint" aria-live="polite"><span />{status}</li>}
        </ol>
        {active && turns.length <= 1 && (
          <div className="mt-3 flex flex-col gap-1.5">
            <p className="text-xs text-fg-muted">{t("suggestions")}</p>
            <div className="flex flex-wrap gap-1.5">
              {SAMPLES.map((q) => <button key={q} type="button" onClick={() => void reply(q, voiceOn.current ? "voice" : "chat")} className="h-7 rounded-full border border-line px-2.5 text-xs text-fg-muted hover:bg-hover hover:text-fg">{q}</button>)}
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
      {active && (
        <form onSubmit={(e) => { e.preventDefault(); const v = typed.trim(); if (v) { setTyped(""); void reply(v, voiceOn.current ? "voice" : "chat"); } }} className="flex shrink-0 gap-1.5 border-t border-line p-2">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("testTyping")} aria-label={t("testTyping")} data-testid="chat-input"
            className="h-8 min-w-0 flex-1 rounded-full border border-line bg-bg px-3 text-[13px] focus:border-fg-muted focus:outline-none" />
          {phase === "speaking"
            ? <Button size="icon" type="button" aria-label="Stop" onClick={() => { window.speechSynthesis?.cancel(); setPhase("idle"); resumeMic(); }}><Square /></Button>
            : <Button size="icon" variant="primary" aria-label="Отправить" disabled={!typed.trim() || phase === "thinking"} data-testid="chat-send"><Send /></Button>}
        </form>
      )}
    </div>
  );
}
