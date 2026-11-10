import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SiteNav } from "@/components/public/site-chrome";
import { DemoRecording } from "@/components/public/demo-widgets";
import { admin } from "@/lib/data/queries";
import { formatDateTime, formatDuration } from "@/lib/format";
import { notFound } from "next/navigation";
import { isSupabase, isDjango } from "@/lib/env";

export const metadata = { title: "Результат демо-звонка", robots: { index: false } };

/** Ссылка из SMS: расшифровка, карточка звонка и заявка так, как их видит бизнес */
export default async function DemoResult({ params }: { params: Promise<{ token: string }> }) {
  // Результаты телефонной демо-линии появятся вместе с телефонией; в Hackathon MVP страницы нет
  if (isSupabase || isDjango) notFound();
  const { token } = await params;
  const t = await getTranslations("demo");
  const call = admin.demoCalls().find((c) => c.token === token) ?? (token === "example" ? admin.demoCalls()[0] : undefined);
  if (!call) {
    return <div data-theme="dark" className="flex min-h-dvh items-center justify-center bg-[#0a0a0a] text-[#ededed]"><SiteNav /><p>{t("notFound")}</p></div>;
  }
  const turns = [
    ["ai", "Здравствуйте! Это демо-линия ALL-менеджера. Кем мне быть: автосервис, клиника, салон, стоматология или поликлиника?"], ["caller", "Давайте автосервис."],
    ["ai", "Отлично! Автосервис «Мотор», я Айгуль, виртуальный помощник. Чем помочь?"], ["caller", "Хочу поменять колодки на Камри, сколько стоит?"],
    ["ai", "Замена тормозных колодок — от двух до трёх с половиной тысяч сом, зависит от колодок. Записать вас?"], ["caller", "Да, на завтра после обеда."],
    ["ai", "Записала на завтра, 14:00. Подтвердим по этому номеру. Хорошего дня!"],
  ] as const;
  let ms = 300;
  const tt = turns.map(([speaker, text], seq) => { const d = Math.max(1200, text.length * 60); const r = { seq, speaker, startMs: ms, endMs: ms + d, text, interrupted: false }; ms += d + 400; return r; });
  return (
    <div data-theme="dark" className="min-h-dvh bg-[#0a0a0a] text-[#ededed]">
      <SiteNav />
      <section className="hero-horizon pb-14 pt-28">
        <div className="mx-auto max-w-[1200px] px-4">
          <h1 className="font-display text-[48px] font-medium leading-none tracking-[-0.035em] text-white">{t("title")}</h1>
          <p className="mt-3 text-[18px] text-white/85">{t("sub")} · {formatDateTime(call.createdAt)} · {formatDuration(call.durationS)}</p>
        </div>
      </section>
      <main className="mx-auto grid max-w-[1200px] grid-cols-1 gap-4 px-4 py-10 lg:grid-cols-[1.4fr_1fr]">
        <DemoRecording title={t("transcript")} role="Автосервис" turns={tt} />
        <div className="flex flex-col gap-4">
          <div className="rounded-[24px] bg-[rgba(212,212,212,0.08)] p-6">
            <p className="font-display text-[18px] font-medium">{t("card")}</p>
            <p className="mt-2 text-[15px] text-[#c2c2c2]">Запись на замену тормозных колодок, Toyota Camry, завтра 14:00. Цена названа по прайсу. Клиент согласился.</p>
          </div>
          <div className="rounded-[24px] bg-white p-6 text-[#161616]">
            <p className="font-display text-[18px] font-medium">{t("lead")} №1284</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[14px]"><dt className="text-[#686868]">Услуга</dt><dd>Замена колодок</dd><dt className="text-[#686868]">Когда</dt><dd>Завтра, 14:00</dd><dt className="text-[#686868]">Статус</dt><dd>Новая</dd></dl>
          </div>
          <Link href={`/signup?phone=${encodeURIComponent(call.caller)}&sphere=autoservice`} className="inline-flex h-12 items-center justify-center rounded-full bg-white text-[15px] font-medium text-[#161616]">{t("connect")}</Link>
          <p className="text-center text-[13px] text-[#686868]">{t("connectSub")}</p>
        </div>
      </main>
    </div>
  );
}
