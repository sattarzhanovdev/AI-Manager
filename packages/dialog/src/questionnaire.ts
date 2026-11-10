// Схема анкеты компании: 15 блоков, поля с уровнями О/Р/Д, подсказки и примеры (раздел 14).
// Блоки 3, 4, 8 — табличные (услуги, сотрудники, FAQ) и редактируются отдельными редакторами.

export type FieldLevel = "required" | "recommended" | "optional"; // О / Р / Д
export type FieldKind = "text" | "textarea" | "list" | "select" | "hours" | "phones" | "toggle";

export interface FieldDef {
  key: string;
  label: string;
  level: FieldLevel;
  kind: FieldKind;
  hint: string;
  example?: string;
  options?: string[];
  /** Поле обязательно только при условии (например, «для записи») */
  requiredWhen?: "booking" | "has_promo";
}

export interface BlockDef {
  id: number;
  key: string;
  title: string;
  weight: number;
  /** Блок входит в фазу 1а (9 обязательных блоков) */
  phase1a: boolean;
  table?: "services" | "staff" | "faq";
  fields: FieldDef[];
}

export const BLOCKS: BlockDef[] = [
  {
    id: 1, key: "company", title: "Компания", weight: 5, phase1a: true,
    fields: [
      { key: "company.name", label: "Название", level: "required", kind: "text", hint: "Как компанию называют клиенты", example: "Автосервис «Мотор»" },
      { key: "company.name_stress", label: "Ударение в названии", level: "required", kind: "text", hint: "Отметьте ударную гласную заглавной буквой", example: "мОтор" },
      { key: "company.description", label: "Описание", level: "required", kind: "textarea", hint: "2–3 предложения: чем занимаетесь и для кого", example: "Ремонт и обслуживание японских и корейских авто с 2012 года." },
      { key: "company.sphere", label: "Сфера", level: "required", kind: "select", hint: "Определяет шаблон вопросов", options: ["autoservice", "salon", "clinic", "dental", "service", "polyclinic"] },
      { key: "company.advantages", label: "Отличия", level: "recommended", kind: "list", hint: "Почему выбирают вас — по одному пункту в строке", example: "Гарантия 12 месяцев на работы" },
      { key: "company.links", label: "Ссылки", level: "recommended", kind: "list", hint: "Сайт, 2ГИС, Instagram", example: "https://2gis.kg/..." },
      { key: "company.requisites", label: "Реквизиты", level: "optional", kind: "textarea", hint: "Для юрлиц, если спрашивают счёт" },
    ],
  },
  {
    id: 2, key: "branches", title: "Филиалы и график", weight: 10, phase1a: true,
    fields: [
      { key: "branch.address", label: "Адрес", level: "required", kind: "text", hint: "Улица и дом так, как говорят вслух", example: "ул. Ахунбаева, 119" },
      { key: "branch.landmarks", label: "Ориентиры", level: "recommended", kind: "text", hint: "Что рядом, чтобы легко найти", example: "За АЗС «Газпром», синие ворота" },
      { key: "branch.directions", label: "Как добраться", level: "recommended", kind: "textarea", hint: "Транспорт, парковка, въезд" },
      { key: "branch.hours", label: "График по дням", level: "required", kind: "hours", hint: "Часы работы на каждый день недели" },
      { key: "branch.holidays", label: "Праздники", level: "recommended", kind: "list", hint: "Даты и режим работы", example: "31.12 — до 15:00" },
      { key: "branch.phones", label: "Телефоны", level: "required", kind: "phones", hint: "В международном формате", example: "+996 555 123 456" },
    ],
  },
  { id: 3, key: "services", title: "Услуги и цены", weight: 18, phase1a: true, table: "services", fields: [] },
  { id: 4, key: "staff", title: "Сотрудники", weight: 8, phase1a: true, table: "staff", fields: [] },
  {
    id: 5, key: "booking", title: "Запись и правила", weight: 10, phase1a: true,
    fields: [
      { key: "booking.order", label: "Порядок записи", level: "required", kind: "textarea", hint: "Как клиент записывается и что подтверждает", example: "Записываем по телефону, администратор подтверждает за день" },
      { key: "booking.min_lead_time", label: "Минимум до записи", level: "recommended", kind: "text", hint: "За сколько можно записаться", example: "за 2 часа" },
      { key: "booking.cancel", label: "Отмена и перенос", level: "required", kind: "textarea", hint: "Правила отмены и переноса", example: "Бесплатно за 3 часа до визита" },
      { key: "booking.late", label: "Опоздание", level: "recommended", kind: "text", hint: "Что происходит при опоздании", example: "Ждём 15 минут" },
      { key: "booking.prepay", label: "Предоплата", level: "optional", kind: "text", hint: "Нужна ли и сколько" },
      { key: "booking.bring", label: "Что взять с собой", level: "optional", kind: "text", hint: "Документы, вещи", example: "Техпаспорт" },
      { key: "booking.reminder", label: "Напоминание", level: "optional", kind: "text", hint: "Когда и как напоминаете" },
    ],
  },
  {
    id: 6, key: "payment", title: "Оплата и гарантии", weight: 5, phase1a: false,
    fields: [
      { key: "payment.methods", label: "Способы оплаты", level: "required", kind: "list", hint: "Наличные, карта, QR, перевод", example: "Наличные\nMBank QR" },
      { key: "payment.legal", label: "Для юрлиц", level: "optional", kind: "text", hint: "Безнал, договор" },
      { key: "payment.installments", label: "Рассрочка", level: "optional", kind: "text", hint: "Условия" },
      { key: "payment.warranty", label: "Гарантия", level: "recommended", kind: "text", hint: "Срок и условия" },
      { key: "payment.refund", label: "Возврат", level: "recommended", kind: "text", hint: "Как оформляется" },
    ],
  },
  {
    id: 7, key: "promo", title: "Акции", weight: 2, phase1a: false,
    fields: [
      { key: "promo.text", label: "Текст и условия", level: "optional", kind: "textarea", hint: "Действующие акции" },
      { key: "promo.dates", label: "Сроки", level: "optional", kind: "text", hint: "Обязательно при наличии акции", requiredWhen: "has_promo" },
      { key: "promo.loyalty", label: "Лояльность", level: "optional", kind: "text", hint: "Скидки постоянным" },
    ],
  },
  { id: 8, key: "faq", title: "Частые вопросы", weight: 10, phase1a: true, table: "faq", fields: [] },
  {
    id: 9, key: "objections", title: "Возражения", weight: 6, phase1a: false,
    fields: [
      { key: "objections.expensive", label: "«Дорого»", level: "recommended", kind: "textarea", hint: "Смысл ответа, не дословный текст" },
      { key: "objections.cheaper", label: "«У других дешевле»", level: "recommended", kind: "textarea", hint: "Чем отличаетесь" },
      { key: "objections.think", label: "«Подумаю»", level: "recommended", kind: "textarea", hint: "Что предложить" },
      { key: "objections.complaint", label: "Жалоба", level: "recommended", kind: "textarea", hint: "Как реагировать" },
      { key: "objections.irritation", label: "Раздражение", level: "optional", kind: "textarea", hint: "Как успокоить" },
      { key: "objections.mistake", label: "Ошибка компании", level: "optional", kind: "textarea", hint: "Как признать и что предложить" },
    ],
  },
  {
    id: 10, key: "stop", title: "Стоп-темы", weight: 5, phase1a: true,
    fields: [
      { key: "stop.never_promise", label: "Нельзя обещать", level: "required", kind: "list", hint: "Что AI никогда не обещает", example: "Точные сроки ремонта без осмотра" },
      { key: "stop.topics", label: "Не обсуждать", level: "required", kind: "list", hint: "Темы, на которые AI не отвечает", example: "Конкуренты\nПолитика" },
      { key: "stop.reply", label: "Формулировка отказа", level: "required", kind: "text", hint: "Что сказать вместо ответа", example: "Это лучше уточнить у администратора, я передам ваш вопрос." },
      { key: "stop.words", label: "Запретные слова", level: "optional", kind: "list", hint: "Слова, которые AI не произносит" },
    ],
  },
  {
    id: 11, key: "handoff", title: "Передача человеку", weight: 5, phase1a: true,
    fields: [
      { key: "handoff.who", label: "Кому и по каким темам", level: "required", kind: "textarea", hint: "Тема → сотрудник", example: "Гарантия — Бакыт, кузовной ремонт — Эмиль" },
      { key: "handoff.when", label: "Когда", level: "required", kind: "textarea", hint: "Сверх обязательных правил", example: "Если клиент спрашивает про оптовые цены" },
      { key: "handoff.how", label: "Как", level: "required", kind: "select", hint: "Перевод звонка или заявка на перезвон", options: ["transfer", "callback"] },
      { key: "handoff.no_answer", label: "Если никто не ответил", level: "required", kind: "text", hint: "Что сделает AI", example: "Создать срочную заявку и пообещать перезвон в течение 15 минут" },
      { key: "handoff.urgent", label: "Что срочно", level: "recommended", kind: "text", hint: "Какие обращения помечать срочными" },
    ],
  },
  {
    id: 12, key: "style", title: "Манера речи", weight: 4, phase1a: false,
    fields: [
      { key: "style.assistant_name", label: "Имя ассистента", level: "recommended", kind: "text", hint: "Как ассистент представляется", example: "Айгуль" },
      { key: "style.greeting", label: "Приветствие", level: "required", kind: "text", hint: "Обязательно с раскрытием AI", example: "Здравствуйте! Автосервис «Мотор», я Айгуль, виртуальный помощник. Чем помочь?" },
      { key: "style.address", label: "Обращение", level: "recommended", kind: "select", hint: "На «вы» или по имени", options: ["vy", "name"] },
      { key: "style.tone", label: "Тон", level: "recommended", kind: "select", hint: "Как звучит ассистент", options: ["friendly", "business", "warm"] },
      { key: "style.words", label: "Слова компании", level: "optional", kind: "list", hint: "Как вы называете свои услуги" },
      { key: "style.languages", label: "Языки", level: "required", kind: "list", hint: "ru, ky, kk", example: "ru" },
      { key: "style.chat", label: "Стиль в чатах", level: "optional", kind: "text", hint: "Длина, эмодзи" },
    ],
  },
  {
    id: 13, key: "client_data", title: "Данные о клиенте", weight: 4, phase1a: true,
    fields: [
      { key: "client.required", label: "Спросить обязательно", level: "required", kind: "list", hint: "Что AI соберёт в каждой заявке", example: "Имя\nТелефон\nМарка авто" },
      { key: "client.desired", label: "Желательно", level: "recommended", kind: "list", hint: "Если удобно спросить" },
      { key: "client.never", label: "Не спрашивать", level: "recommended", kind: "list", hint: "Что лишнее", example: "Адрес проживания" },
      { key: "client.regular", label: "Постоянный клиент", level: "optional", kind: "text", hint: "Как узнавать и что предлагать" },
    ],
  },
  {
    id: 14, key: "examples", title: "Примеры диалогов", weight: 4, phase1a: false,
    fields: [{ key: "examples.files", label: "Записи или переписки", level: "optional", kind: "list", hint: "3–5 штук; персональные данные маскируются автоматически" }],
  },
  {
    id: 15, key: "sphere", title: "Вопросы сферы", weight: 4, phase1a: false,
    fields: [
      { key: "sphere.brands", label: "С какими марками работаете", level: "optional", kind: "list", hint: "Для автосервиса" },
      { key: "sphere.diagnostics", label: "Диагностика", level: "optional", kind: "text", hint: "Стоимость и длительность" },
      { key: "sphere.parts", label: "Запчасти", level: "optional", kind: "text", hint: "Свои или клиента" },
    ],
  },
];

