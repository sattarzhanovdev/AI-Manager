"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Field, Input } from "@all/ui";
import { loginWithPassword } from "@/lib/actions";

/** Вход по email и паролю (Supabase Auth). Ошибка неверного пароля — без уточнения, что именно не так. */
export function PasswordLoginForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [otp, setOtp] = React.useState("");
  const [mfa, setMfa] = React.useState(false);
  const [secret, setSecret] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const [pending, start] = React.useTransition();

  const submit = () => start(async () => {
    setError(undefined);
    const r = await loginWithPassword({ email, password, otp });
    if (!r.ok) { setError(r.error); return; }
    if (r.data?.mfaRequired) { setMfa(true); setSecret(r.data.setupSecret); return; }
    router.replace(r.data?.next ?? "/app");
    router.refresh();
  });

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="login-form">
      <h1 className="font-display text-2xl font-medium tracking-[-0.03em]">{t("loginTitle")}</h1>
      <Field label={t("email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder={t("emailPh")} className="h-10" aria-invalid={!!error} />
      </Field>
      <Field label={t("password")} htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="h-10" aria-invalid={!!error} />
      </Field>
      {mfa && <Field label={t("totpCode")} htmlFor="totp"><Input id="totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} required /></Field>}
      {secret && <p className="break-all text-xs text-fg-muted">{t("totpSetup")} <code>{secret}</code></p>}
      {error && <p className="text-xs text-danger" role="alert" data-testid="login-error">{error}</p>}
      <Button variant="primary" className="h-10 justify-center" loading={pending} disabled={!email.trim() || !password}>{t("signIn")}</Button>
      <p className="text-xs text-fg-faint">{t("passwordHint")}</p>
    </form>
  );
}
