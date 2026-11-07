"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { Mic, PhoneCall, PhoneOff, Repeat, Send } from "lucide-react";
import { Button, cn } from "@all/ui";
import type { DialogState } from "@all/dialog";
import { testChat } from "@/lib/actions";

interface Turn { speaker: "ai" | "caller"; text: string; latencyMs?: number; tools?: string[] }

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};

/**
 * Тестовый звонок из браузера. С подключённым LIVEKIT_URL звонок идёт через голосовой сервис (apps/voice);
 * без него — локальный режим: распознавание речи браузера → движок диалога по черновику → синтез речи браузера.
 * Каждая реплика показывает задержку ответа.
 */
export function TestCall({ greeting, autoStart, voiceRate = 1, engine = testChat, title }: { greeting: string; autoStart?: boolean; voiceRate?: number; engine?: typeof testChat; title?: string }) {
  const t = useTranslations("assistant");
  const [active, setActive] = React.useState(false);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [interim, setInterim] = React.useState("");
  const [state, setState] = React.useState<DialogState | undefined>();
  const [typed, setTyped] = React.useState("");
  const [micOk, setMicOk] = React.useState(true);
  const rec = React.useRef<Recognition | null>(null);
  const stateRef = React.useRef(state);
  const activeRef = React.useRef(active);
  React.useEffect(() => { stateRef.current = state; activeRef.current = active; }, [state, active]);
  const end = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns, interim]);

  const speak = React.useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    u.rate = voiceRate;
    const ru = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("ru"));
    if (ru) u.voice = ru;
    window.speechSynthesis.speak(u);
  }, [voiceRate]);

  const reply = React.useCallback(async (text: string) => {
    window.speechSynthesis?.cancel(); // перебивание: речь AI останавливается
    setTurns((ts) => [...ts, { speaker: "caller", text }]);
    const t0 = performance.now();
    const r = await engine(text, stateRef.current);
    const latency = Math.round(performance.now() - t0);
    if (!r.ok) { setTurns((ts) => [...ts, { speaker: "ai", text: r.error }]); return; }
    setState(r.data!.state);
    setTurns((ts) => [...ts, { speaker: "ai", text: r.data!.text, latencyMs: latency, tools: r.data!.toolCalls.map((x) => x.name) }]);
    if (activeRef.current) speak(r.data!.text);
  }, [speak, engine]);

  const start = React.useCallback(() => {
    activeRef.current = true;
    setActive(true);
    setTurns([{ speaker: "ai", text: greeting, latencyMs: 0 }]);
    setState(undefined);
    speak(greeting);
    const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) { setMicOk(false); return; }
    const r = new Ctor();
    r.lang = "ru-RU"; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let fin = "", mid = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) fin += res[0]!.transcript; else mid += res[0]!.transcript;
      }
      if (mid) { window.speechSynthesis?.cancel(); setInterim(mid); }
      if (fin.trim()) { setInterim(""); void reply(fin.trim()); }
    };
    r.onerror = (e) => { if (e.error === "not-allowed") setMicOk(false); };
    r.onend = () => { if (activeRef.current) { try { r.start(); } catch { /* уже запущен */ } } };
    try { r.start(); } catch { setMicOk(false); }
    rec.current = r;
  }, [greeting, reply, speak]);

  const stop = () => {
    activeRef.current = false;
    setActive(false);
    rec.current?.abort();
    rec.current = null;
    window.speechSynthesis?.cancel();
    setInterim("");
  };
  React.useEffect(() => () => { rec.current?.abort(); window.speechSynthesis?.cancel(); }, []);
  React.useEffect(() => { if (autoStart) start(); }, [autoStart, start]);

  const lastAi = [...turns].reverse().find((x) => x.speaker === "ai");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <h2 className="flex-1 text-[13px] font-medium">{title ?? t("testPanel")}</h2>
        {active && <span className="flex items-center gap-1.5 text-xs text-fg-muted"><span className="live-dot size-2 rounded-full bg-success" />{micOk ? <Mic className="size-3.5" /> : null}</span>}
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-b border-line p-3">
        {!active ? (
          <Button variant="primary" className="h-10 justify-center" icon={<PhoneCall />} onClick={start}>{t("callFromBrowser")}</Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="danger" className="h-10 flex-1 justify-center" icon={<PhoneOff />} onClick={stop}>{t("endCall")}</Button>
            <Button className="h-10" icon={<Repeat />} disabled={!lastAi} onClick={() => lastAi && speak(lastAi.text)}>{t("repeatLast")}</Button>
          </div>
        )}
        <p className="text-xs text-fg-faint">{t("testHint")}</p>
      </div>
      {active && <div className="glow-line" aria-hidden />}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <p className="mb-2 text-xs uppercase tracking-[0.06em] text-fg-muted">{t("liveTranscript")}</p>
        <ol className="flex flex-col gap-1.5">
          {turns.map((x, i) => (
            <li key={i} className="grid grid-cols-[52px_1fr] gap-2 text-[13px] leading-5">
              <span className={cn("text-xs", x.speaker === "ai" ? "font-medium text-fg" : "text-fg-muted")}>{x.speaker === "ai" ? "AI" : "Вы"}</span>
              <span>
                {x.text}
                {x.latencyMs != null && x.latencyMs > 0 && <span className={cn("ml-1.5 text-[10px] tabular-nums", x.latencyMs > 1200 ? "text-danger" : x.latencyMs > 700 ? "text-warning" : "text-fg-faint")}>{t("latency", { ms: x.latencyMs })}</span>}
                {x.tools && x.tools.length > 0 && <span className="ml-1.5 font-mono text-[10px] text-fg-faint">{x.tools.join(" · ")}</span>}
              </span>
            </li>
          ))}
          {interim && <li className="grid grid-cols-[52px_1fr] gap-2 text-[13px] italic text-fg-muted"><span className="text-xs">Вы</span><span>{interim}…</span></li>}
        </ol>
        <div ref={end} />
      </div>
      {active && (
        <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { void reply(typed.trim()); setTyped(""); } }} className="flex shrink-0 gap-1.5 border-t border-line p-2">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("testTyping")} className="h-8 min-w-0 flex-1 rounded-full border border-line bg-bg px-3 text-[13px] focus:border-fg-muted focus:outline-none" />
          <Button size="icon" variant="primary" aria-label="Отправить" disabled={!typed.trim()}><Send /></Button>
        </form>
      )}
    </div>
  );
}
