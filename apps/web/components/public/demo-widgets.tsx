"use client";
import * as React from "react";
import { Dialog } from "radix-ui";
import { PhoneCall, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CallTurn } from "@all/db";
import type { DemoRecordingData } from "@/lib/demo-recordings";
import { detectDemoRole, type DemoRole, type DialogState } from "@all/dialog";
import { demoChat } from "@/lib/actions";
import { TestCall, type SendFn } from "../assistant/test-call";
import { CallPlayer, Transcript, useCallPlayback } from "../calls/call-player";

/** «Позвонить из браузера» на лендинге: демо-роль автосервиса, без входа */
export function BrowserCallButton({ label, className }: { label: string; className?: string }) {
  const t = useTranslations("landing");
  const [open, setOpen] = React.useState(false);
  // Публичное демо без входа: локальный движок по демо-анкете, состояние диалога — в браузере, в базу ничего не пишется
  const state = React.useRef<DialogState | undefined>(undefined);
  const role = React.useRef<DemoRole>("autoservice");
  const send = React.useCallback<SendFn>(async ({ message }) => {
    const nextRole = detectDemoRole(message);
    const r = await demoChat(message, state.current, role.current);
    if (!r.ok) return r;
    role.current = nextRole ?? role.current;
    state.current = r.data!.state;
    return { ok: true, data: { conversationId: "public-demo", text: r.data!.text, engine: "offline", tools: r.data!.toolCalls.map((x) => x.name) } };
  }, []);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={className}><PhoneCall className="size-4" />{label}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content data-theme="dark" className="fixed inset-y-4 right-4 z-50 flex w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[24px] border border-white/15 bg-[#161616] text-[#ededed]">
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <Dialog.Close className="absolute right-3 top-2.5 z-10 inline-flex size-7 items-center justify-center rounded-full text-white/60 hover:bg-white/10" aria-label="Закрыть"><X className="size-4" /></Dialog.Close>
          <p className="px-5 pt-10 text-xs text-white/60">{t("browserDemoDisclosure")}</p>
          <TestCall title={t("demoRoleTitle")} send={send} greeting={t("demoRoleGreeting")} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Static simulations have no CRM side effects. BrowserCallButton is a separate experience. */
export function DemoRecording(props: { recording: DemoRecordingData } | { title: string; role: string; turns: CallTurn[] }) {
  const recording = "recording" in props ? props.recording : {
    title: props.title, industry: props.role, company: "", audio: undefined,
    participants: { ai: { name: "AI" }, caller: { name: "Клиент" } }, lines: props.turns,
  };
  const { title, industry, company, participants, lines, audio } = recording;
  const t = useTranslations("landing");
  const pb = useCallPlayback(audio?.durationMs ?? 0, audio?.audioUrl);
  const titleId = React.useId();
  return (
    <article data-theme="dark" data-testid="demo-recording" aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4 rounded-[24px] border border-white/10 bg-[rgba(212,212,212,0.08)] p-5 backdrop-blur-sm sm:p-6">
      <div>
        <p className="mb-2 text-xs text-white/50">{industry} · {company} · RU</p>
        <h4 id={titleId} className="font-display text-[20px] font-medium leading-tight tracking-[-0.01em] text-[#ededed]">{title}</h4>
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        <span className="rounded-full bg-violet-400/15 px-3 py-1 text-violet-300">{participants.ai.name} · {t("aiManager")}</span>
        <span className="rounded-full bg-teal-400/15 px-3 py-1 text-teal-300">{participants.caller.name} · {t("demoClient")}</span>
      </div>
      <CallPlayer turns={audio?.turns ?? []} durationMs={audio?.durationMs ?? 0} pb={pb} compact />
      <button type="button" disabled={!audio || pb.status !== "ready"} onClick={() => { pb.seek(0); pb.setPlaying(true); }} className="w-fit text-xs text-white/65 underline underline-offset-4 hover:text-white focus-visible:outline-2 disabled:hidden">{t("replay")}</button>
      <div className="max-h-64 overflow-y-auto overscroll-contain">
        {audio ? <Transcript turns={audio.turns} pb={pb} /> : <ol className="flex flex-col gap-3">{lines.map((line) => <li key={line.seq} className="text-[13px] leading-5"><span className={line.speaker === "ai" ? "text-violet-300" : "text-teal-300"}>{line.speaker === "ai" ? participants.ai.name : participants.caller.name}: </span>{line.text}</li>)}</ol>}
      </div>
      <p className="mt-auto border-t border-white/10 pt-3 text-[11px] leading-5 text-white/50">{audio ? t("simulationDisclosure") : t("simulationPending")}<br />{t("simulationNoCrm")}</p>
    </article>
  );
}
