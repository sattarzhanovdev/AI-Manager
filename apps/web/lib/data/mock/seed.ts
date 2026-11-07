// Демо-данные кабинета (DATA_SOURCE=mock): автосервис «Мотор», Бишкек.
// Генерация детерминированная, чтобы скриншоты и e2e были стабильны.
import type {
  AppNotification, AuditEntry, Branch, Call, CallFlag, CallOutcome, CallTurn, CallType, Company, Contact, Faq,
  Integration, IntegrationLog, Invoice, Lead, LeadEvent, LeadStatus, LeadType, Member, Plan, Service, StaffMember,
  UnansweredQuestion,
} from "@all/db";
import type { FieldValues } from "@all/dialog";
import type {
  AdminCompany, ApiKey, AssistantSettings, DemoCall, DemoLead, ModerationItem, NotificationPref, PhoneNumber,
} from "../types";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(42);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
const chance = (p: number) => r() < p;
const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
let idn = 0;
const uid = (p: string) => `${p}_${(++idn).toString(36).padStart(5, "0")}`;

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const company: Company = {
  id: "co_motor", name: "Автосервис «Мотор»", sphere: "autoservice", timezone: "Asia/Bishkek", currency: "KGS", aiMode: "on", status: "active",
};

export const branches: Branch[] = [
  {
    id: "br_1", name: "Ахунбаева", address: "ул. Ахунбаева, 119", landmarks: "за АЗС «Газпром», синие ворота",
    hours: { mon: [["09:00", "19:00"]], tue: [["09:00", "19:00"]], wed: [["09:00", "19:00"]], thu: [["09:00", "19:00"]], fri: [["09:00", "19:00"]], sat: [["10:00", "16:00"]], sun: [] },
    phones: ["+996555123456"],
  },
  {
    id: "br_2", name: "Джал", address: "мкр. Джал-23, ул. Малдыбаева, 7/1", landmarks: "напротив ТЦ «Джал»",
    hours: { mon: [["09:00", "20:00"]], tue: [["09:00", "20:00"]], wed: [["09:00", "20:00"]], thu: [["09:00", "20:00"]], fri: [["09:00", "20:00"]], sat: [["09:00", "18:00"]], sun: [["10:00", "15:00"]] },
    phones: ["+996555123457"],
  },
];

export const members: Member[] = [
  { id: "m_owner", userId: "u_owner", name: "Азамат Токтогулов", email: "azamat@motor.kg", phone: "+996555100100", role: "owner", permissions: {}, branchIds: ["br_1", "br_2"], telegramLinked: true, lastSeenAt: iso(5 * MIN) },
  { id: "m_admin", userId: "u_admin", name: "Айжан Бекова", email: "aizhan@motor.kg", phone: "+996555100200", role: "admin", permissions: { edit_questionnaire: true }, branchIds: ["br_1"], transferPhone: "+996555100200", telegramLinked: true, lastSeenAt: iso(40 * MIN) },
  { id: "m_staff1", userId: "u_staff1", name: "Бакыт Осмонов", phone: "+996555000111", role: "staff", permissions: {}, branchIds: ["br_1"], transferPhone: "+996555000111", telegramLinked: true, lastSeenAt: iso(3 * HOUR) },
  { id: "m_staff2", userId: "u_staff2", name: "Эмиль Жумабаев", phone: "+996555000222", role: "staff", permissions: {}, branchIds: ["br_2"], transferPhone: "+996555000222", telegramLinked: false, lastSeenAt: iso(DAY) },
  { id: "m_acc", userId: "u_acc", name: "Гульмира Асанова", email: "buh@motor.kg", role: "accountant", permissions: {}, branchIds: [], telegramLinked: false, lastSeenAt: iso(4 * DAY) },
];

export const numbers: PhoneNumber[] = [
  { id: "num_1", e164: "+996312900100", branchId: "br_1", kind: "forwarding", receive: "no_answer", noAnswerSeconds: 15, lines: 2 },
  { id: "num_2", e164: "+996312900200", branchId: "br_2", kind: "platform", receive: "always", lines: 1 },
];

