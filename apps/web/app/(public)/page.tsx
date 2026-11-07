import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Check, Car, Stethoscope, Scissors, Smile, Hospital, ArrowRight } from "lucide-react";
import type { CallTurn } from "@all/db";
import { SiteNav, StatusBanner, SiteFooter } from "@/components/public/site-chrome";
import { BrowserCallButton, DemoRecording } from "@/components/public/demo-widgets";
import { getPlans } from "@/lib/data/queries";
import { formatMoney } from "@/lib/format";

export const metadata = { title: "ALL-менеджер — AI-администратор для звонков", description: "AI отвечает на звонки как живой человек: консультирует, записывает, передаёт сложное команде." };

const DEMO_NUMBER = "+996 312 900 900";

function turns(lines: [CallTurn["speaker"], string][]): CallTurn[] {
  let ms = 300;
  return lines.map(([speaker, text], seq) => {
    const d = Math.max(1100, text.length * 60);
    const t = { seq, speaker, startMs: ms, endMs: ms + d, text, interrupted: false, latencyMs: speaker === "ai" ? 560 + ((seq * 97) % 300) : undefined };
    ms += d + 450;
    return t;
  });
}

const RECORDINGS = [
  { title: "Запись на замену масла", role: "Автосервис", turns: turns([["ai", "Здравствуйте! Автосервис «Мотор», я Айгуль, виртуальный помощник. Чем помочь?"], ["caller", "Сколько у вас стоит поменять масло?"], ["ai", "Замена масла — полторы тысячи сом, около получаса. Записать вас?"], ["caller", "Давайте на субботу утром."], ["ai", "Есть суббота в 10 и в 11. Как удобнее?"], ["caller", "В одиннадцать."], ["ai", "Записала на субботу, 11:00. Как к вам обращаться?"]]) },
  { title: "Клиника: перевод к врачу", role: "Клиника", turns: turns([["ai", "Клиника «Здоровье», я Алина, виртуальный ассистент. Слушаю вас."], ["caller", "У ребёнка температура тридцать девять, что делать?"], ["ai", "Это лучше обсудить с врачом. Сейчас переведу вас на дежурного педиатра."], ["caller", "Хорошо, спасибо."]]) },
];

