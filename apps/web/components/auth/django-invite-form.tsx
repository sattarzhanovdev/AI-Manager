"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Field, Input } from "@all/ui";
import { acceptDjangoInvite } from "@/lib/django-auth-actions";
export function DjangoInviteForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  return <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); start(async () => {
    const r = await acceptDjangoInvite({ token, name, password });
    if (!r.ok) { setError(r.error); return; }
    router.replace("/login");
  }); }}>
    <h1 className="font-display text-xl">{t("acceptTeamInvite")}</h1>
    <Field label={t("inviteName")} htmlFor="invite-name"><Input id="invite-name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
    <Field label={t("password")} htmlFor="new-password"><Input id="new-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
    {error && <p role="alert" className="text-danger text-xs">{error}</p>}
    <Button variant="primary" loading={pending} disabled={!name || password.length < 8}>{t("acceptTeamInvite")}</Button>
  </form>;
}
