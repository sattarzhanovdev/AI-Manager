/**
 * Provisioning демо-среды хакатона: компания «AutoCity Service», 2 аккаунта (Demo Owner, Demo Staff) и связанные данные.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm --filter @all/web provision:demo [--out ../../HACKATHON_ACCESS.md] [--with-isolation-fixture] [--reset-passwords]
 *
 * - Работает через Supabase Admin API и сервисный ключ — только из доверенной среды (локально / CI), не из браузера.
 * - Пароли берутся из DEMO_OWNER_PASSWORD / DEMO_STAFF_PASSWORD; если не заданы — генерируются и печатаются ОДИН раз.
 *   В исходном коде паролей нет. Файл --out не коммитится (.gitignore).
 * - Идемпотентен: фиксированные идентификаторы + upsert с ignoreDuplicates. Повторный запуск не дублирует записи
 *   и НЕ перезаписывает изменения, сделанные в кабинете (статусы заявок, база знаний и т. д.). Ничего не удаляет.
 * - Все люди, телефоны и диалоги вымышленные; звонки помечены «[Демо]».
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildSnapshot, type FieldValues } from "@all/dialog";

const args = new Set(process.argv.slice(2));
const argValue = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const URL_ = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) {
  console.error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (сервисный ключ — только в доверенной среде).");
  process.exit(1);
}
const sb: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

/** Детерминированный uuid (v5-подобный) — повторный запуск даёт те же id */
function uid(name: string): string {
  const h = createHash("sha1").update(`all-manager-demo:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const HOUR = 60, DAY = 24 * 60;

type Res = { data: unknown; error: { message: string } | null };
async function must<R extends Res>(p: PromiseLike<R>, what: string): Promise<NonNullable<Extract<R, { error: null }>["data"]>> {
  const r = await p;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as NonNullable<Extract<R, { error: null }>["data"]>;
}
/** Вставка только отсутствующих строк: существующие (в т.ч. изменённые в кабинете) не трогаем */
async function insertMissing(table: string, rows: Record<string, unknown>[], onConflict = "id") {
  if (!rows.length) return;
  await must(sb.from(table).upsert(rows, { onConflict, ignoreDuplicates: true }), `insert ${table}`);
}

// ───────────── Аккаунты ─────────────
const genPassword = () => `${randomBytes(9).toString("base64url")}-${randomBytes(3).toString("hex")}`;

async function ensureUser(email: string, fullName: string, envPassword: string | undefined) {
  const list = await must(sb.auth.admin.listUsers({ page: 1, perPage: 1000 }), "listUsers");
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    if (envPassword || args.has("--reset-passwords")) {
      const password = envPassword ?? genPassword();
      await must(sb.auth.admin.updateUserById(existing.id, { password, user_metadata: { full_name: fullName } }), "updateUser");
      return { id: existing.id, password, created: false };
    }
    return { id: existing.id, password: undefined, created: false };
  }
  const password = envPassword ?? genPassword();
  const r = await must(sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } }), "createUser");
  return { id: r.user!.id, password, created: true };
}

// ───────────── Данные компании ─────────────
const COMPANY = uid("company:autocity");
const BR = { east: uid("branch:east"), south: uid("branch:south") };
const HOURS = { mon: [["09:00", "20:00"]], tue: [["09:00", "20:00"]], wed: [["09:00", "20:00"]], thu: [["09:00", "20:00"]], fri: [["09:00", "20:00"]], sat: [["10:00", "18:00"]], sun: [] };

const FIELDS: FieldValues = {
  "company.name": "AutoCity Service",
  "company.name_stress": "АвтосИти сЕрвис",
  "company.description": "Автосервис в Бишкеке: обслуживание и ремонт легковых автомобилей, диагностика, шиномонтаж. Два филиала.",
  "company.sphere": "autoservice",
  "company.advantages": "Гарантия 6 месяцев на работы\nПрозрачная смета до начала ремонта\nЗона ожидания с Wi-Fi и кофе",
  "branch.address": "ул. Жибек Жолу, 512",
  "branch.landmarks": "напротив АЗС, серые ворота",
  "branch.hours": HOURS,
  "branch.phones": "+996555000101",
  "booking.order": "Клиент оставляет заявку, администратор перезванивает и подтверждает время записи.",
  "booking.min_lead_time": "за 2 часа",
  "booking.cancel": "Отменить или перенести запись можно бесплатно, предупредив за 2 часа.",
  "booking.late": "Ждём 15 минут, затем предлагаем другое время.",
  "booking.bring": "Техпаспорт автомобиля",
  "payment.methods": "Наличные\nБанковская карта\nQR (MBank, О!Деньги)",
  "payment.warranty": "6 месяцев или 10 000 км на выполненные работы",
  "stop.never_promise": "Точные сроки ремонта без осмотра\nНаличие запчастей без проверки\nСкидки",
  "stop.topics": "Конкуренты\nПолитика",
  "stop.reply": "Это лучше уточнить у администратора, я передам ваш вопрос.",
  "handoff.who": "Гарантия и жалобы — администратор Айжан, двигатель — мастер Бакыт",
  "handoff.when": "Корпоративный автопарк, оптовые заказы",
  "handoff.how": "callback",
  "handoff.no_answer": "Создать срочную заявку на перезвон в течение 15 минут",
  "client.required": "Имя\nТелефон",
  "client.desired": "Марка и модель авто",
  "client.never": "Домашний адрес",
  "style.assistant_name": "Алия",
  "style.greeting": "Здравствуйте! AutoCity Service, я Алия — виртуальный помощник. Чем могу помочь?",
  "style.tone": "friendly",
  "style.languages": "ru\nky",
};

const STAFF = [
  { key: "bakyt", name: "Бакыт Осмонов", specialties: ["Моторист"], branch: BR.east },
  { key: "emil", name: "Эмиль Садыков", specialties: ["Диагност"], branch: BR.east },
  { key: "nurlan", name: "Нурлан Исаков", specialties: ["Шиномонтаж"], branch: BR.south },
  { key: "aibek", name: "Айбек Мамытов", specialties: ["Ходовая", "Тормоза"], branch: BR.south },
  { key: "timur", name: "Тимур Каримов", specialties: ["Автоэлектрик"], branch: BR.east },
  { key: "aizhan", name: "Айжан Бекова", specialties: ["Администратор"], branch: BR.east, bookable: false },
];

const S = (name: string, synonyms: string[], priceType: "exact" | "range" | "after_inspection", min: number | null, max: number | null, duration: number | null, description: string, staff: string[]) =>
  ({ key: name, name, synonyms, priceType, min, max, duration, description, staff });
const SERVICES = [
  S("Замена моторного масла", ["замена масла", "поменять масло", "масло"], "exact", 1500, null, 30, "Замена масла и масляного фильтра. Масло клиента или наше.", ["bakyt"]),
  S("Компьютерная диагностика", ["диагностика", "проверить машину", "чек горит"], "exact", 1200, null, 40, "Считывание ошибок всех блоков, отчёт с рекомендациями.", ["emil"]),
  S("Замена тормозных колодок", ["колодки", "тормозные колодки", "тормоза"], "exact", 1800, null, 60, "Цена за одну ось, без стоимости колодок.", ["aibek"]),
  S("Шиномонтаж", ["переобуть", "смена резины", "шиномонтаж", "колёса"], "range", 1600, 2800, 60, "Комплект из 4 колёс, зависит от радиуса R13–R20.", ["nurlan"]),
  S("Балансировка колёс", ["балансировка"], "exact", 800, null, 30, "4 колеса.", ["nurlan"]),
  S("Техническое обслуживание (ТО)", ["ТО", "техобслуживание", "плановое обслуживание"], "range", 4500, 9000, 120, "Плановое ТО по регламенту производителя, без стоимости расходников.", ["bakyt", "emil"]),
  S("Замена воздушного фильтра", ["воздушный фильтр", "фильтр"], "exact", 500, null, 15, "Работа без стоимости фильтра.", ["bakyt"]),
  S("Развал-схождение", ["развал", "сход-развал", "схождение"], "exact", 1500, null, 45, "Компьютерная регулировка углов установки колёс.", ["aibek"]),
  S("Диагностика ходовой части", ["ходовая", "подвеска", "стучит подвеска"], "exact", 700, null, 30, "Осмотр подвески на подъёмнике.", ["aibek"]),
  S("Ремонт двигателя", ["двигатель", "мотор", "капремонт"], "after_inspection", null, null, null, "Стоимость определяется после диагностики двигателя.", ["bakyt"]),
];

const FAQ: [string, string, string[]][] = [
  ["Нужна ли предварительная запись?", "Лучше оставить заявку заранее — администратор перезвонит и подтвердит удобное время.", ["записываться заранее", "можно без записи"]],
  ["Сколько длится замена масла?", "Обычно около 30 минут.", ["как долго менять масло"]],
  ["Можно приехать со своим маслом?", "Да, можно со своим маслом и фильтром — оплачивается только работа.", ["своё масло", "свои запчасти"]],
  ["Есть ли гарантия на работы?", "Да, гарантия 6 месяцев или 10 000 км на выполненные работы.", ["гарантия"]],
  ["Какие способы оплаты?", "Наличные, банковская карта и QR (MBank, О!Деньги).", ["оплата картой", "как оплатить"]],
  ["Работаете ли вы в воскресенье?", "Воскресенье — выходной. В субботу работаем с 10:00 до 18:00.", ["воскресенье", "выходные"]],
  ["Есть ли зона ожидания?", "Да, есть зона ожидания с Wi-Fi и кофе.", ["где подождать", "wifi"]],
  ["С какими марками вы работаете?", "Обслуживаем легковые японские, корейские и европейские автомобили.", ["марки", "какие машины"]],
  ["Ремонтируете ли АКПП?", "Ремонт АКПП не делаем, только диагностику. Администратор подскажет партнёрский сервис.", ["коробка автомат", "акпп"]],
  ["Можно оставить машину на весь день?", "Да, автомобиль можно оставить на день и забрать до закрытия филиала.", ["оставить машину"]],
  ["Есть ли парковка?", "Да, у обоих филиалов бесплатная парковка для клиентов.", ["где припарковаться"]],
  ["Продаёте ли вы запчасти?", "Подбираем и заказываем запчасти. Наличие и сроки уточнит администратор.", ["запчасти", "заказать деталь"]],
  ["Работаете ли с юридическими лицами?", "Да, работаем по договору и безналичному расчёту.", ["безнал", "юрлицо", "договор"]],
  ["Как отменить или перенести запись?", "Позвоните или напишите нам минимум за 2 часа — перенос и отмена бесплатные.", ["отменить запись", "перенести запись"]],
  ["Где вы находитесь?", "Филиал «Восток» — ул. Жибек Жолу, 512, филиал «Юг» — ул. Ахунбаева, 98.", ["адрес", "как доехать"]],
];

const FIRST = ["Азамат", "Нурлан", "Айбек", "Эрлан", "Бакыт", "Тимур", "Данияр", "Айгерим", "Жылдыз", "Айпери", "Нургуль", "Марат", "Улан", "Кубат", "Чынгыз", "Сезим", "Алина", "Руслан", "Дастан", "Асель"];
const LAST_M = ["Токтогулов", "Асанов", "Мамытов", "Садыков", "Исаков", "Абдыкадыров", "Жээнбеков", "Осмонов", "Шамшиев", "Каримов"];
const FEMALE = new Set(["Айгерим", "Жылдыз", "Айпери", "Нургуль", "Сезим", "Алина", "Асель"]);
const CARS = ["Toyota Camry", "Honda Fit", "Hyundai Sonata", "Kia K5", "Lexus RX 350", "Subaru Forester", "Mazda 6", "Toyota Prius", "Volkswagen Polo", "Hyundai Tucson"];
const CONTACTS = FIRST.map((first, i) => ({
  id: uid(`contact:${i}`),
  phone: `+996555000${String(201 + i)}`,
  name: `${first} ${LAST_M[i % LAST_M.length]}${FEMALE.has(first) ? "а" : ""}`,
  notes: `${CARS[i % CARS.length]} (тестовые данные)`,
}));

async function seedCompany(ownerId: string, staffId: string) {
  // Тариф для доступных режимов ассистента (биллинг в MVP не подключён)
  const PLAN = "20000000-0000-0000-0000-000000000002";
  await insertMissing("plans", [{ id: PLAN, key: "business", name: "Бизнес" }]);
  await insertMissing("plan_versions", [{ plan_id: PLAN, version: 1, limits: { minutes: 1500, ai_dialogs: 1000, lines: 3, modes: ["leads", "consult"] }, prices: { KGS: { amount_minor: 1590000, overage_minute_minor: 1500 } }, published_at: new Date().toISOString() }], "plan_id,version");
  const pv = await must(sb.from("plan_versions").select("id").eq("plan_id", PLAN).eq("version", 1).single(), "plan_version");

  await insertMissing("companies", [{ id: COMPANY, name: "AutoCity Service", name_stress: "АвтосИти сЕрвис", sphere: "autoservice", timezone: "Asia/Bishkek", locale: "ru", currency: "KGS", status: "active", ai_mode: "on", plan_version_id: pv.id }]);
  await must(sb.from("profiles").upsert([
    { id: ownerId, full_name: "Demo Owner", email: process.env.DEMO_OWNER_EMAIL ?? "demo.owner@example.com", locale: "ru" },
    { id: staffId, full_name: "Demo Staff", email: process.env.DEMO_STAFF_EMAIL ?? "demo.staff@example.com", locale: "ru" },
  ], { onConflict: "id" }), "profiles");
  // Роли приводим к нужным при каждом запуске — это и есть проверка прав для жюри
  await must(sb.from("memberships").upsert([
    { company_id: COMPANY, user_id: ownerId, role: "owner", disabled_at: null },
    { company_id: COMPANY, user_id: staffId, role: "staff", disabled_at: null },
  ], { onConflict: "company_id,user_id" }), "memberships");
  await insertMissing("subscriptions", [{ id: uid("subscription"), company_id: COMPANY, plan_version_id: pv.id, currency: "KGS", period_start: ago(5 * DAY), period_end: new Date(Date.now() + 60 * DAY * 60_000).toISOString(), overage_policy: "stop_ai" }]);
  await insertMissing("branches", [
    { id: BR.east, company_id: COMPANY, name: "Восток", address: "ул. Жибек Жолу, 512", landmarks: "напротив АЗС, серые ворота", hours: HOURS, phones: ["+996555000101"], timezone: "Asia/Bishkek" },
    { id: BR.south, company_id: COMPANY, name: "Юг", address: "ул. Ахунбаева, 98", landmarks: "рядом с рынком, вход со двора", hours: HOURS, phones: ["+996555000102"], timezone: "Asia/Bishkek" },
  ]);
  // Канал «виджет» — в нём хранятся тестовые диалоги «Протестировать AI»
  await insertMissing("channels", [{ id: uid("channel:widget"), company_id: COMPANY, type: "widget", status: "connected", settings: { purpose: "assistant_test", note: "Тест AI в кабинете (веб-демо)" } }]);
  await insertMissing("assistant_settings", [{
    company_id: COMPANY,
    settings: {
      voice: "aigul", speed: 1, pronunciation: [{ word: "AutoCity", say: "Автосити" }], name: "Алия",
      greeting: FIELDS["style.greeting"], farewell: "Спасибо за обращение, хорошего дня!", mode: "consult",
      handoffRules: "Гарантия и жалобы — администратору Айжан", handoffQueue: [ownerId], handoffTimeoutS: 20,
      noAnswerPhrase: "Сейчас все заняты. Я создала заявку, вам перезвонят в течение 15 минут.", maxCallMinutes: 10, onLimit: "leads_only",
    },
  }], "company_id");
}

async function seedKnowledge() {
  const existing = await must(sb.from("questionnaires").select("id").eq("company_id", COMPANY).limit(1), "questionnaires");
  if (existing.length) { console.log("• База знаний уже есть — не трогаем (изменения из кабинета сохраняются)"); return; }
  const q1 = uid("questionnaire:1");
  await must(sb.from("questionnaires").insert({ id: q1, company_id: COMPANY, version: 1, status: "draft", completeness: 100 }), "questionnaire");
  await must(sb.from("questionnaire_fields").insert(Object.entries(FIELDS).map(([k, v]) => ({
    company_id: COMPANY, questionnaire_id: q1, field_key: k, value: v, source: "template",
    block: ({ company: 1, branch: 2, booking: 5, payment: 6, stop: 10, handoff: 11, style: 12, client: 13 } as Record<string, number>)[k.split(".")[0]!] ?? 1,
  }))), "fields");
  const staffIds = Object.fromEntries(STAFF.map((s) => [s.key, uid(`staff:${s.key}`)]));
  await must(sb.from("staff").insert(STAFF.map((s) => ({
    id: staffIds[s.key], company_id: COMPANY, questionnaire_id: q1, name: s.name, specialties: s.specialties, branch_id: s.branch,
    hours: HOURS, languages: ["ru", "ky"], bookable: s.bookable ?? true,
  }))), "staff");
  await must(sb.from("services").insert(SERVICES.map((s) => ({
    id: uid(`service:${s.key}`), company_id: COMPANY, questionnaire_id: q1, name: s.name, synonyms: s.synonyms, description: s.description,
    price_type: s.priceType, price_min: s.min == null ? null : s.min * 100, price_max: s.max == null ? null : s.max * 100, currency: "KGS",
    duration_min: s.duration, staff_ids: s.staff.map((k) => staffIds[k]), branch_ids: [BR.east, BR.south], active: true,
  }))), "services");
  await must(sb.from("faq").insert(FAQ.map(([question, answer, synonyms], i) => ({
    id: uid(`faq:${i}`), company_id: COMPANY, questionnaire_id: q1, question, short_answer: answer, synonyms, source: "template", active: true,
  }))), "faq");
  await insertMissing("unanswered_questions", [
    { id: uid("uq:1"), company_id: COMPANY, text: "Ставите ли газовое оборудование?", normalized: "ставите ли газовое оборудование", count: 4 },
    { id: uid("uq:2"), company_id: COMPANY, text: "Есть ли рассрочка на ремонт?", normalized: "есть ли рассрочка на ремонт", count: 2 },
  ]);

  // Публикация v1: тот же снимок, что строит кабинет (lib/data/sb/kb.ts → snapshotFrom)
  const branches = await must(sb.from("branches").select("*").eq("company_id", COMPANY).order("created_at"), "branches");
  const snapshot = buildSnapshot({
    version: 1, fields: FIELDS,
    branches: branches.map((b) => ({ id: b.id, name: b.name, address: b.address, landmarks: b.landmarks ?? undefined, hours: b.hours, phones: b.phones })),
    services: SERVICES.map((s) => ({ id: uid(`service:${s.key}`), name: s.name, synonyms: s.synonyms, priceType: s.priceType, priceMin: s.min == null ? undefined : s.min * 100, priceMax: s.max == null ? undefined : s.max * 100, currency: "KGS" as const, durationMin: s.duration ?? undefined, staff: s.staff.map((k) => STAFF.find((x) => x.key === k)!.name) })),
    staff: STAFF.map((s) => ({ id: staffIds[s.key]!, name: s.name, specialties: s.specialties })),
    faq: FAQ.map(([question, answer, synonyms], i) => ({ id: uid(`faq:${i}`), question, synonyms, shortAnswer: answer })),
  });
  await must(sb.from("questionnaires").update({ status: "published", published_at: new Date().toISOString() }).eq("id", q1), "publish");
  await must(sb.from("kb_snapshots").insert({ company_id: COMPANY, version: 1, payload: snapshot }), "snapshot");
  await must(sb.rpc("clone_questionnaire_draft", { p_company_id: COMPANY, p_from: q1, p_version: 2 }), "clone draft");
  console.log("• База знаний: 10 услуг, 6 сотрудников, 15 FAQ, опубликована версия 1, черновик v2");
}

type CallSeed = { key: string; contact: number; minAgo: number; dur: number; type: string; outcome: string; summary: string; turns: [string, string][] };
const CALLS: CallSeed[] = [
  { key: "c1", contact: 0, minAgo: 2 * HOUR, dur: 95, type: "consultation", outcome: "lead_created", summary: "Спросил цену замены масла, оставил заявку на завтра.", turns: [["ai", "Здравствуйте! AutoCity Service, я Алия — виртуальный помощник. Чем могу помочь?"], ["caller", "Сколько стоит замена масла?"], ["ai", "Замена моторного масла стоит 1 500 сом. Записать вас?"], ["caller", "Да, на завтра утром."], ["ai", "Оформила заявку. Администратор перезвонит и подтвердит время."]] },
  { key: "c2", contact: 1, minAgo: 5 * HOUR, dur: 140, type: "booking", outcome: "lead_created", summary: "Хочет пройти ТО, заявка на субботу.", turns: [["ai", "Здравствуйте! AutoCity Service, я Алия — виртуальный помощник. Чем могу помочь?"], ["caller", "Хочу пройти ТО в субботу."], ["ai", "ТО стоит от 4 500 до 9 000 сом в зависимости от регламента. Как к вам обращаться?"], ["caller", "Нурлан."], ["ai", "Спасибо, Нурлан. Заявка оформлена, администратор подтвердит время."]] },
  { key: "c3", contact: 2, minAgo: 1 * DAY + 3 * HOUR, dur: 60, type: "consultation", outcome: "no_result", summary: "Уточнял график работы в воскресенье.", turns: [["ai", "Здравствуйте! AutoCity Service, я Алия — виртуальный помощник. Чем могу помочь?"], ["caller", "Вы в воскресенье работаете?"], ["ai", "Воскресенье — выходной. В субботу работаем с 10:00 до 18:00."], ["caller", "Понятно, спасибо."]] },
  { key: "c4", contact: 3, minAgo: 1 * DAY + 6 * HOUR, dur: 0, type: "booking", outcome: "missed", summary: "Пропущенный звонок в нерабочее время.", turns: [] },
  { key: "c5", contact: 4, minAgo: 2 * DAY + 2 * HOUR, dur: 180, type: "complaint", outcome: "transferred", summary: "Жалоба на стук после замены колодок, передано администратору.", turns: [["ai", "Здравствуйте! AutoCity Service, я Алия — виртуальный помощник. Чем могу помочь?"], ["caller", "После замены колодок что-то стучит, я недоволен."], ["ai", "Мне жаль, что так получилось. Передаю ваш вопрос администратору, вам перезвонят."]] },
  { key: "c6", contact: 5, minAgo: 2 * DAY + 5 * HOUR, dur: 75, type: "consultation", outcome: "no_result", summary: "Спрашивал про ремонт АКПП.", turns: [["ai", "Здравствуйте! AutoCity Service, я Алия — виртуальный помощник. Чем могу помочь?"], ["caller", "Ремонтируете коробку автомат?"], ["ai", "Ремонт АКПП не делаем, только диагностику. Администратор подскажет партнёрский сервис."]] },
  { key: "c7", contact: 6, minAgo: 3 * DAY + 1 * HOUR, dur: 120, type: "booking", outcome: "lead_created", summary: "Шиномонтаж, заявка на пятницу.", turns: [["ai", "Здравствуйте! AutoCity Service, я Алия — виртуальный помощник. Чем могу помочь?"], ["caller", "Надо переобуться, R16."], ["ai", "Шиномонтаж — от 1 600 до 2 800 сом за комплект. Когда удобно приехать?"], ["caller", "В пятницу после обеда."], ["ai", "Оформила заявку, администратор подтвердит время."]] },
  { key: "c8", contact: 7, minAgo: 4 * DAY + 4 * HOUR, dur: 50, type: "spam", outcome: "no_result", summary: "Рекламное предложение, не по теме.", turns: [["ai", "Здравствуйте! AutoCity Service, я Алия — виртуальный помощник. Чем могу помочь?"], ["caller", "Предлагаем рекламу в интернете."], ["ai", "Спасибо, нас это не интересует. Хорошего дня!"]] },
  { key: "c9", contact: 8, minAgo: 5 * DAY + 2 * HOUR, dur: 110, type: "booking", outcome: "lead_created", summary: "Диагностика, «горит чек», заявка.", turns: [["ai", "Здравствуйте! AutoCity Service, я Алия — виртуальный помощник. Чем могу помочь?"], ["caller", "Горит чек, нужна диагностика."], ["ai", "Компьютерная диагностика стоит 1 200 сом. Записать вас?"], ["caller", "Да, на понедельник."], ["ai", "Оформила заявку. Администратор перезвонит и подтвердит время."]] },
  { key: "c10", contact: 9, minAgo: 6 * DAY + 3 * HOUR, dur: 85, type: "consultation", outcome: "no_result", summary: "Уточнял, есть ли гарантия.", turns: [["ai", "Здравствуйте! AutoCity Service, я Алия — виртуальный помощник. Чем могу помочь?"], ["caller", "Какая у вас гарантия?"], ["ai", "Гарантия 6 месяцев или 10 000 км на выполненные работы."]] },
];

type LeadSeed = { key: string; contact: number; minAgo: number; type: string; status: string; source: "call" | "manual" | "chat"; call?: string; title: string; payload: Record<string, string>; assignee?: "owner" | "staff"; priority?: "urgent"; lost?: string };
const LEADS: LeadSeed[] = [
  { key: "l1", contact: 0, minAgo: 2 * HOUR, type: "booking", status: "new", source: "call", call: "c1", title: "Запись: Замена моторного масла, завтра утром", payload: { service: "Замена моторного масла", preferred_time: "завтра утром" } },
  { key: "l2", contact: 1, minAgo: 5 * HOUR, type: "booking", status: "new", source: "call", call: "c2", title: "Запись: ТО, суббота", payload: { service: "Техническое обслуживание (ТО)", preferred_time: "в субботу" } },
  { key: "l3", contact: 10, minAgo: 8 * HOUR, type: "callback", status: "new", source: "manual", title: "Перезвонить: подбор запчастей", payload: { comment: "Нужны колодки на Camry 70" }, priority: "urgent" },
  { key: "l4", contact: 11, minAgo: 20 * HOUR, type: "consultation", status: "new", source: "manual", title: "Консультация: развал-схождение", payload: { service: "Развал-схождение" } },
  { key: "l5", contact: 4, minAgo: 2 * DAY + 2 * HOUR, type: "complaint", status: "in_progress", source: "call", call: "c5", title: "Жалоба: стук после замены колодок", payload: { service: "Замена тормозных колодок", comment: "Стук спереди справа" }, assignee: "owner", priority: "urgent" },
  { key: "l6", contact: 6, minAgo: 3 * DAY + 1 * HOUR, type: "booking", status: "in_progress", source: "call", call: "c7", title: "Запись: Шиномонтаж, пятница", payload: { service: "Шиномонтаж", preferred_time: "в пятницу после обеда" }, assignee: "staff" },
  { key: "l7", contact: 12, minAgo: 3 * DAY + 6 * HOUR, type: "booking", status: "in_progress", source: "manual", title: "Запись: Компьютерная диагностика", payload: { service: "Компьютерная диагностика", preferred_time: "в среду" }, assignee: "staff" },
  { key: "l8", contact: 13, minAgo: 4 * DAY, type: "order", status: "in_progress", source: "manual", title: "Заказ: воздушный фильтр + замена", payload: { service: "Замена воздушного фильтра" }, assignee: "owner" },
  { key: "l9", contact: 14, minAgo: 4 * DAY + 5 * HOUR, type: "booking", status: "waiting", source: "manual", title: "Запись: Ремонт двигателя (ждём ответ клиента)", payload: { service: "Ремонт двигателя", comment: "Ждём решения по смете" }, assignee: "owner" },
  { key: "l10", contact: 8, minAgo: 5 * DAY + 2 * HOUR, type: "booking", status: "waiting", source: "call", call: "c9", title: "Запись: Компьютерная диагностика, понедельник", payload: { service: "Компьютерная диагностика", preferred_time: "в понедельник" }, assignee: "staff" },
  { key: "l11", contact: 15, minAgo: 6 * DAY, type: "booking", status: "won", source: "manual", title: "Запись: Балансировка колёс", payload: { service: "Балансировка колёс" }, assignee: "staff" },
  { key: "l12", contact: 16, minAgo: 7 * DAY, type: "booking", status: "won", source: "manual", title: "Запись: Замена моторного масла", payload: { service: "Замена моторного масла" }, assignee: "owner" },
  { key: "l13", contact: 17, minAgo: 8 * DAY, type: "booking", status: "won", source: "manual", title: "Запись: Диагностика ходовой части", payload: { service: "Диагностика ходовой части" }, assignee: "staff" },
  { key: "l14", contact: 18, minAgo: 9 * DAY, type: "consultation", status: "lost", source: "manual", title: "Консультация: ремонт АКПП", payload: { comment: "Не ремонтируем АКПП" }, assignee: "owner", lost: "Услугу не оказываем" },
  { key: "l15", contact: 19, minAgo: 10 * DAY, type: "booking", status: "lost", source: "manual", title: "Запись: ТО", payload: { service: "Техническое обслуживание (ТО)" }, assignee: "staff", lost: "Клиент выбрал другой сервис" },
];

async function seedCrm(ownerId: string, staffId: string) {
  await insertMissing("contacts", CONTACTS.map((c, i) => ({
    id: c.id, company_id: COMPANY, phone: c.phone, name: c.name, notes: c.notes, channels: { phone: true },
    tags: i === 4 ? ["complaint"] : i === 12 ? ["vip"] : [], first_seen_at: ago((20 - i) * DAY), last_seen_at: ago(i * 7 * HOUR), interactions_count: 1 + (i % 3),
  })));
  await insertMissing("calls", CALLS.map((c) => {
    const started = ago(c.minAgo);
    return {
      id: uid(`call:${c.key}`), company_id: COMPANY, branch_id: BR.east, caller: CONTACTS[c.contact]!.phone, contact_id: CONTACTS[c.contact]!.id,
      started_at: started, answered_at: c.outcome === "missed" ? null : started, ended_at: new Date(new Date(started).getTime() + c.dur * 1000).toISOString(),
      billed_seconds: Math.ceil(c.dur / 60) * 60, type: c.type, outcome: c.outcome, summary: `[Демо] ${c.summary}`, kb_version: 1,
      prompt_version: "assistant.ru@1.0.0", idempotency_key: `demo-seed:${c.key}`, flags: [],
    };
  }));
  const turns: Record<string, unknown>[] = [];
  for (const c of CALLS) {
    let t = 300;
    c.turns.forEach(([speaker, text], seq) => {
      const len = Math.max(1500, text.length * 60);
      turns.push({ id: uid(`turn:${c.key}:${seq}`), company_id: COMPANY, call_id: uid(`call:${c.key}`), seq, speaker, start_ms: t, end_ms: t + len, text });
      t += len + 500;
    });
  }
  await insertMissing("call_turns", turns);
  await insertMissing("leads", LEADS.map((l) => ({
    id: uid(`lead:${l.key}`), company_id: COMPANY, source: l.source, source_id: l.call ? uid(`call:${l.call}`) : null, channel: l.source === "call" ? "phone" : null,
    type: l.type, title: l.title, status: l.status, priority: l.priority ?? "normal", tags: l.priority === "urgent" ? ["urgent"] : [],
    contact_id: CONTACTS[l.contact]!.id, branch_id: BR.east, assignee_id: l.assignee === "owner" ? ownerId : l.assignee === "staff" ? staffId : null,
    due_at: new Date(new Date(ago(l.minAgo)).getTime() + (l.priority === "urgent" ? 15 : 120) * 60_000).toISOString(),
    closed_at: l.status === "won" || l.status === "lost" ? ago(l.minAgo - 3 * HOUR) : null, lost_reason: l.lost ?? null,
    payload: { ...l.payload, phone: CONTACTS[l.contact]!.phone, name: CONTACTS[l.contact]!.name },
    idempotency_key: `demo-seed:${l.key}`, created_at: ago(l.minAgo), updated_at: ago(Math.max(0, l.minAgo - 60)),
  })));
  const events: Record<string, unknown>[] = [];
  for (const l of LEADS) {
    const lead = uid(`lead:${l.key}`);
    events.push({ id: uid(`ev:${l.key}:created`), company_id: COMPANY, lead_id: lead, actor_kind: l.source === "call" ? "ai" : "user", actor_id: l.source === "call" ? null : ownerId, action: "created", created_at: ago(l.minAgo) });
    if (l.assignee) events.push({ id: uid(`ev:${l.key}:assignee`), company_id: COMPANY, lead_id: lead, actor_kind: "user", actor_id: ownerId, action: "assignee", before: null, after: l.assignee === "owner" ? ownerId : staffId, created_at: ago(l.minAgo - 30) });
    if (l.status !== "new") events.push({ id: uid(`ev:${l.key}:status`), company_id: COMPANY, lead_id: lead, actor_kind: "user", actor_id: l.assignee === "staff" ? staffId : ownerId, action: "status", before: "new", after: l.status, comment: l.lost ?? null, created_at: ago(l.minAgo - 60) });
  }
  await insertMissing("lead_events", events);
  console.log(`• CRM: ${CONTACTS.length} контактов, ${LEADS.length} заявок, ${CALLS.length} демо-звонков`);
}

/** Вторая компания без пользователей — для e2e-проверки изоляции (не обязательна на облаке) */
async function seedIsolationFixture() {
  const other = uid("company:isolation");
  await insertMissing("companies", [{ id: other, name: "Isolation Check LLC", sphere: "other", status: "active" }]);
  await insertMissing("contacts", [{ id: uid("isolation:contact"), company_id: other, phone: "+996555000999", name: "Чужой клиент" }]);
  await insertMissing("leads", [{ id: uid("isolation:lead"), company_id: other, source: "manual", type: "other", title: "Чужая заявка (проверка изоляции)", idempotency_key: "demo-seed:isolation" }]);
  console.log(`• Изоляция: компания ${other}, заявка ${uid("isolation:lead")}`);
}

async function main() {
  const ownerEmail = process.env.DEMO_OWNER_EMAIL ?? "demo.owner@example.com";
  const staffEmail = process.env.DEMO_STAFF_EMAIL ?? "demo.staff@example.com";
  const owner = await ensureUser(ownerEmail, "Demo Owner", process.env.DEMO_OWNER_PASSWORD);
  const staff = await ensureUser(staffEmail, "Demo Staff", process.env.DEMO_STAFF_PASSWORD);
  await seedCompany(owner.id, staff.id);
  await seedKnowledge();
  await seedCrm(owner.id, staff.id);
  if (args.has("--with-isolation-fixture")) await seedIsolationFixture();

  const pw = (p?: string) => p ?? "(не изменён — задайте DEMO_*_PASSWORD или --reset-passwords)";
  console.log(`\nГотово. Компания AutoCity Service: ${COMPANY}`);
  console.log(`Demo Owner: ${ownerEmail}  пароль: ${pw(owner.password)}`);
  console.log(`Demo Staff: ${staffEmail}  пароль: ${pw(staff.password)}`);
  const out = argValue("--out");
  if (out) {
    writeFileSync(out, [
      "# HACKATHON_ACCESS (не публиковать, не коммитить)",
      "",
      `- Public URL: ${process.env.APP_URL ?? "(укажите после деплоя)"}`,
      `- Demo Owner Email: ${ownerEmail}`,
      `- Demo Owner Password: ${pw(owner.password)}`,
      `- Demo Staff Email: ${staffEmail}`,
      `- Demo Staff Password: ${pw(staff.password)}`,
      "",
      "Сценарий проверки — docs/DEMO_SCRIPT.md.",
      "",
    ].join("\n"), { mode: 0o600 });
    console.log(`Доступы записаны в ${out} (права 600). Передайте жюри отдельно от репозитория.`);
  }
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
