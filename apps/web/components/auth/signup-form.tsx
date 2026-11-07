"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, toast } from "@all/ui";
import { toE164 } from "@/lib/format";

export function SignupForm() {
  const t = useTranslations("auth");
  const [phone, setPhone] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [sent, setSent] = React.useState(false);
  if (sent) return <p className="rounded-[12px] border border-line bg-bg p-4 text-[13px]">Спасибо! Перезвоним в течение рабочего дня.</p>;
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => {
      e.preventDefault();
      if (!toE164(phone)) { setError("Телефон указан неверно. Пример: +996 555 123 456"); return; }
      setSent(true); toast.success("Заявка отправлена");
    }}>
      <Field label={t("contact")} error={error} htmlFor="sphone"><Input id="sphone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+996 555 123 456" className="h-10" /></Field>
      <Button variant="primary" className="h-10 justify-center">{t("leaveNumber")}</Button>
    </form>
  );
}