export const services: Service[] = [
  ["Замена масла", ["масло", "поменять масло"], "exact", 150000, undefined, 30],
  ["Компьютерная диагностика", ["диагностика", "проверить ошибки"], "exact", 120000, undefined, 40],
  ["Замена тормозных колодок", ["колодки", "тормоза"], "range", 200000, 350000, 60],
  ["Ремонт двигателя", ["двигатель", "капремонт"], "after_inspection", undefined, undefined, 480],
  ["Шиномонтаж", ["переобуть", "шины", "резина"], "range", 80000, 160000, 40],
  ["Развал-схождение", ["развал", "сход-развал"], "exact", 180000, undefined, 45],
  ["Замена ремня ГРМ", ["ремень грм", "грм"], "range", 600000, 1200000, 180],
  ["Замена свечей зажигания", ["свечи"], "exact", 90000, undefined, 30],
  ["Ремонт подвески", ["подвеска", "стучит подвеска", "ходовая"], "after_inspection", undefined, undefined, 120],
  ["Заправка кондиционера", ["кондиционер", "фреон"], "exact", 250000, undefined, 40],
  ["Замена антифриза", ["антифриз", "охлаждающая жидкость"], "exact", 130000, undefined, 40],
  ["Чистка инжектора", ["инжектор", "форсунки"], "range", 250000, 400000, 90],
  ["Замена аккумулятора", ["аккумулятор", "акб"], "exact", 50000, undefined, 20],
  ["Ремонт АКПП", ["коробка", "акпп", "автомат"], "after_inspection", undefined, undefined, 600],
].map(([name, synonyms, priceType, priceMin, priceMax, durationMin], i) => ({
  id: `sv_${i + 1}`, name: name as string, synonyms: synonyms as string[], priceType: priceType as Service["priceType"],
  priceMin: priceMin as number | undefined, priceMax: priceMax as number | undefined, currency: "KGS" as const,
  durationMin: durationMin as number, staffIds: i % 2 ? ["st_2"] : ["st_1"], branchIds: ["br_1", "br_2"], active: i !== 13,
}));

export const staff: StaffMember[] = [
  { id: "st_1", name: "Бакыт", specialties: ["Слесарь", "ТО"], serviceIds: ["sv_1", "sv_3", "sv_5"], branchId: "br_1", hours: { mon: [["09:00", "18:00"]], tue: [["09:00", "18:00"]], wed: [["09:00", "18:00"]], thu: [["09:00", "18:00"]], fri: [["09:00", "18:00"]] }, languages: ["ru", "ky"], transferPhone: "+996555000111", bookable: true },
  { id: "st_2", name: "Эмиль", specialties: ["Диагност", "Моторист"], serviceIds: ["sv_2", "sv_4"], branchId: "br_2", hours: { mon: [["10:00", "19:00"]], wed: [["10:00", "19:00"]], fri: [["10:00", "19:00"]], sat: [["10:00", "16:00"]] }, languages: ["ru"], transferPhone: "+996555000222", bookable: true },
  { id: "st_3", name: "Руслан", specialties: ["Шиномонтаж"], serviceIds: ["sv_5", "sv_6"], branchId: "br_1", hours: { sat: [["10:00", "16:00"]], sun: [] }, languages: ["ru", "ky"], bookable: true },
  { id: "st_4", name: "Айжан", specialties: ["Администратор"], serviceIds: [], branchId: "br_1", hours: {}, languages: ["ru", "ky", "en"], transferPhone: "+996555100200", bookable: false },
];

export const faq: Faq[] = [
  ["Есть ли у вас гарантия?", "Да, на все работы гарантия 12 месяцев."],
  ["Можно ли со своими запчастями?", "Да, можно, но гарантия тогда только на работу."],
  ["Есть ли комната ожидания?", "Да, есть комната ожидания с кофе и Wi-Fi."],
  ["Работаете ли с Lexus?", "Да, обслуживаем японские и корейские автомобили, включая Lexus и Toyota."],
  ["Как оплатить?", "Наличными, картой или по QR MBank."],
  ["Нужно ли записываться заранее?", "Лучше записаться, так не придётся ждать."],
  ["Сколько длится замена масла?", "Около 30 минут."],
  ["Есть ли эвакуатор?", "Своего эвакуатора нет, подскажем партнёров."],
  ["Есть ли парковка?", "Да, у ворот бесплатная парковка."],
  ["Делаете ли кузовной ремонт?", "Нет, кузовной ремонт и покраску мы не делаем."],
  ["Работаете ли в воскресенье?", "Филиал на Джале работает в воскресенье с 10 до 15."],
  ["Даёте ли акт выполненных работ?", "Да, акт и чек выдаём всегда."],
].map(([q, a], i) => ({ id: `fq_${i + 1}`, question: q!, synonyms: [], shortAnswer: a!, longAnswer: a, source: "manual", active: true }));

