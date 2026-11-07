"use client";
import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, Phone, Plus, ThumbsDown, ThumbsUp, X, BookPlus, Search, FilePlus2, PhoneForwarded, PhoneOff, Database } from "lucide-react";
import { Button, Dash, DescList, ErrorState, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Pill, SectionTitle, Skeleton, cn, toast } from "@all/ui";
import type { CallDetail } from "@all/db";
import { fetchCall } from "@/lib/read";
import { rateCall } from "@/lib/actions";
import { formatDateTime, formatDuration, formatMs, formatPhone } from "@/lib/format";
import { CallPlayer, Transcript, useCallPlayback } from "./call-player";
import { OUTCOME_TONE } from "./calls-view";
import { CreateLeadSheet } from "../leads/create-lead-sheet";

const TOOL_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  search_kb: Search, get_service: Database, get_hours: Database, create_lead: FilePlus2, transfer_to_human: PhoneForwarded, end_call: PhoneOff,
};

export function CallCard({ id, onClose, onNav, onChanged }: { id: string; onClose: () => void; onNav: (d: 1 | -1) => void; onChanged: (c: Partial<CallDetail> & { id: string }) => void }) {
  const [data, setData] = React.useState<CallDetail | null | undefined>(undefined);
  const [error, setError] = React.useState(false);
  const load = React.useCallback(() => {
    setError(false);
    fetchCall(id).then(setData).catch(() => setError(true));
  }, [id]);
  React.useEffect(load, [load]);
  const t = useTranslations("common");

  if (error) return <ErrorState title={t("errorTitle")} retry={load} retryLabel={t("retry")} />;
  if (data === undefined) return <div className="flex flex-col gap-3 p-4"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-8" /><Skeleton className="h-24" /><Skeleton className="h-48" /></div>;
  if (data === null) return <ErrorState title={t("notFound")} />;
  return <CallCardBody call={data} onClose={onClose} onNav={onNav} onChanged={(p) => { setData({ ...data, ...p }); onChanged({ id: data.id, ...p }); }} />;
}

