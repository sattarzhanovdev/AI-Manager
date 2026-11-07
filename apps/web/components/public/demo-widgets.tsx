"use client";
import * as React from "react";
import { Dialog } from "radix-ui";
import { PhoneCall, X } from "lucide-react";
import type { CallTurn } from "@all/db";
import type { DialogState } from "@all/dialog";
import { demoChat } from "@/lib/actions";
import { TestCall, type SendFn } from "../assistant/test-call";
import { CallPlayer, Transcript, useCallPlayback } from "../calls/call-player";

/** «Позвонить из браузера» на лендинге: демо-роль автосервиса, без входа */
export function BrowserCallButton({ label, className }: { label: string; className?: string }) {
  const [open, setOpen] = React.useState(false);
  // Публичное демо без входа: локальный движок по демо-анкете, состояние диалога — в браузере, в базу ничего не пишется
  const state = React.useRef<DialogState | undefined>(undefined);
  const send = React.useCallback<SendFn>(async ({ message }) => {
    const r = await demoChat(message, state.current);
    if (!r.ok) return r;
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
          <TestCall title="Демо: автосервис «Мотор»" send={send} greeting="Здравствуйте! Это демо-линия ALL-менеджера, я Айгуль — виртуальный помощник автосервиса «Мотор». Спросите про цены или запишитесь." />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Запись живого демо-звонка: плеер и расшифровка */
export function DemoRecording({ title, role, turns }: { title: string; role: string; turns: CallTurn[] }) {
  const durationMs = (turns.at(-1)?.endMs ?? 0) + 400;
  const pb = useCallPlayback(durationMs);
  return (
    <div data-theme="dark" className="flex flex-col gap-3 rounded-[24px] bg-[rgba(212,212,212,0.08)] p-5 backdrop-blur-sm">
      <div className="flex items-baseline justify-between gap-2"><p className="font-display text-[18px] font-medium tracking-[-0.01em] text-[#ededed]">{title}</p><span className="text-[13px] text-[#686868]">{role}</span></div>
      <CallPlayer turns={turns} durationMs={durationMs} pb={pb} compact />
      <div className="max-h-48 overflow-y-auto"><Transcript turns={turns} pb={pb} /></div>
    </div>
  );
}