export const questionnaireFields: FieldValues = {
  "company.name": "Мотор",
  "company.name_stress": "мОтор",
  "company.description": "Ремонт и обслуживание японских и корейских автомобилей с 2012 года. Два филиала в Бишкеке.",
  "company.sphere": "autoservice",
  "company.advantages": "Гарантия 12 месяцев на работы\nОригинальные запчасти\nКомната ожидания с кофе",
  "company.links": "https://motor.kg\nhttps://2gis.kg/bishkek/firm/motor",
  "branch.address": "ул. Ахунбаева, 119",
  "branch.landmarks": "за АЗС «Газпром», синие ворота",
  "branch.hours": { mon: [["09:00", "19:00"]], tue: [["09:00", "19:00"]], wed: [["09:00", "19:00"]], thu: [["09:00", "19:00"]], fri: [["09:00", "19:00"]], sat: [["10:00", "16:00"]], sun: [] },
  "branch.phones": "+996555123456",
  "booking.order": "Записываем по телефону, администратор подтверждает за день до визита.",
  "booking.cancel": "Отмена и перенос бесплатно за 3 часа до визита.",
  "booking.late": "Ждём 15 минут, потом предлагаем другое время.",
  "booking.bring": "Техпаспорт",
  "stop.never_promise": "Точные сроки ремонта без осмотра\nНаличие запчастей без проверки",
  "stop.topics": "Конкуренты\nПолитика",
  "stop.reply": "Это лучше уточнить у администратора, я передам ваш вопрос.",
  "handoff.who": "Гарантия — Бакыт, двигатель и АКПП — Эмиль, остальное — Айжан",
  "handoff.when": "Оптовые заказы, корпоративный автопарк",
  "handoff.how": "transfer",
  "handoff.no_answer": "Создать срочную заявку и пообещать перезвон в течение 15 минут",
  "client.required": "Имя\nТелефон\nМарка авто",
  "client.never": "Адрес проживания",
  "style.assistant_name": "Айгуль",
  "style.greeting": "Здравствуйте! Автосервис «Мотор», я Айгуль, виртуальный помощник. Чем помочь?",
  "style.tone": "friendly",
  "style.languages": "ru",
  "payment.methods": "Наличные\nКарта\nQR MBank",
};

export const fieldSources: Record<string, string> = {
  "company.description": "autofill_site", "company.links": "autofill_2gis", "branch.address": "autofill_2gis", "branch.landmarks": "autofill_2gis",
};

export const unanswered: UnansweredQuestion[] = [
  ["Ставите ли газовое оборудование?", 9], ["Есть ли рассрочка на ремонт?", 6], ["Меняете ли лобовое стекло?", 5],
  ["Работаете ли с Mercedes?", 4], ["Можно ли оплатить по безналу для ИП?", 3], ["Есть ли скидка пенсионерам?", 2], ["Делаете ли химчистку салона?", 2],
].map(([text, count], i) => ({ id: `uq_${i + 1}`, text: text as string, count: count as number, lastSeenAt: iso(int(1, 72) * HOUR), resolved: false }));

const FIRST = ["Азамат", "Нурлан", "Айбек", "Эрлан", "Бакыт", "Тимур", "Данияр", "Айгерим", "Жылдыз", "Айпери", "Нургуль", "Марат", "Улан", "Кубат", "Чынгыз", "Сезим", "Алина", "Руслан", "Дастан", "Эмиль", "Мирлан", "Асель", "Бектур", "Самат"];
const LAST = ["Токтогулов", "Асанов", "Мамытов", "Садыков", "Исаков", "Абдыкадыров", "Жээнбеков", "Осмонов", "Шамшиев", "Каримов", "Бекмуратов", "Турдубаев"];
const CARS = ["Toyota Camry", "Lexus RX 350", "Honda Fit", "Hyundai Sonata", "Kia K5", "Toyota Prius", "Subaru Forester", "Mazda 6", "Toyota Land Cruiser", "Hyundai Tucson"];

export const contacts: Contact[] = Array.from({ length: 160 }, (_, i) => {
  const first = pick(FIRST);
  const female = /а$|ь$|ул$|ым$|ел$/.test(first) && !["Мирлан", "Нурлан", "Эмиль", "Улан"].includes(first);
  const last = pick(LAST) + (female ? "а" : "");
  const known = chance(0.82);
  return {
    id: `ct_${i + 1}`,
    phone: `+99655${String(5000000 + i * 7919).slice(0, 7)}`,
    name: known ? `${first} ${last}` : undefined,
    channels: ["phone", ...(chance(0.2) ? ["telegram"] : [])],
    tags: chance(0.1) ? ["vip"] : chance(0.06) ? ["complaint"] : [],
    notes: chance(0.15) ? `${pick(CARS)}, ${int(2008, 2022)} г.` : undefined,
    lastSeenAt: iso(int(1, 30 * 24) * HOUR),
    interactionsCount: 0,
    createdAt: iso(int(30, 120) * DAY),
  };
});

