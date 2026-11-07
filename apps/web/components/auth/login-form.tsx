"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Field, Input } from "@all/ui";
import { requestCode, verifyCode, verifyTotp } from "@/lib/actions";
import { OtpInput } from "./otp-input";

type Step = "contact" | "code" | "totp";

/** Вход по телефону — ≤ 3 действий: ввести номер → получить код → ввести код */
export function LoginForm({ mock }: { mock: boolean }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [step, setStep] = React.useState<Step>("contact");
  const [contact, setContact] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [pending, start] = React.useTransition();
  const [resendIn, setResendIn] = React.useState(0);

  React.useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const send = () => start(async () => {
    setError(undefined);
    const r = await requestCode(contact);
    if (!r.ok) { setError(r.error); return; }
    setStep("code"); setResendIn(60); setCode("");
  });
  const verify = (c: string) => start(async () => {
    setError(undefined);
    const r = step === "totp" ? await verifyTotp(contact, c) : await verifyCode(contact, c);
    if (!r.ok) { setError(r.error); setCode(""); return; }
    if (r.data && "twofa" in r.data && r.data.twofa) { setStep("totp"); setCode(""); return; }
    router.push(r.data?.next || "/app");
    router.refresh();
  });

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl font-medium tracking-[-0.03em]">{step === "contact" ? t("loginTitle") : step === "code" ? t("codeTitle") : t("twofa")}</h1>
      {step === "contact" && (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <Button type="button" variant="secondary" className="h-10 justify-center" onClick={() => setError("Вход через Google включается после подключения Supabase Auth")}>
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3ZM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Zm-5.6-8a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9l3.3-2.5ZM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6Z" /></svg>
            {t("google")}
          </Button>
          <div className="flex items-center gap-3 text-xs text-fg-faint"><span className="h-px flex-1 bg-line" />{t("or")}<span className="h-px flex-1 bg-line" /></div>
          <Field label={t("contact")} error={error} htmlFor="contact">
            <Input id="contact" autoFocus autoComplete="username" value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t("contactPh")} className="h-10" aria-invalid={!!error} />
          </Field>
          <Button variant="primary" className="h-10 justify-center" loading={pending} disabled={contact.trim().length < 5}>{t("getCode")}</Button>
          {mock && <p className="text-xs text-fg-faint">{t("demoHint")} · +996 555 100 100 — собственник, +996 555 100 200 — админ</p>}
        </form>
      )}
      {step !== "contact" && (
        <div className="flex flex-col gap-3">
          {step === "code" && (
            <p className="text-[13px] text-fg-muted">
              {t("codeSent", { contact })} · <button className="text-fg underline" onClick={() => { setStep("contact"); setError(undefined); }}>{t("changeContact")}</button>
            </p>
          )}
          <OtpInput value={code} onChange={setCode} onComplete={verify} invalid={!!error} autoFocus />
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          <Button variant="primary" className="h-10 justify-center" loading={pending} disabled={code.length !== 6} onClick={() => verify(code)}>{t("verify")}</Button>
          {step === "code" && (
            <button disabled={resendIn > 0} onClick={send} className="text-left text-xs text-fg-muted enabled:hover:text-fg disabled:opacity-60">
              {resendIn > 0 ? t("resendIn", { s: resendIn }) : t("resend")}
            </button>
          )}
          {mock && <p className="text-xs text-fg-faint">{t("demoHint")}</p>}
        </div>
      )}
    </div>
  );
}
