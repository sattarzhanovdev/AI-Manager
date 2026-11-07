import type { KbSnapshot } from "./snapshot";
import { findService, searchKb, type KbHit } from "./search";
import { guardText, guardToolCall, type GuardAction } from "./guard";
import { formatMoney } from "./money";
import { allowedTools, type AiModeKey, type Phase } from "./tools";
import { buildPrompt, PROMPT_VERSION } from "./prompt";

/**
 * Движок диалога. Один для голоса и чатов.
 * - LLM-путь: buildPrompt + TOOLS → провайдер (apps/voice, apps/workers/chat).
 * - Детерминированный путь (`respondOffline`) — для тестового чата анкеты без ключей провайдеров и для eval-смоука.
 * Оба пути проходят через одну охрану ответа.
 */

export interface DialogState {
  fields: { name?: string; phone?: string; service?: string; preferred_time?: string };
  failedAttempts: number;
  wantsLead: boolean;
  leadCreated: boolean;
}

export const initialState = (): DialogState => ({ fields: {}, failedAttempts: 0, wantsLead: false, leadCreated: false });

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: "ok" | "rejected";
}

export interface EngineReply {
  text: string;
  toolCalls: ToolCallRecord[];
  sources: KbHit[];
  guard: GuardAction[];
  handoff?: { reason: string };
  unanswered?: string;
  state: DialogState;
  promptVersion: string;
}

export interface EngineContext {
  channel: "voice" | "chat";
  mode: AiModeKey;
  phase?: Phase;
}

const RX = {
  robot: /(вы|ты)\s+(робот|бот|человек|живой|ии|нейросеть)|это\s+(робот|бот|автоответчик)|с\s+кем\s+я\s+говорю/i,
  injection: /(игнорируй|забудь|ignore).{0,30}(инструкц|правил|промпт|instructions)|систем[а-яёa-z]*\s+промпт|покажи\s+(свои\s+)?инструкц|developer mode|ты\s+теперь/i,
  human: /(позов[а-яёa-z]*|соедин[а-яёa-z]*|переключ[а-яёa-z]*|дай[а-яёa-z]*|хочу|нужен|нужна)\s+.{0,20}(человек|оператор|администратор|менеджер|живого|директор)/i,
  complaint: /(жалоб|недовол|ужасн|безобраз|обманул|испортил|хамств|верните\s+деньги|претенз)/i,
  emergency: /(кровотечен|без\s+сознания|не\s+дышит|задыха|пожар|инфаркт|инсульт|судорог|умира)/i,
  money: /(скидк|возврат|вернуть\s+деньги|гаранти[а-яёa-z]+\s+случа|индивидуальн[а-яёa-z]+\s+цен|рассрочк)/i,
  price: /(сколько\s+стои|цен[аыу]|стоимост|поч[её]м|прайс|сколько\s+будет)/i,
  hours: /(график|во\s+сколько|до\s+скольки|работаете|открыт|выходн|часы\s+работы)/i,
  address: /(адрес|где\s+вы|где\s+находит|как\s+добраться|как\s+проехать|ориентир)/i,
  booking: /(запис|записать|запишите|хочу\s+на|забронир|перезвон)/i,
  bye: /^(спасибо|до\s+свидания|всё|пока)([,.!\s]+(до\s+свидания|пока|всего\s+доброго))?[.!\s]*$/i,
  phone: /(\+?\d[\d\s\-()]{8,}\d)/,
  name: /(?:[Мм]еня\s+зовут|[Ээ]то)\s+([А-ЯЁ][а-яё]+)/,
  time: /(сегодня|завтра|послезавтра|в\s+понедельник|во\s+вторник|в\s+среду|в\s+четверг|в\s+пятницу|в\s+субботу|в\s+воскресенье)(\s+(в|к)\s+\d{1,2}([:.]\d{2})?)?|(\d{1,2}[:.]\d{2})/i,
};

const DAY_RU: Record<string, string> = { mon: "пн", tue: "вт", wed: "ср", thu: "чт", fri: "пт", sat: "сб", sun: "вс" };