const TYPES: CallType[] = ["booking", "consultation", "consultation", "booking", "booking", "consultation", "reschedule", "booking", "consultation", "irrelevant", "spam", "booking", "consultation", "reschedule", "booking", "consultation", "booking", "complaint", "consultation", "booking", "consultation", "booking", "consultation", "booking", "complaint"];
const SUMMARIES: Record<CallType, string[]> = {
  booking: ["Клиент записался на {svc} на {time}. Авто: {car}. Заявка создана, ждёт подтверждения.", "Хочет {svc} для {car}, удобно {time}. Собраны имя и телефон, создана заявка."],
  consultation: ["Спрашивал стоимость услуги «{svc}» и график в субботу. Цену назвала по прайсу, от записи пока отказался.", "Уточнял, работаем ли с {car} и сколько длится {svc}. Ответила по анкете."],
  complaint: ["Недоволен качеством услуги «{svc}»: после ремонта снова горит Check Engine. Передан администратору, заявка срочная.", "Жалоба на ожидание 2 часа при записи на {time}. Переведён на Айжан."],
  reschedule: ["Перенос записи на {svc} с завтра на {time}. Заявка на перенос создана."],
  irrelevant: ["Ошиблись номером, искали шиномонтаж на Южной магистрали."],
  spam: ["Рекламный звонок, предложение услуг SEO. Завершён."],
};
const TIMES = ["субботу в 11:00", "завтра в 10:00", "пятницу в 15:30", "понедельник утром", "сегодня после 17:00"];

function outcomeFor(t: CallType): CallOutcome {
  if (t === "booking") return pick(["lead_created", "lead_created", "lead_created", "transferred"] as const);
  if (t === "complaint") return "transferred";
  if (t === "reschedule") return "lead_created";
  if (t === "spam" || t === "irrelevant") return "no_result";
  return pick(["no_result", "lead_created", "no_result", "transferred"] as const);
}

export const calls: Call[] = [];
export const callTurns = new Map<string, CallTurn[]>();
export const leads: Lead[] = [];
export const leadEvents: LeadEvent[] = [];
let leadNo = 1040;

function genTurns(c: Call, svc: string, car: string, time: string, name?: string): CallTurn[] {
  const t: [CallTurn["speaker"], string][] = [["ai", "Здравствуйте! Автосервис «Мотор», я Айгуль, виртуальный помощник. Чем помочь?"]];
  switch (c.type) {
    case "booking":
      t.push(["caller", `Здравствуйте, хочу записаться на ${svc.toLowerCase()}.`], ["ai", "Конечно. Какая у вас машина?"], ["caller", car], ["ai", "Когда вам удобно приехать?"], ["caller", time], ["ai", "Как к вам обращаться?"], ["caller", name ?? "Азамат"], ["ai", `Записала: ${svc.toLowerCase()}, ${time}. Администратор подтвердит по этому номеру. Верно?`], ["caller", "Да, всё верно, спасибо."], ["ai", "Ждём вас! Хорошего дня."]);
      break;
    case "consultation":
      t.push(["caller", `Скажите, сколько стоит ${svc.toLowerCase()}?`], ["ai", "Сейчас посмотрю."], ["ai", `«${svc}» — по прайсу, точную сумму назову по марке. Какая у вас машина?`], ["caller", car], ["ai", "Для вашей машины цена по прайсу, займёт около часа. Записать вас?"], ["caller", "Пока подумаю, а в субботу работаете?"], ["ai", "В субботу с 10 до 16 на Ахунбаева. Будем рады!"]);
      break;
    case "complaint":
      t.push(["caller", "Я у вас на прошлой неделе делал ремонт, а сейчас опять горит Check Engine!"], ["ai", "Мне очень жаль, что так получилось. Сейчас соединю с администратором, она разберётся."], ["operator", "Добрый день, это Айжан. Расскажите, пожалуйста, подробнее."], ["caller", "Машина опять дёргается на холостых."], ["operator", "Приезжайте завтра к 10, проверим бесплатно по гарантии."]);
      break;
    case "reschedule":
      t.push(["caller", `Мне нужно перенести запись на ${svc.toLowerCase()}.`], ["ai", "Конечно. На какое время перенести?"], ["caller", time], ["ai", `Перенесла на ${time}. Администратор подтвердит.`]);
      break;
    case "irrelevant":
      t.push(["caller", "Это шиномонтаж на Южной магистрали?"], ["ai", "Нет, это автосервис «Мотор» на Ахунбаева. Шиномонтаж у нас тоже есть, подсказать цены?"], ["caller", "Нет, спасибо, я ошибся."]);
      break;
    case "spam":
      t.push(["caller", "Здравствуйте, предлагаем продвижение вашего сайта..."], ["ai", "Спасибо, нас это не интересует. Хорошего дня."]);
      break;
    default:
      break;
  }
  let ms = 400;
  return t.map(([speaker, text], seq) => {
    const dur = Math.max(1200, text.length * 62);
    const turn: CallTurn = { seq, speaker, startMs: ms, endMs: ms + dur, text, interrupted: speaker === "ai" && chance(0.06), latencyMs: speaker === "ai" ? int(420, 1150) : undefined };
    ms += dur + int(250, 900);
    return turn;
  });
}

