import type { KbSnapshot } from "./snapshot";

/** Снимок демо-компании «Автосервис Мотор» — для демо-линии, eval и тестов */
export const DEMO_SNAPSHOT: KbSnapshot = {
  version: 12,
  company: {
    name: "Мотор",
    nameStress: "мОтор",
    sphere: "autoservice",
    description: "Ремонт и обслуживание японских и корейских автомобилей с 2012 года.",
    advantages: ["Гарантия 12 месяцев на работы", "Оригинальные запчасти", "Комната ожидания с кофе"],
  },
  branches: [
    {
      id: "b1", name: "Ахунбаева", address: "ул. Ахунбаева, 119", landmarks: "за АЗС «Газпром», синие ворота",
      hours: { mon: [["09:00", "19:00"]], tue: [["09:00", "19:00"]], wed: [["09:00", "19:00"]], thu: [["09:00", "19:00"]], fri: [["09:00", "19:00"]], sat: [["10:00", "16:00"]], sun: [] },
      phones: ["+996555123456"],
    },
  ],
  services: [
    { id: "s1", name: "Замена масла", synonyms: ["масло", "поменять масло", "замена моторного масла"], priceType: "exact", priceMin: 150000, currency: "KGS", durationMin: 30, staff: ["Бакыт"] },
    { id: "s2", name: "Компьютерная диагностика", synonyms: ["диагностика", "проверить ошибки", "чек"], priceType: "exact", priceMin: 120000, currency: "KGS", durationMin: 40, staff: ["Эмиль"] },
    { id: "s3", name: "Замена тормозных колодок", synonyms: ["колодки", "тормоза"], priceType: "range", priceMin: 200000, priceMax: 350000, currency: "KGS", durationMin: 60, staff: ["Бакыт"] },
    { id: "s4", name: "Ремонт двигателя", synonyms: ["двигатель", "мотор стучит", "капремонт"], priceType: "after_inspection", currency: "KGS", durationMin: 480, staff: ["Эмиль"] },
    { id: "s5", name: "Шиномонтаж", synonyms: ["переобуть", "шины", "колёса", "резина"], priceType: "range", priceMin: 80000, priceMax: 160000, currency: "KGS", durationMin: 40, staff: [] },
    { id: "s6", name: "Развал-схождение", synonyms: ["развал", "сход-развал"], priceType: "exact", priceMin: 180000, currency: "KGS", durationMin: 45, staff: [] },
  ],
  staff: [
    { id: "st1", name: "Бакыт", specialties: ["Слесарь", "ТО"], transferPhone: "+996555000111" },
    { id: "st2", name: "Эмиль", specialties: ["Диагност", "Моторист"], transferPhone: "+996555000222" },
  ],
  faq: [
    { id: "f1", question: "Есть ли у вас гарантия?", synonyms: ["гарантия на работу"], shortAnswer: "Да, на все работы гарантия 12 месяцев." },
    { id: "f2", question: "Можно ли со своими запчастями?", synonyms: ["свои запчасти", "мои запчасти"], shortAnswer: "Да, можно, но гарантия тогда только на работу." },
    { id: "f3", question: "Есть ли комната ожидания?", synonyms: ["где подождать", "подождать"], shortAnswer: "Да, есть комната ожидания с кофе и Wi-Fi." },
    { id: "f4", question: "Работаете ли с Lexus?", synonyms: ["лексус", "тойота", "японские"], shortAnswer: "Да, обслуживаем японские и корейские автомобили, включая Lexus и Toyota." },
    { id: "f5", question: "Как оплатить?", synonyms: ["оплата картой", "QR", "наличные"], shortAnswer: "Наличными, картой или по QR MBank." },
    { id: "f6", question: "Нужно ли записываться заранее?", synonyms: ["без записи", "живая очередь"], shortAnswer: "Лучше записаться: так не придётся ждать. Без записи примем, если есть свободный мастер." },
    { id: "f7", question: "Сколько длится замена масла?", synonyms: ["долго ли менять масло"], shortAnswer: "Около 30 минут." },
    { id: "f8", question: "Есть ли эвакуатор?", synonyms: ["эвакуатор", "машина не заводится"], shortAnswer: "Своего эвакуатора нет, можем подсказать партнёров." },
    { id: "f9", question: "Есть ли парковка?", synonyms: ["где оставить машину"], shortAnswer: "Да, у ворот бесплатная парковка." },
    { id: "f10", question: "Делаете ли кузовной ремонт?", synonyms: ["покраска", "кузов", "вмятина"], shortAnswer: "Нет, кузовной ремонт и покраску мы не делаем." },
  ],
  booking: { order: "Записываем по телефону, администратор подтверждает за день", cancel: "Отмена бесплатно за 3 часа", late: "Ждём 15 минут" },
  stop: { neverPromise: ["Точные сроки ремонта без осмотра"], topics: ["политик", "конкурент"], reply: "Это лучше уточнить у администратора, я передам ваш вопрос.", words: [] },
  handoff: { who: "Гарантия — Бакыт, двигатель — Эмиль", when: "Оптовые заказы, корпоративный парк", how: "transfer", noAnswer: "Срочная заявка и перезвон за 15 минут" },
  style: { assistantName: "Айгуль", greeting: "Здравствуйте! Автосервис «Мотор», я Айгуль, виртуальный помощник. Чем помочь?", address: "Обращайся на «вы»", tone: "friendly", words: [], languages: ["ru"] },
  client: { required: ["Имя", "Телефон", "Марка авто"], never: ["Адрес проживания"] },
  objections: { "«Дорого»": "Объяснить, что цена включает гарантию 12 месяцев и оригинальные запчасти." },
  emergencyNumber: "103",
};