function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("996") || d.startsWith("7")) return `+${d}`;
  if (d.startsWith("0") && d.length === 10) return `+996${d.slice(1)}`;
  return `+${d}`;
}

function hoursText(s: KbSnapshot): string {
  const b = s.branches[0];
  if (!b) return "";
  const groups: string[] = [];
  for (const [day, ranges] of Object.entries(b.hours)) {
    const r = ranges?.map(([a, z]) => `${a}–${z}`).join(", ") || "выходной";
    groups.push(`${DAY_RU[day] ?? day} ${r}`);
  }
  return groups.join("; ");
}

function priceText(sv: KbSnapshot["services"][number]): string {
  if (sv.priceType === "after_inspection") return `Стоимость услуги «${sv.name}» определяется после осмотра — мастер назовёт её на месте.`;
  if (sv.priceType === "exact" && sv.priceMin != null) return `«${sv.name}» стоит ${formatMoney(sv.priceMin, sv.currency)}.`;
  if (sv.priceMin != null && sv.priceMax != null)
    return `«${sv.name}» — от ${formatMoney(sv.priceMin, sv.currency)} до ${formatMoney(sv.priceMax, sv.currency)}, точнее скажем после уточнения деталей.`;
  if (sv.priceMin != null) return `«${sv.name}» — от ${formatMoney(sv.priceMin, sv.currency)}.`;
  return "Точную цену уточнит администратор.";
}

export function greeting(s: KbSnapshot): string {
  return s.style.greeting || `Здравствуйте! ${s.company.name}, я ${s.style.assistantName}, виртуальный помощник. Чем помочь?`;
}