for (let i = 0; i < 420; i++) {
  // больше звонков днём и в последние дни
  const daysAgo = Math.floor(Math.pow(r(), 1.6) * 30);
  const hour = pick([9, 10, 10, 11, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 8, 21]);
  const start = new Date(NOW - daysAgo * DAY);
  start.setUTCHours(hour - 6, int(0, 59), int(0, 59)); // Asia/Bishkek = UTC+6
  if (start.getTime() > NOW) start.setTime(NOW - int(5, 180) * MIN);
  const missed = chance(0.05);
  const type = missed ? undefined : pick(TYPES);
  const contact = chance(0.85) ? pick(contacts) : undefined;
  const svc = pick(services);
  const car = pick(CARS);
  const time = pick(TIMES);
  const dur = missed ? 0 : type === "spam" ? int(15, 40) : type === "irrelevant" ? int(20, 50) : int(55, 360);
  const outcome: CallOutcome = missed ? "missed" : type ? outcomeFor(type) : "dropped";
  const flags: CallFlag[] = [];
  if (!missed && chance(0.07)) flags.push(pick(["wrong_price", "misunderstood", "slow", "unanswered"] as const));
  const c: Call = {
    id: `cl_${(1000 + i).toString(36)}`,
    numberId: chance(0.7) ? "num_1" : "num_2",
    branchId: chance(0.7) ? "br_1" : "br_2",
    caller: contact?.phone ?? `+99677${int(1000000, 9999999)}`,
    contactId: contact?.id,
    contactName: contact?.name,
    isNewCaller: !contact || chance(0.3),
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + dur * 1000).toISOString(),
    durationS: dur,
    billedSeconds: Math.ceil(dur / 60) * 60,
    type,
    outcome,
    summary: type ? pick(SUMMARIES[type]).replace("{svc}", svc.name.toLowerCase()).replace("{time}", time).replace("{car}", car) : undefined,
    rating: chance(0.12) ? (chance(0.75) ? 1 : -1) : undefined,
    flags,
    transferred: outcome === "transferred",
    callbackDoneAt: missed && chance(0.4) ? new Date(start.getTime() + 20 * MIN).toISOString() : undefined,
    kbVersion: daysAgo > 12 ? 11 : 12,
    costMinor: Math.round(dur * 0.9),
  };
  if (c.rating === -1) c.ratingReason = pick(["Неверная цена", "Не понял", "Долго отвечал"]);
  if (c.type === "complaint") c.flags.push("interrupted");
  calls.push(c);
  if (type) callTurns.set(c.id, genTurns(c, svc.name, car, time, contact?.name?.split(" ")[0]));
  if (contact) contact.interactionsCount += 1;

  if (outcome === "lead_created" || type === "complaint" || (missed && chance(0.5))) {
    const lt: LeadType = missed ? "callback" : type === "complaint" ? "complaint" : type === "reschedule" ? "reschedule" : type === "booking" ? "booking" : "consultation";
    const age = NOW - start.getTime();
    const status: LeadStatus = lt === "complaint" && age > 3 * HOUR ? pick(["won", "won", "in_progress"] as const) : age < 6 * HOUR ? pick(["new", "new", "in_progress"] as const) : age < 3 * DAY ? pick(["new", "in_progress", "waiting", "won"] as const) : pick(["won", "won", "lost", "won", "waiting"] as const);
    const urgent = lt === "complaint" || (lt === "callback" && chance(0.4));
    const assignee = status === "new" && chance(0.6) ? undefined : pick(["u_admin", "u_staff1", "u_staff2", "u_owner"]);
    const title =
      lt === "booking" ? `${svc.name}, ${time}` :
      lt === "complaint" ? `Жалоба: ${svc.name.toLowerCase()}` :
      lt === "reschedule" ? `Перенос: ${svc.name.toLowerCase()} на ${time}` :
      lt === "callback" ? "Перезвонить: пропущенный звонок" : `Консультация: ${svc.name.toLowerCase()}`;
    const lead: Lead = {
      id: `ld_${leadNo}`, number: leadNo++, source: "call", sourceId: c.id, channel: "phone", type: lt, title, status,
      priority: urgent ? "urgent" : "normal",
      tags: [...(lt === "complaint" ? ["complaint" as const] : []), ...(missed ? ["missed" as const] : []), ...(contact?.tags.includes("vip") ? ["vip" as const] : [])],
      contactId: contact?.id, contactName: contact?.name, contactPhone: c.caller, branchId: c.branchId, assigneeId: assignee,
      dueAt: new Date(start.getTime() + (urgent ? 15 * MIN : 2 * HOUR)).toISOString(),
      closedAt: status === "won" || status === "lost" ? new Date(start.getTime() + int(1, 30) * HOUR).toISOString() : undefined,
      lostReason: status === "lost" ? pick(["Клиент передумал", "Дорого", "Не дозвонились"]) : undefined,
      payload: lt === "booking" ? { service: svc.name, car, preferred_time: time, branch: c.branchId === "br_1" ? "Ахунбаева" : "Джал" } : { car },
      createdAt: new Date(start.getTime() + dur * 1000).toISOString(),
      updatedAt: new Date(start.getTime() + dur * 1000 + int(1, 60) * MIN).toISOString(),
    };
    leads.push(lead);
    leadEvents.push({ id: uid("ev"), leadId: lead.id, actorKind: "ai", action: "created", createdAt: lead.createdAt });
    if (assignee) leadEvents.push({ id: uid("ev"), leadId: lead.id, actorId: assignee, actorKind: "user", action: "assignee", after: assignee, createdAt: lead.updatedAt });
    if (status !== "new") leadEvents.push({ id: uid("ev"), leadId: lead.id, actorId: assignee, actorKind: "user", action: "status", before: "new", after: status, createdAt: lead.updatedAt });
  }
}
calls.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
leads.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
for (const c of contacts) {
  const last = calls.find((x) => x.contactId === c.id);
  if (last) c.lastSeenAt = last.startedAt;
}
// ручная заявка и комментарий для примера
leadEvents.push({ id: uid("ev"), leadId: leads[2]!.id, actorId: "u_admin", actorKind: "user", action: "comment", comment: "@Бакыт клиент просит оригинальные колодки, проверь наличие", createdAt: iso(30 * MIN) });