export default async function Landing() {
  const t = await getTranslations("landing");
  const bullets = t.raw("bullets") as string[];
  const how = t.raw("how") as [string, string][];
  const niches = t.raw("niches") as string[];
  const handles = t.raw("handles") as string[];
  const faq = t.raw("faq") as [string, string][];
  const plans = getPlans();
  const roles = [{ k: "Автосервис", i: Car }, { k: "Клиника", i: Stethoscope }, { k: "Салон красоты", i: Scissors }, { k: "Стоматология", i: Smile }, { k: "Поликлиника", i: Hospital }];

  return (
    <div data-theme="dark" className="min-h-dvh bg-[#0a0a0a] text-[#ededed] [font-size:16px] [line-height:1.5]">
      <SiteNav />
      {/* Герой: тёплый → холодный горизонт, 72px/500, буллеты, белая пилюля, макет устройства справа */}
      <section className="hero-horizon relative overflow-hidden pb-0 pt-28">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-end gap-10 px-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="flex flex-col gap-7 pb-16">
            <div className="lg:mr-auto"><StatusBanner /></div>
            <h1 className="font-display text-[44px] font-medium leading-[1] tracking-[-0.035em] text-white sm:text-[60px] lg:text-[72px]">{t("heroTitle")}</h1>
            <p className="max-w-xl text-[18px] leading-[1.5] text-white/85">{t("heroSub")}</p>
            <div className="flex flex-col gap-3">
              <p className="text-[13px] uppercase tracking-[0.08em] text-white/70">{t("demoNumber")}</p>
              <a href={`tel:${DEMO_NUMBER.replace(/\s/g, "")}`} className="font-display text-[40px] font-medium leading-none tracking-[-0.035em] text-white hover:opacity-90">{DEMO_NUMBER}</a>
              <div className="mt-2 flex flex-wrap gap-2">
                <BrowserCallButton label={t("callBrowser")} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-medium text-[#161616] hover:bg-white/90" />
                <Link href="/signup" className="inline-flex h-11 items-center gap-2 rounded-full border border-white/30 px-5 text-[15px] text-white/90 hover:bg-white/10">{t("nav.cta")}<ArrowRight className="size-4" /></Link>
              </div>
            </div>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {bullets.map((b) => <li key={b} className="flex items-center gap-3 text-[16px] text-white/90"><span className="flex size-5 items-center justify-center rounded-[4px] bg-white"><Check className="size-3.5 text-black" /></span>{b}</li>)}
            </ul>
          </div>
          {/* Device Mockup Frame: скругление 40px сверху, низ в край */}
          <div className="relative hidden self-end lg:block">
            <div className="overflow-hidden rounded-t-[40px] border border-b-0 border-white/20 bg-[#0a0a0a] p-2 pb-0 shadow-[0_-20px_80px_rgba(0,0,0,0.35)]">
              <ProductMock />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-20">
        <h2 className="font-display text-[32px] font-semibold tracking-[-0.02em] text-[#ededed] sm:text-[36px]">{t("rolesTitle")}</h2>
        <p className="mt-2 text-[18px] text-[#c2c2c2]">{t("rolesSub")}</p>
        <div className="mt-8 flex flex-wrap gap-2">
          {roles.map(({ k, i: Icon }) => <span key={k} className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-white/15 px-3 text-[14px] text-[#b2b2b2]"><Icon className="size-4" />{k}</span>)}
        </div>
        <h3 className="mt-16 font-display text-[24px] font-medium tracking-[-0.01em]">{t("recordingsTitle")}</h3>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {RECORDINGS.map((r) => <DemoRecording key={r.title} {...r} />)}
        </div>
      </section>

      {/* Dusk Violet — единственный хроматический акцент, полосой */}
      <div className="glow-line mx-auto max-w-[1200px]" aria-hidden />

      <section id="how" className="mx-auto grid max-w-[1200px] grid-cols-1 gap-12 px-4 py-20 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-[36px] font-medium tracking-[-0.02em]">{t("howTitle")}</h2>
          <ol className="mt-8 flex flex-col gap-6">
            {how.map(([h, d], i) => (
              <li key={h} className="flex gap-4"><span className="font-display text-[14px] tabular-nums text-[#686868]">0{i + 1}</span><div><p className="text-[18px] font-medium">{h}</p><p className="mt-1 text-[16px] text-[#c2c2c2]">{d}</p></div></li>
            ))}
          </ol>
        </div>
        <div>
          <h2 className="font-display text-[36px] font-medium tracking-[-0.02em]">{t("handlesTitle")}</h2>
          <ol className="mt-8 flex flex-col gap-5">
            {handles.map((h, i) => <li key={h} className="flex items-baseline justify-between gap-4 text-[16px]"><span className="text-[#ededed]">{h}</span><span className="tabular-nums text-[#c2c2c2]">{String(i + 1).padStart(2, "0")}</span></li>)}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-10">
        <h2 className="font-display text-[32px] font-semibold tracking-[-0.02em]">{t("nichesTitle")}</h2>
        <div className="mt-6 flex flex-wrap gap-2">{niches.map((n) => <span key={n} className="rounded-full border border-white/15 px-4 py-1.5 text-[14px] text-white/85">{n}</span>)}</div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-20">
        <h2 className="font-display text-[36px] font-medium tracking-[-0.02em]">{t("pricingTitle")}</h2>
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {plans.map((p, i) => (
            <div key={p.key} className={`flex flex-col gap-4 rounded-[24px] p-7 ${i === 1 ? "bg-white text-[#161616]" : "bg-[rgba(212,212,212,0.08)]"}`}>
              <p className="font-display text-[24px] font-medium">{p.name}</p>
              <p className="font-display text-[40px] font-medium leading-none tracking-[-0.035em]">{formatMoney(p.priceMinor, p.currency)}<span className="text-[15px] font-normal opacity-60"> / мес</span></p>
              <ul className={`flex flex-col gap-2 text-[15px] ${i === 1 ? "text-[#3d3d3d]" : "text-[#c2c2c2]"}`}>
                <li>{p.minutes.toLocaleString("ru-RU")} минут</li><li>{p.lines} {p.lines === 1 ? "линия" : "линии"}</li><li>{p.aiDialogs ? `${p.aiDialogs.toLocaleString("ru-RU")} AI-диалогов` : "Только голос"}</li>
              </ul>
              <Link href="/signup" className={`mt-auto inline-flex h-10 w-fit items-center rounded-full px-4 text-[14px] font-medium ${i === 1 ? "bg-[#161616] text-white" : "bg-white text-[#161616]"}`}>{t("nav.cta")}</Link>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pb-24">
        <h2 className="font-display text-[36px] font-medium tracking-[-0.02em]">{t("faqTitle")}</h2>
        <div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-8 md:grid-cols-2">
          {faq.map(([q, a]) => <div key={q}><p className="text-[18px] font-medium">{q}</p><p className="mt-2 text-[16px] text-[#c2c2c2]">{a}</p></div>)}
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}

/** Схематичный экран кабинета внутри макета устройства */
function ProductMock() {
  const rows = [["Замена масла, суббота 11:00", "Новая"], ["Диагностика, завтра 10:00", "В работе"], ["Жалоба: ремонт подвески", "Срочно"], ["Шиномонтаж, сегодня 17:00", "Новая"], ["Развал-схождение", "Успешно"]];
  return (
    <div className="rounded-t-[32px] bg-[#0f0f0f] text-[12px] text-[#ededed]">
      <div className="flex h-10 items-center gap-2 border-b border-white/10 px-5"><span className="size-2 rounded-full bg-[#3ccb7f]" /><span className="text-white/60">AI:</span> Включён<span className="ml-auto text-white/40">Заявки</span></div>
      <div className="grid grid-cols-3 gap-2 p-4">
        {[["Звонков сегодня", "56"], ["Новые заявки", "14"], ["Анкета", "91%"]].map(([l, v]) => <div key={l} className="rounded-[10px] border border-white/10 p-2.5"><p className="text-white/50">{l}</p><p className="font-display text-[20px]">{v}</p></div>)}
      </div>
      <ul className="px-4 pb-6">
        {rows.map(([a, s]) => <li key={a} className="flex h-9 items-center border-b border-white/10"><span className="flex-1 truncate">{a}</span><span className={`rounded-full px-2 py-0.5 text-[11px] ${s === "Срочно" ? "bg-[rgba(248,113,113,0.12)] text-[#f87171]" : s === "Успешно" ? "bg-[rgba(60,203,127,0.12)] text-[#3ccb7f]" : "bg-white/10 text-white/70"}`}>{s}</span></li>)}
      </ul>
    </div>
  );
}
