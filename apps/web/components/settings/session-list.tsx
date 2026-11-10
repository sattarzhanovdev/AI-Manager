"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Pill } from "@all/ui";
import { revokeDjangoSessions } from "@/lib/django-session-actions";
export interface SessionItem { id: string; createdAt: string; expiresAt: string; current: boolean }
export function SessionList({ sessions }: { sessions: SessionItem[] }) {
  const t = useTranslations("settings");
  const [pending, start] = useTransition();
  const router = useRouter();
  return <div className="flex flex-col gap-3">
    <ul className="rounded-[10px] border border-line text-[13px]">{sessions.map((s) => <li key={s.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-0"><time className="flex-1" dateTime={s.createdAt}>{s.createdAt.slice(0, 16).replace("T", " ")} UTC</time>{s.current && <Pill tone="success">{t("thisDevice")}</Pill>}</li>)}</ul>
    <Button loading={pending} onClick={() => start(async () => { await revokeDjangoSessions(); router.replace("/login"); router.refresh(); })}>{t("revokeAllSessions")}</Button>
  </div>;
}
