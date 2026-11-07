import { getTranslations } from "next-intl/server";
import { SiteNav, SiteFooter } from "@/components/public/site-chrome";
import { MinutesCalculator } from "@/components/public/minutes-calculator";
import { getPlans } from "@/lib/data/queries";
import { formatMoney } from "@/lib/format";

export const metadata = { title: "Тарифы" };

export default async function Pricing() {
  const t = await getTranslations("pricing");
  const plans = getPlans();
  return (
    <div data-theme="dark" className="min-h-dvh bg-[#0a0a0a] text-[#ededed]">
      <SiteNav />
      <main className="mx-auto max-w-[1200px] px-4 pb-24 pt-32">
        <h1 className="font-display text-[48px] font-medium leading-none tracking-[-0.035em]">{t("title")}</h1>
        <table className="mt-10 w-full text-[15px]">
          <thead><tr className="[&>th]:border-b [&>th]:border-white/10 [&>th]:py-3 [&>th]:text-left [&>th]:font-normal [&>th]:text-[#686868]"><th />{plans.map((p) => <th key={p.key} className="font-display !text-[18px] !text-[#ededed]">{p.name}</th>)}</tr></thead>
          <tbody className="[&_td]:border-b [&_td]:border-white/10 [&_td]:py-3">
            <tr><td className="text-[#c2c2c2]">Цена в месяц</td>{plans.map((p) => <td key={p.key} className="tabular-nums">{formatMoney(p.priceMinor, p.currency)}</td>)}</tr>
            <tr><td className="text-[#c2c2c2]">Минуты</td>{plans.map((p) => <td key={p.key} className="tabular-nums">{p.minutes.toLocaleString("ru-RU")}</td>)}</tr>
            <tr><td className="text-[#c2c2c2]">Линии</td>{plans.map((p) => <td key={p.key} className="tabular-nums">{p.lines}</td>)}</tr>
            <tr><td className="text-[#c2c2c2]">AI-диалоги в чатах</td>{plans.map((p) => <td key={p.key} className="tabular-nums">{p.aiDialogs || "—"}</td>)}</tr>
            <tr><td className="text-[#c2c2c2]">Режимы</td>{plans.map((p) => <td key={p.key}>{p.modes.length}</td>)}</tr>
          </tbody>
        </table>
        <section className="mt-16 grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div><h2 className="font-display text-[32px] font-semibold tracking-[-0.02em]">{t("calc")}</h2><MinutesCalculator plans={plans.map((p) => ({ name: p.name, minutes: p.minutes }))} /></div>
          <div><h2 className="font-display text-[32px] font-semibold tracking-[-0.02em]">{t("faq")}</h2>
            <dl className="mt-6 flex flex-col gap-5 text-[16px]">
              <div><dt className="font-medium">Как оплатить?</dt><dd className="text-[#c2c2c2]">По счёту для юрлиц и ИП. Карта — при публичном запуске.</dd></div>
              <div><dt className="font-medium">Что если минуты закончатся?</dt><dd className="text-[#c2c2c2]">Вы выбираете: оплачивать перерасход с потолком суммы или перевести AI в режим «Только заявки».</dd></div>
              <div><dt className="font-medium">Есть пробный период?</dt><dd className="text-[#c2c2c2]">Нет — позвоните на демо-линию и услышьте продукт сами.</dd></div>
            </dl>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
