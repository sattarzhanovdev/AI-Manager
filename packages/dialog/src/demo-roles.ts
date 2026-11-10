import { DEMO_SNAPSHOT } from "./fixtures";
import type { KbSnapshot } from "./snapshot";
export const DEMO_ROLE_KEYS = ["autoservice", "clinic", "salon", "dental", "polyclinic", "other"] as const;
export type DemoRole = typeof DEMO_ROLE_KEYS[number];
const COMPANIES: Record<DemoRole, string> = { autoservice: "Автосервис «Мотор»", clinic: "Медцентр «Ала-Тоо»", salon: "Салон «Лаванда»", dental: "Стоматология «Улыбка»", polyclinic: "Городская поликлиника № 7", other: "Демонстрационная компания" };
const SERVICES: Record<DemoRole, [string, number | null][]> = {
  autoservice: [["Замена масла", 150000], ["Диагностика", 200000]],
  clinic: [["Приём терапевта", 120000], ["Общий анализ крови", 50000]],
  salon: [["Стрижка", 100000], ["Окрашивание", null]],
  dental: [["Консультация стоматолога", 80000], ["Установка винира", null]],
  polyclinic: [["Приём участкового терапевта", 0]],
  other: [["Консультация", null]],
};
/** Fictional, isolated demo facts. No automotive data is reused for medical roles. */
export function demoSnapshot(role: DemoRole): KbSnapshot {
  const base = structuredClone(DEMO_SNAPSHOT);
  base.company = { name: COMPANIES[role], sphere: role, description: "Вымышленная компания для демонстрации. Записи и цены тестовые.", advantages: [] };
  base.style.greeting = `Здравствуйте! ${COMPANIES[role]}, я AI-администратор. Это демонстрация, запись тестовая. Чем помочь?`;
  base.services = SERVICES[role].map(([name, price], i) => ({ id: `${role}-${i}`, name, synonyms: [], priceType: price === null ? "after_inspection" : "exact", priceMin: price ?? undefined, currency: "KGS", durationMin: 30, staff: [] }));
  base.staff = [];
  base.faq = [{ id: `${role}-faq`, question: "Это настоящая компания?", synonyms: [], shortAnswer: "Это вымышленная компания. В демонстрации настоящие записи не создаются." }];
  base.booking = { order: role === "polyclinic" ? "Талонов сейчас нет. Можно оставить заявку в лист ожидания; в демо это симуляция." : "Создаём тестовую заявку. Реальную запись подтверждает администратор." };
  if (["clinic", "dental", "polyclinic"].includes(role)) {
    base.stop.neverPromise = ["Диагноз", "Лечение", "Медицинские рекомендации", "Гарантированное выздоровление"];
    base.stop.topics = ["Диагноз", "Назначение лекарств", "Дозировки"];
  }
  return base;
}
export function detectDemoRole(text: string): DemoRole | undefined {
  const input = text.toLowerCase().trim();
  const digit = /^([1-6])$/.exec(input);
  if (digit) return DEMO_ROLE_KEYS[Number(digit[1]) - 1];
  if (/поликлиник|цсм|участков/.test(input)) return "polyclinic";
  if (/стомат|зуб|дент/.test(input)) return "dental";
  if (/салон|красот|парикмах|стрижк/.test(input)) return "salon";
  if (/автосервис|шиномонтаж|сто\b|мотор|ремонт авто/.test(input)) return "autoservice";
  if (/клиник|медцентр|терапевт/.test(input)) return "clinic";
  if (/универсальн|другой бизнес/.test(input)) return "other";
  return undefined;
}
