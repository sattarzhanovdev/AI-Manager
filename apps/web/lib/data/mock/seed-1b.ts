// Демо-данные фазы 1б: чаты (виджет, Telegram, WhatsApp), ресурсы и записи, талоны, лист ожидания.
import type { Appointment, ChatMessage, Conversation, Resource, Ticket, WaitlistEntry } from "@all/db";
import { contacts, services, staff } from "./seed";

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (t: number) => new Date(t).toISOString();
const TZ_OFFSET_H = 6; // Asia/Bishkek

/** Начало локального дня (Бишкек) со сдвигом в днях, в UTC-мс */
export function localDayStart(offsetDays = 0, from = NOW): number {
  const local = new Date(from + TZ_OFFSET_H * HOUR);
  local.setUTCHours(0, 0, 0, 0);
  return local.getTime() - TZ_OFFSET_H * HOUR + offsetDays * 24 * HOUR;
}
const at = (day: number, h: number, m = 0) => localDayStart(day) + h * HOUR + m * MIN;

// ───────────── Чаты ─────────────
type Seed = { channel: Conversation["channel"]; contact: number; state: Conversation["state"]; minsAgo: number; assignee?: string; needsHuman?: boolean; windowH?: number; msgs: [ChatMessage["author"], string, { voice?: number; image?: string }?][] };

const SEEDS: Seed[] = [
  { channel: "telegram", contact: 3, state: "ai", minsAgo: 2, msgs: [
    ["client", "Здравствуйте, сколько стоит развал-схождение?"],
    ["ai", "Здравствуйте! Развал-схождение — 1 800 сом, около 45 минут. Записать вас?"],
    ["client", "А в субботу можно?"],
    ["ai", "Да, в субботу работаем с 10 до 16. Во сколько удобно?"] ] },
  { channel: "widget", contact: 8, state: "draft", minsAgo: 4, needsHuman: false, msgs: [
    ["client", "Добрый день! У меня Lexus RX, стучит подвеска спереди. Можете посмотреть?"],
    ["ai", "Добрый день! Да, с Lexus работаем. Ремонт подвески — цена после осмотра. Когда удобно приехать на диагностику?", undefined] ] },
  { channel: "whatsapp", contact: 12, state: "operator", minsAgo: 18, assignee: "u_admin", windowH: 20, msgs: [
    ["client", "Мне вчера поменяли колодки, а сегодня скрипят 😕"],
    ["ai", "Мне жаль, что так вышло. Передаю администратору — она разберётся."],
    ["system", "Айжан Бекова взяла чат"],
    ["operator", "Здравствуйте! Это Айжан. Подъезжайте сегодня до 18:00, мастер проверит бесплатно по гарантии."],
    ["client", "Хорошо, буду к 17"] ] },
  { channel: "telegram", contact: 21, state: "ai", minsAgo: 35, needsHuman: true, msgs: [
    ["client", "", { voice: 14 }],
    ["ai", "Поняла вас. Индивидуальную скидку на ремонт АКПП согласует администратор — передаю ваш вопрос."] ] },
  { channel: "whatsapp", contact: 30, state: "operator", minsAgo: 26 * 60, assignee: "u_staff1", windowH: -2, msgs: [
    ["client", "Скиньте, пожалуйста, счёт на оплату для ИП"],
    ["operator", "Добрый день! Уточню у бухгалтера и пришлю."] ] },
  { channel: "widget", contact: 44, state: "ai", minsAgo: 70, msgs: [
    ["client", "Есть ли у вас комната ожидания?"],
    ["ai", "Да, есть комната ожидания с кофе и Wi-Fi."],
    ["client", "Отлично, спасибо!"] ] },
  { channel: "telegram", contact: 51, state: "closed", minsAgo: 5 * 60, msgs: [
    ["client", "Запишите на замену масла завтра в 10"],
    ["ai", "Записала на замену масла завтра в 10:00. Подтвердим по телефону. Хорошего дня!"],
    ["system", "Создана заявка и запись в календаре"] ] },
  { channel: "widget", contact: 60, state: "closed", minsAgo: 26 * 60, msgs: [
    ["client", "Вы делаете покраску?"],
    ["ai", "Нет, кузовной ремонт и покраску мы не делаем."] ] },
  { channel: "telegram", contact: 72, state: "ai", minsAgo: 9, msgs: [
    ["client", "Фото приборки — горит вот это", { image: "dashboard.jpg" }],
    ["ai", "Вижу фото. Такие ошибки лучше проверить на компьютерной диагностике — 1 200 сом, 40 минут. Записать?"] ] },
];