function CallCardBody({ call, onClose, onNav, onChanged }: { call: CallDetail; onClose: () => void; onNav: (d: 1 | -1) => void; onChanged: (p: Partial<CallDetail>) => void }) {
  const t = useTranslations("calls");
  const te = useTranslations("enums");
  const tl = useTranslations("leads");
  const durationMs = call.turns.length ? (call.turns.at(-1)!.endMs + 500) : call.durationS * 1000;
  const pb = useCallPlayback(durationMs);
  const [leadOpen, setLeadOpen] = React.useState(false);
  const latencies = call.turns.map((x) => x.latencyMs).filter((x): x is number => x != null).sort((a, b) => a - b);
  const avg = latencies.length ? Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length) : 0;
  const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]! : 0;
  const lastCallerQuestion = [...call.turns].reverse().find((x) => x.speaker === "caller" && x.text.includes("?"))?.text ?? call.turns.find((x) => x.speaker === "caller")?.text ?? "";
  const aiDidntKnow = call.flags.includes("unanswered") || call.turns.some((x) => x.speaker === "ai" && /уточнит администратор/i.test(x.text));

  const rate = async (r: -1 | 1, reason?: string) => {
    const prev = { rating: call.rating, ratingReason: call.ratingReason };
    onChanged({ rating: r, ratingReason: reason });
    const res = await rateCall(call.id, r, reason);
    if (!res.ok) { onChanged(prev); toast.error(res.error); } else toast(t("rated"));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Шапка */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {call.contactId ? (
                <Link href={`/app/contacts?open=${call.contactId}`} className="truncate text-sm font-medium hover:underline">{call.contactName ?? formatPhone(call.caller)}</Link>
              ) : <span className="truncate text-sm font-medium">{formatPhone(call.caller)}</span>}
              <Pill tone={OUTCOME_TONE[call.outcome]}>{te(`callOutcome.${call.outcome}`)}</Pill>
            </div>
            <div className="text-xs text-fg-muted tabular-nums">
              {call.contactName && <>{formatPhone(call.caller)} · </>}{formatDateTime(call.startedAt)} · {formatDuration(call.durationS)}{call.type && <> · {te(`callType.${call.type}`)}</>}
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={() => onNav(-1)} aria-label="Предыдущий (K)" className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover"><ChevronUp className="size-4" /></button>
            <button onClick={() => onNav(1)} aria-label="Следующий (J)" className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover"><ChevronDown className="size-4" /></button>
            <button onClick={onClose} aria-label="Закрыть (Esc)" className="inline-flex size-7 items-center justify-center rounded-full text-fg-muted hover:bg-hover"><X className="size-4" /></button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <a href={`tel:${call.caller}`} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-accent px-2.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"><Phone className="size-3.5" />{t("callbackAction")}</a>
          <Button size="sm" icon={<Plus />} onClick={() => setLeadOpen(true)}>{t("createLead")}</Button>
          <Menu>
            <MenuTrigger className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-xs hover:bg-hover">
              {call.rating === 1 ? <ThumbsUp className="size-3.5 text-success" /> : call.rating === -1 ? <ThumbsDown className="size-3.5 text-danger" /> : null}{t("rate")}
            </MenuTrigger>
            <MenuContent align="start">
              <MenuItem icon={<ThumbsUp />} onSelect={() => rate(1)}>Хорошо</MenuItem>
              <MenuSeparator />
              <MenuLabel>{t("rateReason")}</MenuLabel>
              {(["wrong_price", "misunderstood", "rude", "slow"] as const).map((r) => (
                <MenuItem key={r} icon={<ThumbsDown />} onSelect={() => rate(-1, t(`reasons.${r}`))}>{t(`reasons.${r}`)}</MenuItem>
              ))}
            </MenuContent>
          </Menu>
          {aiDidntKnow && (
            <Link href={`/app/knowledge/faq?new=${encodeURIComponent(lastCallerQuestion)}`} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-xs hover:bg-hover">
              <BookPlus className="size-3.5" />{t("addToKb")}
            </Link>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Плеер и резюме */}
        <section className="flex flex-col gap-2 border-b border-line px-4 py-3">
          {call.turns.length ? <CallPlayer turns={call.turns} durationMs={durationMs} pb={pb} /> : <p className="text-xs text-fg-muted">{call.outcome === "missed" ? t("missedNoAudio") : t("noAudio")}</p>}
          {call.summary && <p className="text-[13px] leading-5 text-fg-secondary">{call.summary}</p>}
        </section>

        <div className="flex flex-col">
          <div className="grid min-w-0 grid-cols-1 border-b border-line lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,1fr)] lg:[&>section]:border-b-0 lg:[&>section:not(:last-child)]:border-r">
            {/* Таймлайн действий AI */}
            <section className="border-b border-line px-3 py-2">
              <SectionTitle>{t("timeline")}</SectionTitle>
              {call.toolCalls.length === 0 ? <Dash /> : (
                <ol className="relative flex flex-col gap-2 border-l border-line pl-3">
                  {call.toolCalls.map((tc, i) => {
                    const Icon = TOOL_ICON[tc.name] ?? Search;
                    return (
                      <li key={i} className="relative">
                        <span className="absolute -left-[17px] top-1 flex size-2 rounded-full bg-fg-muted" />
                        <button type="button" onClick={() => pb.seek(tc.atMs)} className="flex w-full flex-col items-start text-left">
                          <span className="flex items-center gap-1.5 text-xs"><Icon className="size-3 text-fg-muted" /><span className="font-mono">{tc.name}</span><span className="tabular-nums text-fg-faint">{formatMs(tc.atMs)}</span></span>
                          <span className="w-full truncate text-xs text-fg-muted">{summarizeTool(tc)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
            {/* Заявки звонка */}
            <section className="border-b border-line px-3 py-2">
              <SectionTitle>{t("callLeads")}</SectionTitle>
              {call.leadIds.length === 0 ? <p className="text-xs text-fg-faint">{t("noLeads")}</p> : (
                <ul className="flex flex-col gap-1">
                  {call.leadIds.map((lid) => <li key={lid}><Link href={`/app/leads?open=${lid}`} className="text-[13px] hover:underline">№{lid.replace("ld_", "")}</Link></li>)}
                </ul>
              )}
            </section>
            {/* Качество */}
            <section className="px-3 py-2">
              <SectionTitle>{t("quality")}</SectionTitle>
              <DescList cols={1} items={[
                { label: t("rate"), value: call.rating ? <span className={cn(call.rating === 1 ? "text-success" : "text-danger")}>{call.rating === 1 ? "👍" : `👎 ${call.ratingReason ?? ""}`}</span> : undefined },
                { label: t("latency"), value: latencies.length ? <span className="tabular-nums">{t("avgLatency", { ms: avg })} · {t("p95", { ms: p95 })}</span> : undefined },
                { label: "Флаги", value: call.flags.length ? call.flags.map((f) => te(`callFlag.${f}`)).join(", ") : undefined },
                { label: t("kbVersion"), value: call.kbVersion ? `v${call.kbVersion}` : undefined },
              ]} />
            </section>
          </div>
          {/* Расшифровка */}
          <section className="min-w-0 px-3 py-2">
            <SectionTitle>{t("transcript")}</SectionTitle>
            {call.turns.length ? <Transcript turns={call.turns} pb={pb} /> : <Dash />}
          </section>
        </div>
      </div>
      <CreateLeadSheet open={leadOpen} onOpenChange={setLeadOpen} defaults={{ phone: call.caller, name: call.contactName, sourceCallId: call.id, title: call.summary?.split(".")[0] }} />
    </div>
  );
}

function summarizeTool(tc: CallDetail["toolCalls"][number]): string {
  const a = tc.arguments as Record<string, string>;
  switch (tc.name) {
    case "search_kb": return `«${a.query ?? ""}» → найдено в анкете`;
    case "get_service": return "цена из прайса";
    case "create_lead": return `заявка создана`;
    case "transfer_to_human": return `перевод: ${a.target ?? ""} · ответил`;
    case "end_call": return "звонок завершён";
    default: return tc.status;
  }
}
