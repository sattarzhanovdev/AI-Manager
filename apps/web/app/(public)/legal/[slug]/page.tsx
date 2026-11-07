import { notFound } from "next/navigation";
import { SiteNav, SiteFooter } from "@/components/public/site-chrome";

const DOCS: Record<string, { title: string; body: string[] }> = {
  offer: { title: "Публичная оферта", body: ["Настоящая оферта определяет условия оказания услуг платформы ALL-менеджер.", "Тарифы, лимиты и порядок оплаты указаны на странице «Тарифы». Текст подлежит юридической вычитке до запуска продаж."] },
  privacy: { title: "Политика обработки персональных данных", body: ["Мы обрабатываем данные звонящих по поручению компаний-клиентов: аудио, расшифровки, телефон.", "Данные не используются для обучения AI без явного согласия. Удаление — по запросу через компанию или поддержку."] },
  demoTerms: { title: "Условия демо-линии", body: ["Демо-звонок записывается. Длительность до 15 минут, не более 5 звонков с номера в сутки.", "SMS со ссылкой на результат отправляется только с вашего согласия."] },
  dpa: { title: "Соглашение об обработке данных (DPA)", body: ["Определяет роли сторон: компания — оператор, ALL-менеджер — обработчик.", "Хранение — в приватном хранилище, доступ по подписанным ссылкам на 15 минут."] },
};

export default async function Legal({ params }: { params: Promise<{ slug: string }> }) {
  const doc = DOCS[(await params).slug];
  if (!doc) notFound();
  return (
    <div data-theme="dark" className="min-h-dvh bg-[#0a0a0a] text-[#ededed]">
      <SiteNav />
      <main className="mx-auto max-w-[720px] px-4 pb-24 pt-32">
        <h1 className="font-display text-[40px] font-medium leading-tight tracking-[-0.035em]">{doc.title}</h1>
        {doc.body.map((p) => <p key={p} className="mt-5 text-[16px] leading-7 text-[#c2c2c2]">{p}</p>)}
      </main>
      <SiteFooter />
    </div>
  );
}
