"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { Pause, Play, RotateCcw, RotateCw, Search } from "lucide-react";
import type { CallTurn } from "@all/db";
import { cn } from "@all/ui";
import { formatMs } from "@/lib/format";
import { isTyping } from "@/lib/use-hotkeys";

/**
 * Плеер звонка: волна (реплики AI и клиента разным цветом), скорость 1–2×, ±10 с, Space.
 * Если записи нет в хранилище (демо-данные), воспроизведение идёт по таймкодам расшифровки.
 */
export function useCallPlayback(durationMs: number, audioUrl?: string) {
  const [pos, setPos] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [rate, setRate] = React.useState(1);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const raf = React.useRef<number>(0);
  const last = React.useRef<number>(0);

  React.useEffect(() => {
    if (!audioUrl) return;
    const a = new Audio(audioUrl);
    audio.current = a;
    const onTime = () => setPos(a.currentTime * 1000);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", () => setPlaying(false));
    return () => { a.pause(); a.removeEventListener("timeupdate", onTime); };
  }, [audioUrl]);

  React.useEffect(() => {
    if (audio.current) { audio.current.playbackRate = rate; if (playing) void audio.current.play(); else audio.current.pause(); return; }
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) * rate;
      last.current = now;
      setPos((p) => {
        const n = p + dt;
        if (n >= durationMs) { setPlaying(false); return durationMs; }
        return n;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, rate, durationMs]);

  const seek = React.useCallback((ms: number) => {
    const v = Math.max(0, Math.min(durationMs, ms));
    setPos(v);
    if (audio.current) audio.current.currentTime = v / 1000;
  }, [durationMs]);

  return { pos, playing, setPlaying, rate, setRate, seek };
}

export type Playback = ReturnType<typeof useCallPlayback>;

export function CallPlayer({ turns, durationMs, pb, compact }: { turns: CallTurn[]; durationMs: number; pb: Playback; compact?: boolean }) {
  const t = useTranslations("calls");
  // Space — пауза, ←/→ — 10 секунд
  React.useEffect(() => {
    if (compact) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey) return;
      if (e.code === "Space") { e.preventDefault(); pb.setPlaying(!pb.playing); }
      if (e.key === "ArrowLeft") { e.preventDefault(); pb.seek(pb.pos - 10_000); }
      if (e.key === "ArrowRight") { e.preventDefault(); pb.seek(pb.pos + 10_000); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pb, compact]);

  const bars = React.useMemo(() => waveform(turns, durationMs, compact ? 60 : 120), [turns, durationMs, compact]);
  const progress = durationMs ? pb.pos / durationMs : 0;

  return (
    <div className="flex items-center gap-2">
      {!compact && (
        <button type="button" onClick={() => pb.seek(pb.pos - 10_000)} aria-label={t("back10")} className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg"><RotateCcw className="size-3.5" /></button>
      )}
      <button type="button" onClick={() => pb.setPlaying(!pb.playing)} aria-label={pb.playing ? t("pause") : t("play")}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg hover:bg-accent-hover">
        {pb.playing ? <Pause className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}
      </button>
      {!compact && (
        <button type="button" onClick={() => pb.seek(pb.pos + 10_000)} aria-label={t("fwd10")} className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg"><RotateCw className="size-3.5" /></button>
      )}
      <div className="relative h-8 min-w-0 flex-1 cursor-pointer" role="slider" aria-label="Позиция" aria-valuemin={0} aria-valuemax={durationMs} aria-valuenow={Math.round(pb.pos)} tabIndex={0}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); pb.seek(((e.clientX - r.left) / r.width) * durationMs); }}>
        <div className="absolute inset-0 flex items-center gap-px">
          {bars.map((b, i) => (
            <span key={i} className={cn("flex-1 rounded-full", b.speaker === "ai" ? "bg-fg" : b.speaker === "operator" ? "bg-warning" : b.speaker === "caller" ? "bg-fg-faint" : "bg-line-strong",
              i / bars.length > progress && "opacity-35")} style={{ height: `${Math.round(Math.max(8, b.h * 100))}%` }} />
          ))}
        </div>
      </div>
      <span className="w-[76px] shrink-0 text-right text-xs tabular-nums text-fg-muted">{formatMs(pb.pos)} / {formatMs(durationMs)}</span>
      {!compact && (
        <button type="button" onClick={() => pb.setRate(pb.rate >= 2 ? 1 : pb.rate + 0.25)} aria-label={t("speed")}
          className="h-6 w-11 rounded-full border border-line text-xs tabular-nums text-fg-muted hover:text-fg">{pb.rate}×</button>
      )}
    </div>
  );
}