export const integrations: Integration[] = [
  { key: "telegram_notify", group: "channels", status: "connected", lastSyncAt: iso(2 * MIN), errors24h: 0, phase: "1a" },
  { key: "telegram_channel", group: "channels", status: "connected", lastSyncAt: iso(2 * MIN), errors24h: 0, phase: "1b" },
  { key: "widget", group: "channels", status: "connected", lastSyncAt: iso(4 * MIN), errors24h: 0, phase: "1b" },
  { key: "whatsapp", group: "channels", status: "connected", lastSyncAt: iso(18 * MIN), errors24h: 0, phase: "2" },
  { key: "instagram", group: "channels", status: "plan_locked", errors24h: 0, phase: "2" },
  { key: "bitrix24", group: "crm", status: "plan_locked", errors24h: 0, phase: "2" },
  { key: "amocrm", group: "crm", status: "plan_locked", errors24h: 0, phase: "2" },
  { key: "google_calendar", group: "calendars", status: "plan_locked", errors24h: 0, phase: "2" },
  { key: "yclients", group: "calendars", status: "plan_locked", errors24h: 0, phase: "3" },
  { key: "google_sheets", group: "sheets", status: "plan_locked", errors24h: 0, phase: "2" },
  { key: "webhooks", group: "developers", status: "plan_locked", errors24h: 0, phase: "2" },
  { key: "api", group: "developers", status: "plan_locked", errors24h: 0, phase: "3" },
];

export const integrationLogs: Record<string, IntegrationLog[]> = {
  telegram_notify: Array.from({ length: 40 }, (_, i) => {
    const err = i === 6 || i === 17;
    return {
      id: uid("il"), at: iso(i * 37 * MIN + 2 * MIN), direction: i % 5 === 0 ? "in" : "out",
      event: i % 5 === 0 ? "callback_query: take" : pick(["lead.created", "lead.urgent", "call.missed"]),
      status: err ? (i === 6 ? "error" : "ok") : "ok", ms: int(90, 480),
      error: i === 6 ? "403 Forbidden: bot was blocked by the user (Эмиль Жумабаев)" : undefined,
    };
  }),
};