export const BLOCK_WEIGHTS: Record<number, number> = Object.fromEntries(BLOCKS.map((b) => [b.id, b.weight]));

export type FieldValues = Record<string, unknown>;

export interface TableCounts {
  services: number;
  staff: number;
  faq: number;
}

function filled(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/** Прогресс блока 0..1: обязательные поля весят 2, рекомендуемые 1, дополнительные 0.5 */
export function blockProgress(block: BlockDef, values: FieldValues, counts: TableCounts): number {
  if (block.table === "services") return Math.min(1, counts.services / 5);
  if (block.table === "staff") return Math.min(1, counts.staff / 2);
  if (block.table === "faq") return Math.min(1, counts.faq / 10);
  const w = { required: 2, recommended: 1, optional: 0.5 } as const;
  let total = 0;
  let got = 0;
  for (const f of block.fields) {
    total += w[f.level];
    if (filled(values[f.key])) got += w[f.level];
  }
  return total === 0 ? 0 : got / total;
}

/** Индекс полноты 0..100 по весам блоков */
export function completeness(values: FieldValues, counts: TableCounts, phase: "1a" | "1b" = "1b"): number {
  const blocks = phase === "1a" ? BLOCKS.filter((b) => b.phase1a) : BLOCKS;
  const totalWeight = blocks.reduce((s, b) => s + b.weight, 0);
  const score = blocks.reduce((s, b) => s + b.weight * blockProgress(b, values, counts), 0);
  return Math.round((score / totalWeight) * 100);
}

export interface MissingField {
  block: number;
  key: string;
  label: string;
}

/** Обязательные поля, без которых публикация невозможна */
export function missingRequired(values: FieldValues, counts: TableCounts, phase: "1a" | "1b" = "1b"): MissingField[] {
  const out: MissingField[] = [];
  for (const b of BLOCKS) {
    if (phase === "1a" && !b.phase1a) continue;
    if (b.table === "services" && counts.services === 0) out.push({ block: b.id, key: "services", label: "Хотя бы одна услуга" });
    if (b.table === "faq" && counts.faq < 10) out.push({ block: b.id, key: "faq", label: "Минимум 10 частых вопросов" });
    for (const f of b.fields) {
      if (f.level === "required" && !f.requiredWhen && !filled(values[f.key])) out.push({ block: b.id, key: f.key, label: f.label });
    }
  }
  return out;
}