function waveform(turns: CallTurn[], durationMs: number, n: number) {
  const out: { speaker?: CallTurn["speaker"]; h: number }[] = [];
  for (let i = 0; i < n; i++) {
    const at = (i / n) * durationMs;
    const turn = turns.find((t) => at >= t.startMs && at <= t.endMs);
    const seed = Math.sin(i * 12.9898 + (turn?.seq ?? 0) * 78.233) * 43758.5453;
    const h = turn ? 0.35 + (seed - Math.floor(seed)) * 0.65 : 0.08;
    out.push({ speaker: turn?.speaker, h });
  }
  return out;
}

/** Расшифровка: реплики с ролями и таймкодами, клик — перемотка, текущая подсвечена, поиск по тексту */
export function Transcript({ turns, pb, className }: { turns: CallTurn[]; pb: Playback; className?: string }) {
  const t = useTranslations("calls");
  const te = useTranslations("enums.speaker");
  const [q, setQ] = React.useState("");
  const listRef = React.useRef<HTMLOListElement>(null);
  const current = turns.findIndex((x) => pb.pos >= x.startMs && pb.pos <= x.endMs + 400);

  React.useEffect(() => {
    if (current < 0 || !pb.playing) return;
    listRef.current?.querySelector<HTMLElement>(`[data-seq="${current}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [current, pb.playing]);

  const hl = (text: string) => {
    if (!q.trim()) return text;
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return text;
    return <>{text.slice(0, i)}<mark className="rounded bg-[rgba(107,98,242,0.35)] text-fg">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
  };
  const visible = q.trim() ? turns.filter((x) => x.text.toLowerCase().includes(q.toLowerCase())) : turns;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <label className="relative mb-2 flex h-7 items-center">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-fg-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchTranscript")}
          className="h-7 w-full rounded-full border border-line bg-transparent pl-7 pr-2 text-xs placeholder:text-fg-faint focus:border-fg-muted focus:outline-none" />
      </label>
      <ol ref={listRef} className="flex flex-col gap-0.5">
        {visible.map((x) => (
          <li key={x.seq} data-seq={x.seq}>
            <button type="button" onClick={() => { pb.seek(x.startMs); }}
              className={cn("grid w-full grid-cols-[44px_64px_1fr] gap-2 rounded-md px-1.5 py-1 text-left text-[13px] leading-5 hover:bg-hover",
                x.seq === current && "bg-selected")}>
              <span className="text-xs tabular-nums text-fg-faint">{formatMs(x.startMs)}</span>
              <span className={cn("text-xs", x.speaker === "ai" ? "text-fg font-medium" : x.speaker === "operator" ? "text-warning" : "text-fg-muted")}>{te(x.speaker)}</span>
              <span className="min-w-0">
                {hl(x.text)}
                {x.interrupted && <span className="ml-1.5 rounded-full bg-warning-bg px-1.5 text-[10px] text-warning">{t("interrupted")}</span>}
                {x.latencyMs != null && <span className={cn("ml-1.5 text-[10px] tabular-nums", x.latencyMs > 1200 ? "text-danger" : x.latencyMs > 700 ? "text-warning" : "text-fg-faint")}>{x.latencyMs} мс</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