export const notifications: AppNotification[] = [
  { id: uid("nt"), kind: "complaint", title: "Жалоба: ремонт двигателя", body: "Клиент недоволен, передан Айжан", href: `/app/leads?open=${leads.find((l) => l.type === "complaint")?.id}`, createdAt: iso(12 * MIN) },
  { id: uid("nt"), kind: "lead_new", title: "Новая заявка: замена масла, суббота 11:00", href: `/app/leads?open=${leads[0]?.id}`, createdAt: iso(25 * MIN) },
  { id: uid("nt"), kind: "call_missed", title: "Пропущенный звонок +996 777 123 456", href: "/app/calls?view=missed", createdAt: iso(48 * MIN) },
  { id: uid("nt"), kind: "limit_80", title: "Израсходовано 80% минут", body: "Прогноз: лимит закончится 24 ноября", href: "/app/billing", createdAt: iso(5 * HOUR), readAt: iso(4 * HOUR) },
  { id: uid("nt"), kind: "integration_error", title: "Telegram: Эмиль заблокировал бота", href: "/app/integrations?open=telegram_notify", createdAt: iso(7 * HOUR), readAt: iso(6 * HOUR) },
  { id: uid("nt"), kind: "kb_published", title: "Анкета опубликована, версия 12", href: "/app/knowledge", createdAt: iso(12 * DAY), readAt: iso(12 * DAY) },
];

export const plans: Plan[] = [
  { key: "start", name: "Старт", priceMinor: 690000, currency: "KGS", minutes: 500, aiDialogs: 0, lines: 1, modes: ["leads"] },
  { key: "business", name: "Бизнес", priceMinor: 1590000, currency: "KGS", minutes: 1500, aiDialogs: 1000, lines: 3, modes: ["leads", "consult"] },
  { key: "pro", name: "Про", priceMinor: 3490000, currency: "KGS", minutes: 4000, aiDialogs: 5000, lines: 8, modes: ["leads", "consult", "booking", "semi"] },
];

export const invoices: Invoice[] = [
  { id: "inv_5", number: "ALL-2026-0118", periodStart: "2026-11-01", periodEnd: "2026-11-30", amountMinor: 1590000, currency: "KGS", status: "paid" },
  { id: "inv_4", number: "ALL-2026-0094", periodStart: "2026-10-01", periodEnd: "2026-10-31", amountMinor: 1782000, currency: "KGS", status: "paid" },
  { id: "inv_3", number: "ALL-2026-0071", periodStart: "2026-09-01", periodEnd: "2026-09-30", amountMinor: 1590000, currency: "KGS", status: "paid" },
];

export const assistant: AssistantSettings = {
  voice: "aigul", speed: 1, pronunciation: [{ word: "Мотор", say: "мОтор" }, { word: "ГРМ", say: "гэ-эр-эм" }],
  name: "Айгуль", greeting: "Здравствуйте! Автосервис «Мотор», я Айгуль, виртуальный помощник. Чем помочь?",
  farewell: "Спасибо за звонок, хорошего дня!", mode: "consult",
  handoffRules: "Гарантийные случаи — сразу Бакыту", handoffQueue: ["u_admin", "u_staff1"], handoffTimeoutS: 20,
  noAnswerPhrase: "Сейчас все мастера заняты. Я создала срочную заявку, вам перезвонят в течение 15 минут.",
  maxCallMinutes: 10, onLimit: "leads_only",
};

export const notificationPrefs: Record<string, NotificationPref[]> = Object.fromEntries(
  members.map((m) => [m.userId, ["lead_new", "lead_urgent", "complaint", "call_missed", "limit_80", "integration_error", "payment_due", "kb_published"].map((kind) => ({
    kind, channels: m.role === "accountant" ? (kind === "payment_due" ? ["app", "email"] : []) : kind.startsWith("lead") || kind === "complaint" ? ["app", "telegram"] : ["app"],
  }))]),
) as Record<string, NotificationPref[]>;

export const apiKeys: ApiKey[] = [];