export const conversations: Conversation[] = [];
export const messages: ChatMessage[] = [];

SEEDS.forEach((s, i) => {
  const c = contacts[s.contact]!;
  const id = `cv_${i + 1}`;
  const last = NOW - s.minsAgo * MIN;
  s.msgs.forEach(([author, body, extra], j) => {
    const t = last - (s.msgs.length - 1 - j) * 50_000;
    messages.push({
      id: `ms_${i + 1}_${j}`, conversationId: id, direction: author === "client" ? "in" : "out", author,
      authorId: author === "operator" ? s.assignee : undefined,
      body: body || undefined,
      attachments: extra?.voice ? [{ kind: "voice", name: "voice.ogg", durationS: extra.voice }] : extra?.image ? [{ kind: "image", name: extra.image }] : [],
      transcript: extra?.voice ? "Здравствуйте, мне нужно отремонтировать коробку автомат, сделаете скидку если оплачу сразу?" : undefined,
      status: s.state === "draft" && author === "ai" && j === s.msgs.length - 1 ? "draft" : "delivered",
      createdAt: iso(t),
    });
  });
  const visible = messages.filter((m) => m.conversationId === id && m.status !== "draft");
  const lastMsg = visible.at(-1)!;
  conversations.push({
    id, channel: s.channel, contactId: c.id, contactName: c.name, contactPhone: c.phone, state: s.state, assigneeId: s.assignee,
    windowExpiresAt: s.windowH != null ? iso(NOW + s.windowH * HOUR) : undefined,
    lastMessageAt: lastMsg.createdAt, lastMessage: lastMsg.body ?? (lastMsg.attachments[0]?.kind === "voice" ? "🎤 Голосовое" : "📎 Вложение"),
    unread: s.state === "closed" ? 0 : lastMsg.author === "client" ? 1 : 0, needsHuman: !!s.needsHuman || s.state === "draft", tags: [],
  });
  if (!c.channels.includes(s.channel)) c.channels.push(s.channel);
});

export const quickReplies = [
  { key: "адрес", text: "Мы находимся по адресу ул. Ахунбаева, 119, за АЗС «Газпром», синие ворота." },
  { key: "график", text: "Работаем пн–пт с 9:00 до 19:00, в субботу с 10:00 до 16:00." },
  { key: "оплата", text: "Оплатить можно наличными, картой или по QR MBank." },
  { key: "гарантия", text: "На все работы даём гарантию 12 месяцев." },
];

/** Одобренные шаблоны WhatsApp — единственное, что можно отправить вне 24-часового окна */
export const templates = [
  { key: "reminder", text: "Здравствуйте, {{name}}! Напоминаем о записи в автосервис «Мотор». Ответьте на это сообщение, если нужно перенести." },
  { key: "followup", text: "Здравствуйте, {{name}}! Мы подготовили ответ на ваш вопрос. Напишите нам, чтобы продолжить диалог." },
];

// ───────────── Ресурсы и записи ─────────────
export const resources: Resource[] = [
  ...staff.filter((s) => s.bookable).map((s) => ({ id: `rs_${s.id}`, kind: "staff" as const, name: s.name, staffId: s.id, branchId: s.branchId })),
  { id: "rs_lift2", kind: "equipment", name: "Подъёмник 2", branchId: "br_1" },
];

