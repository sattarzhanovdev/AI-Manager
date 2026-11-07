import { SiteNav } from "@/components/public/site-chrome";

export const metadata = { title: "Ваш бизнес" };

// Фаза 2: «Ваш бизнес» — автозаполнение по ссылке и код для звонка. Страница-заглушка до публичного запуска.
export default function Try() {
  return (
    <div data-theme="dark" className="min-h-dvh bg-[#0a0a0a] text-[#ededed]">
      <SiteNav />
      <main className="mx-auto max-w-[720px] px-4 pt-40 text-center">
        <h1 className="font-display text-[48px] font-medium leading-none tracking-[-0.035em]">Услышьте ассистента своей компании</h1>
        <p className="mt-4 text-[18px] text-[#c2c2c2]">Появится при публичном запуске: вставьте ссылку на сайт или 2ГИС — и позвоните, назвав код.</p>
      </main>
    </div>
  );
}