export const audit: AuditEntry[] = [
  { id: uid("au"), actorName: "Азамат Токтогулов", action: "ai_mode", entity: "Компания", createdAt: iso(2 * DAY), detail: "Только заявки → Включён" },
  { id: uid("au"), actorName: "Азамат Токтогулов", action: "publish", entity: "Анкета", createdAt: iso(12 * DAY), detail: "Версия 12" },
  { id: uid("au"), actorName: "Айжан Бекова", action: "update", entity: "Услуги", createdAt: iso(13 * DAY), detail: "Шиномонтаж: цена 800–1 600 сом" },
  { id: uid("au"), actorName: "Азамат Токтогулов", action: "invite", entity: "Команда", createdAt: iso(20 * DAY), detail: "Эмиль Жумабаев — сотрудник" },
  { id: uid("au"), actorName: "Поддержка ALL", action: "support_login", entity: "Кабинет", createdAt: iso(25 * DAY), detail: "Тикет #2207, по согласию" },
];

export const usage = {
  minutesTotal: 1500, extraMinutes: 0, dialogsTotal: 1000, dialogsUsed: 0, linesTotal: 3,
  periodStart: new Date(new Date(NOW).getFullYear(), new Date(NOW).getMonth(), 1).toISOString(),
  periodEnd: new Date(new Date(NOW).getFullYear(), new Date(NOW).getMonth() + 1, 0, 23, 59).toISOString(),
  overagePolicy: "stop_ai" as "pay" | "stop_ai", overageCapMinor: 500000, planKey: "business" as Plan["key"],
};

// Суперадминка
export const adminCompanies: AdminCompany[] = [
  { id: "co_motor", name: "Автосервис «Мотор»", sphere: "autoservice", status: "active", plan: "Бизнес", readiness: 100, minutesUsed: 1242, costMinor: 1120000, revenueMinor: 1590000, kbIndex: 84, lastActivityAt: iso(2 * MIN) },
  { id: "co_smile", name: "Стоматология «Смайл»", sphere: "dental", status: "active", plan: "Про", readiness: 100, minutesUsed: 2810, costMinor: 2530000, revenueMinor: 3490000, kbIndex: 91, lastActivityAt: iso(9 * MIN) },
  { id: "co_lime", name: "Салон «Лайм»", sphere: "salon", status: "moderation", plan: "Старт", readiness: 80, minutesUsed: 0, costMinor: 0, revenueMinor: 690000, kbIndex: 72, lastActivityAt: iso(3 * HOUR) },
  { id: "co_zdorovie", name: "Клиника «Здоровье»", sphere: "clinic", status: "onboarding", plan: "Бизнес", readiness: 45, minutesUsed: 0, costMinor: 0, revenueMinor: 0, kbIndex: 38, lastActivityAt: iso(DAY) },
  { id: "co_service", name: "СервисПлюс", sphere: "service", status: "suspended", plan: "Старт", readiness: 100, minutesUsed: 512, costMinor: 470000, revenueMinor: 0, kbIndex: 66, lastActivityAt: iso(9 * DAY) },
];

export const demoLeads: DemoLead[] = Array.from({ length: 36 }, (_, i) => ({
  id: uid("dl"), phone: `+99670${int(1000000, 9999999)}`, calls: int(1, 5),
  roles: Array.from(new Set([pick(["autoservice", "clinic", "salon", "dental", "polyclinic"]), pick(["autoservice", "clinic", "salon"])])),
  consent: chance(0.7), status: i < 10 ? "new" : pick(["contacted", "meeting", "won", "lost", "contacted"] as const),
  owner: i < 10 ? undefined : pick(["Даниэль", "Мирлан"]), createdAt: iso(int(1, 20 * 24) * HOUR), utm: pick(["instagram/reels", "google/cpc", "2gis", "direct", "telegram/ads"]),
}));

export const demoCalls: DemoCall[] = Array.from({ length: 60 }, () => ({
  id: uid("dc"), caller: `+99670${int(1000000, 9999999)}`, roles: [pick(["autoservice", "clinic", "salon", "dental", "polyclinic"])],
  durationS: int(60, 840), costMinor: int(4, 60) * 100, summarySent: chance(0.6), token: Math.random().toString(36).slice(2, 10), createdAt: iso(int(1, 14 * 24) * HOUR),
})).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const moderation: ModerationItem[] = [
  { id: uid("md"), company: "Салон «Лайм»", version: 1, status: "queued", slaDueAt: new Date(NOW + 5 * HOUR).toISOString(), findings: [
    { rule: "Обещание результата", quote: "Гарантируем, что волосы станут гуще уже после первой процедуры", severity: "high" },
    { rule: "Медицинское утверждение", quote: "Процедура лечит выпадение волос", severity: "high" },
  ] },
  { id: uid("md"), company: "Клиника «Здоровье»", version: 3, status: "in_review", slaDueAt: new Date(NOW + 1 * HOUR).toISOString(), findings: [
    { rule: "Цена без валюты", quote: "Консультация терапевта — 1500", severity: "low" },
  ] },
];