export function respondOffline(s: KbSnapshot, message: string, prev: DialogState, ctx: EngineContext): EngineReply {
  const state: DialogState = structuredClone(prev);
  const allowed = allowedTools(ctx.mode, ctx.phase ?? "1a").map((t) => t.name);
  const toolCalls: ToolCallRecord[] = [];
  let sources: KbHit[] = [];
  let handoff: EngineReply["handoff"];
  let unanswered: string | undefined;

  const call = (name: string, args: Record<string, unknown>, result?: unknown): boolean => {
    const g = guardToolCall(name, allowed);
    toolCalls.push({ name, arguments: args, result: g.ok ? result : g.reason, status: g.ok ? "ok" : "rejected" });
    return g.ok;
  };
  const toHuman = (reason: string, say: string): string => {
    handoff = { reason };
    if (call("transfer_to_human", { reason }, { status: "queued" })) return say;
    call("create_lead", { type: "callback", fields: { phone: state.fields.phone ?? "caller_id" }, priority: "urgent" }, { id: "lead" });
    return `${say} Я передам ваш вопрос администратору, вам перезвонят.`;
  };

  // Сбор полей из любой реплики: не переспрашиваем то, что клиент уже сказал
  const phone = message.match(RX.phone)?.[1];
  if (phone) state.fields.phone = normalizePhone(phone);
  const name = message.match(RX.name)?.[1];
  if (name) state.fields.name = name;
  const time = message.match(RX.time)?.[0];
  if (time) state.fields.preferred_time = time;
  const svc = findService(s, message);
  if (svc) state.fields.service = svc.name;

  let text: string;
  if (RX.injection.test(message)) {
    text = "Я могу помочь только с вопросами о нашей компании. Что вас интересует?";
  } else if (RX.emergency.test(message)) {
    text = toHuman("emergency", `Если это экстренная ситуация, звоните ${s.emergencyNumber}.`);
  } else if (RX.robot.test(message)) {
    text = `Да, я ${s.style.assistantName}, виртуальный помощник компании «${s.company.name}». Могу ответить на вопросы или передать администратору.`;
  } else if (RX.human.test(message)) {
    text = toHuman("client_request", "Конечно, соединяю с администратором.");
  } else if (RX.complaint.test(message)) {
    text = toHuman("complaint", "Мне очень жаль, что так получилось. Сейчас передам администратору, он разберётся.");
  } else if (RX.money.test(message)) {
    text = toHuman("discount_refund_warranty", "Такие вопросы решает администратор.");
  } else if (s.stop.topics.some((t) => t && message.toLowerCase().includes(t.toLowerCase()))) {
    text = s.stop.reply;
  } else if (RX.price.test(message)) {
    const sv = svc;
    if (sv && call("get_service", { name: sv.name }, { priceType: sv.priceType, priceMin: sv.priceMin, priceMax: sv.priceMax, currency: sv.currency })) {
      text = `${priceText(sv)} Записать вас?`;
      state.wantsLead = true;
    } else if (sv) {
      text = "Точную цену уточнит администратор. Оставить заявку, чтобы вам перезвонили?";
      state.wantsLead = true;
    } else {
      const top = s.services.slice(0, 3).map((x) => x.name.toLowerCase());
      text = top.length ? `Подскажите, какая услуга интересует? Например, ${top.join(", ")}.` : "Цену уточнит администратор. Оставить заявку?";
      state.failedAttempts += sv ? 0 : 1;
    }
  } else if (RX.hours.test(message)) {
    call("get_hours", { branch: s.branches[0]?.name ?? "" }, s.branches[0]?.hours);
    const h = hoursText(s);
    text = h ? `Мы работаем: ${h}.` : "График уточнит администратор.";
  } else if (RX.address.test(message)) {
    const b = s.branches[0];
    text = b ? `Мы находимся по адресу ${b.address}${b.landmarks ? `, ${b.landmarks}` : ""}.` : "Адрес уточнит администратор.";
  } else if (
    RX.booking.test(message) || phone ||
    (state.wantsLead && (name || time || (svc && !RX.price.test(message)) || /^(да|давайте|хорошо|ок|конечно|можно|верно)(?=$|[\s,.!])/i.test(message.trim())))
  ) {
    state.wantsLead = true;
    text = "";
  } else if (RX.bye.test(message)) {
    call("end_call", { outcome: state.leadCreated ? "lead_created" : "consultation" });
    text = "Спасибо за обращение! Хорошего дня.";
  } else {
    sources = searchKb(s, message);
    call("search_kb", { query: message }, sources);
    const faq = sources.find((h) => h.kind === "faq");
    if (faq) {
      text = faq.text;
    } else {
      state.failedAttempts += 1;
      unanswered = message;
      text = state.failedAttempts >= 3
        ? toHuman("not_understood", "Кажется, я вас не совсем понимаю.")
        : "Это уточнит администратор. Оставить заявку, чтобы вам перезвонили?";
      if (state.failedAttempts < 3) state.wantsLead = true;
    }
  }

  // Сбор заявки: обязательные поля по анкете, минимум — телефон
  if (state.wantsLead && !state.leadCreated && !handoff && text === "") {
    const required = s.client.required.map((x) => x.toLowerCase());
    if (!state.fields.name && required.some((r) => r.includes("имя"))) text = "Как к вам обращаться?";
    else if (!state.fields.phone) text = "Подскажите номер телефона для связи.";
    else if (!state.fields.service && s.services.length) text = "На какую услугу вас записать?";
    else if (!state.fields.preferred_time) text = "Когда вам удобно приехать?";
    else {
      const type = /перезвон/i.test(message) ? "callback" : "booking";
      if (call("create_lead", { type, fields: state.fields, priority: "normal" }, { id: "lead" })) {
        state.leadCreated = true;
        text = `Записала: ${state.fields.service ?? "заявка"}, ${state.fields.preferred_time}. Администратор подтвердит по номеру ${state.fields.phone}. Верно?`;
      } else {
        text = "Администратор перезвонит вам и всё уточнит.";
      }
    }
  }

  const guarded = guardText(text, s);
  return { text: guarded.text, toolCalls, sources, guard: guarded.actions, handoff, unanswered, state, promptVersion: PROMPT_VERSION };
}

export { buildPrompt };