const APPTS: [number, number, number, number, number, number, boolean, string?][] = [
  // [день, ресурс, час, мин, услуга, контакт, создано AI, статус]
  [0, 0, 9, 0, 0, 5, true], [0, 0, 10, 0, 2, 9, false], [0, 0, 13, 30, 0, 14, true], [0, 0, 15, 0, 4, 17, false, "done"],
  [0, 1, 10, 0, 1, 22, true], [0, 1, 11, 0, 1, 25, true], [0, 1, 14, 0, 3, 28, false],
  [0, 2, 11, 0, 4, 31, true], [0, 2, 12, 0, 5, 33, false],
  [0, 3, 9, 30, 9, 36, false], [0, 3, 16, 0, 10, 38, true],
  [1, 0, 10, 0, 0, 40, true], [1, 1, 10, 0, 1, 42, true], [1, 2, 11, 0, 4, 46, false], [1, 0, 14, 0, 6, 48, false],
  [2, 1, 9, 0, 1, 50, true], [2, 3, 12, 0, 11, 52, false], [-1, 0, 11, 0, 0, 55, true, "done"], [-1, 1, 15, 0, 3, 57, false, "no_show"],
  [3, 0, 10, 0, 0, 61, true], [4, 2, 12, 0, 5, 63, false],
];

export const appointments: Appointment[] = APPTS.map(([d, r, h, m, s, c, ai, status], i) => {
  const sv = services[s]!;
  const ct = contacts[c]!;
  const start = at(d, h, m);
  return {
    id: `ap_${i + 1}`, resourceId: resources[r]!.id, serviceId: sv.id, serviceName: sv.name, contactId: ct.id, contactName: ct.name ?? ct.phone, contactPhone: ct.phone,
    startsAt: iso(start), endsAt: iso(start + Math.max(30, sv.durationMin ?? 60) * MIN), status: (status as Appointment["status"]) ?? "booked", createdByAi: ai,
  };
});
// Блокировка времени (обед)
appointments.push({ id: "ap_block_1", resourceId: resources[0]!.id, startsAt: iso(at(0, 12, 0)), endsAt: iso(at(0, 13, 0)), status: "blocked", createdByAi: false, note: "Обед" });

// ───────────── Талоны и лист ожидания (режим поликлиник) ─────────────
const DOCTORS = [["Асанова Г. К.", "Терапевт"], ["Мамытов Б. Т.", "Терапевт"], ["Исакова Н. А.", "Педиатр"], ["Садыков Э. М.", "Кардиолог"]] as const;
export const tickets: Ticket[] = [];
DOCTORS.forEach(([doctor, specialty], di) => {
  for (let k = 0; k < 8; k++) {
    const start = at(1, 8 + Math.floor(k / 2), (k % 2) * 30);
    tickets.push({
      id: `tk_${di}_${k}`, doctor, specialty, startsAt: iso(start), opensAt: iso(at(0, 7, 30)),
      status: specialty === "Кардиолог" ? "taken" : k < 5 ? "taken" : "open",
      contactName: k < 5 || specialty === "Кардиолог" ? contacts[di * 8 + k]!.name ?? "—" : undefined,
      contactPhone: k < 5 || specialty === "Кардиолог" ? contacts[di * 8 + k]!.phone : undefined,
    });
  }
});

export const waitlist: WaitlistEntry[] = [
  ...[80, 81, 82].map((c, i) => ({ id: `wl_k_${i}`, scope: "Кардиолог", contactName: contacts[c]!.name ?? "—", contactPhone: contacts[c]!.phone!, position: i + 1, status: "waiting" as const, createdAt: iso(NOW - (3 - i) * HOUR) })),
  ...[90, 91].map((c, i) => ({ id: `wl_p_${i}`, scope: "Педиатр", contactName: contacts[c]!.name ?? "—", contactPhone: contacts[c]!.phone!, position: i + 1, status: "waiting" as const, createdAt: iso(NOW - (2 - i) * HOUR) })),
];
