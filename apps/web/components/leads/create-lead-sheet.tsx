"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Field, Input, Select, Sheet, Textarea, toast } from "@all/ui";
import { createLead } from "@/lib/actions";

const schema = z.object({
  type: z.enum(["booking", "consultation", "order", "complaint", "reschedule", "callback", "other"]),
  title: z.string().trim().min(2, "Опишите заявку"),
  phone: z.string().trim().min(5, "Укажите телефон"),
  name: z.string().optional(),
  priority: z.enum(["normal", "urgent"]),
  comment: z.string().optional(),
});
type Values = z.infer<typeof schema>;

/** Создание заявки — в боковой панели, не в модалке */
export function CreateLeadSheet({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (v: boolean) => void; defaults?: { phone?: string; name?: string; sourceCallId?: string; title?: string } }) {
  const t = useTranslations("leads");
  const te = useTranslations("enums");
  const tc = useTranslations("common");
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { type: "booking", priority: "normal", title: defaults?.title ?? "", phone: defaults?.phone ?? "", name: defaults?.name ?? "" } });
  React.useEffect(() => { if (open) form.reset({ type: "booking", priority: "normal", title: defaults?.title ?? "", phone: defaults?.phone ?? "", name: defaults?.name ?? "" }); }, [open, defaults, form]);
  const { register, formState: { errors, isSubmitting } } = form;

  const submit = form.handleSubmit(async (v) => {
    const r = await createLead({ ...v, sourceCallId: defaults?.sourceCallId });
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(t("created", { number: r.data!.number }));
    onOpenChange(false);
    router.push(`/app/leads?open=${r.data!.id}`);
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("createTitle")}
      footer={<><Button onClick={() => onOpenChange(false)}>{tc("cancel")}</Button><Button variant="primary" loading={isSubmitting} onClick={submit}>{tc("create")}</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <Field label={t("form.type")}><Select {...register("type")}>{(["booking", "consultation", "order", "complaint", "reschedule", "callback", "other"] as const).map((v) => <option key={v} value={v}>{te(`leadType.${v}`)}</option>)}</Select></Field>
        <Field label={t("form.priority")}><Select {...register("priority")}><option value="normal">{t("priority.normal")}</option><option value="urgent">{t("priority.urgent")}</option></Select></Field>
        <Field label={t("form.title")} error={errors.title?.message} className="col-span-2"><Input {...register("title")} placeholder={t("form.titlePh")} aria-invalid={!!errors.title} /></Field>
        <Field label={t("form.phone")} error={errors.phone?.message}><Input {...register("phone")} placeholder="+996 555 123 456" aria-invalid={!!errors.phone} /></Field>
        <Field label={t("form.name")}><Input {...register("name")} /></Field>
        <Field label={t("form.comment")} className="col-span-2"><Textarea rows={3} {...register("comment")} /></Field>
      </form>
    </Sheet>
  );
}
