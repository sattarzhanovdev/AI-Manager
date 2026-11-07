import { formatMoney, type KbSnapshot, type DialogState } from "@all/dialog";
import { toE164 } from "../format";

/** Чистые функции AI-диалога: без сети и базы, покрыты unit-тестами */

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const WD_RX: [RegExp, number][] = [
  [/понедельник/i, 1], [/вторник/i, 2], [/сред[уа]/i, 3], [/четверг/i, 4], [/пятниц[уа]/i, 5], [/суббот[уа]/i, 6], [/воскресень[ея]/i, 0],
];

/** Части даты в часовом поясе компании */
export function zonedParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday ?? "Sun");
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, weekday: wd };
}

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** «завтра», «в субботу», «12.11» → YYYY-MM-DD в часовом поясе компании; иначе undefined */
export function resolveDate(text: string | undefined, tz: string, now = new Date()): string | undefined {
  if (!text) return undefined;
  const { date, weekday } = zonedParts(now, tz);
  if (/послезавтра/i.test(text)) return addDays(date, 2);
  if (/завтра/i.test(text)) return addDays(date, 1);
  if (/сегодня/i.test(text)) return date;
  for (const [rx, wd] of WD_RX) if (rx.test(text)) return addDays(date, ((wd - weekday + 7) % 7) || 7);
  const m = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (m) {
    const day = Number(m[1]), month = Number(m[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(date.slice(0, 4));
      const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (!m[3] && candidate < date) { year += 1; return `${year}-${candidate.slice(5)}`; }
      return candidate;
    }
  }
  return undefined;
}

/** Цена услуги словами — LLM получает готовую строку и не считает сама */
export function priceInfo(sv: KbSnapshot["services"][number]): string {
  if (sv.priceType === "after_inspection") return "стоимость определяется после осмотра, сумму не называть";
  if (sv.priceType === "exact" && sv.priceMin != null) return formatMoney(sv.priceMin, sv.currency);
  if (sv.priceMin != null && sv.priceMax != null) return `от ${formatMoney(sv.priceMin, sv.currency)} до ${formatMoney(sv.priceMax, sv.currency)}`;
  if (sv.priceMin != null) return `от ${formatMoney(sv.priceMin, sv.currency)}`;
  return "цену уточнит администратор";
}

const DAY_RU: Record<string, string> = { mon: "пн", tue: "вт", wed: "ср", thu: "чт", fri: "пт", sat: "сб", sun: "вс" };
export function hoursLine(h: KbSnapshot["branches"][number]["hours"]): string {
  return (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const)
    .map((d) => `${DAY_RU[d]} ${h[d]?.length ? h[d]!.map(([a, z]) => `${a}–${z}`).join(", ") : "выходной"}`).join("; ");
}

/** Факты о компании для системного промпта: без цен (цены — только через get_service) */
export function companyFacts(s: KbSnapshot): string {
  const lines = [
    `Компания: ${s.company.name}. ${s.company.description}`,
    s.company.advantages.length ? `Преимущества: ${s.company.advantages.join("; ")}` : "",
    ...s.branches.map((b) => `Филиал «${b.name}»: ${b.address}${b.landmarks ? ` (${b.landmarks})` : ""}; телефон ${b.phones.join(", ") || "—"}; график: ${hoursLine(b.hours)}`),
    `Услуги (цены только через get_service): ${s.services.map((x) => x.name).join(", ") || "—"}`,
    ...Object.entries(s.booking).filter(([, v]) => v).map(([k, v]) => `Запись (${k}): ${v}`),
  ];
  return lines.filter(Boolean).join("\n");
}

export function mvpRules(opts: { tz: string; now?: Date; voice: boolean; state: DialogState }): string {
  const { date, time, weekday } = zonedParts(opts.now ?? new Date(), opts.tz);
  const known = Object.entries(opts.state.fields).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(", ") || "ничего";
  return [
    "ВЕБ-ДЕМО (важнее остального):",
    `- Сегодня ${WEEKDAYS[weekday]}, ${date}, сейчас ${time} (${opts.tz}).`,
    "- Это тест в браузере, а не телефонный звонок. transfer_to_human не соединяет, а создаёт срочную заявку на перезвон — для неё нужен телефон клиента.",
    "- Онлайн-календаря нет. Никогда не говори, что время забронировано или подтверждено. create_lead создаёт заявку на запись; после неё назови номер заявки из результата и скажи, что администратор свяжется и подтвердит время.",
    "- Перед create_lead собери имя, телефон, услугу и желаемый день/время. Ничего не придумывай за клиента.",
    "- Цены — только из get_service. Адреса и график — только из фактов ниже или get_hours. Если данных нет — скажи, что уточнит администратор, и предложи заявку.",
    `- Отвечай по-русски, 1–3 коротких предложения${opts.voice ? ", без списков, разметки и эмодзи — ответ будет озвучен" : ""}.`,
    `- Уже известно о клиенте: ${known}.`,
  ].join("\n");
}

/** Телефон из реплики клиента (E.164) */
export function extractPhone(text: string): string | undefined {
  const m = text.match(/(\+?\d[\d\s\-()]{7,}\d)/);
  if (!m) return undefined;
  const raw = m[1]!.replace(/[^\d+]/g, "");
  return toE164(raw) ?? (raw.length === 9 ? toE164(`0${raw}`) : null) ?? undefined;
}

export type LeadKind = "booking" | "consultation" | "order" | "complaint" | "reschedule" | "callback" | "other";
export function leadTitle(type: LeadKind, f: { service?: string; preferred_time?: string; comment?: string }): string {
  const svc = f.service?.trim();
  if (type === "booking") return `Запись: ${svc || "услуга не указана"}${f.preferred_time ? `, ${f.preferred_time}` : ""}`.slice(0, 200);
  if (type === "callback") return `Перезвонить${f.comment ? `: ${f.comment}` : ""}`.slice(0, 200);
  if (type === "complaint") return `Жалоба${svc ? `: ${svc}` : ""}`.slice(0, 200);
  return `${svc || "Заявка из диалога"}`.slice(0, 200);
}

export const HANDOFF_LABEL: Record<string, string> = {
  client_request: "клиент попросил администратора", complaint: "жалоба", emergency: "экстренная ситуация",
  discount_refund_warranty: "скидка, возврат или гарантия", not_understood: "AI не понял вопрос",
};

/** История из базы → сообщения LLM: начинается с user, роли чередуются */
export function toLlmHistory(rows: { author: string; body: string }[]): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of rows) {
    if (!r.body.trim() || (r.author !== "client" && r.author !== "ai")) continue;
    const role = r.author === "client" ? "user" : "assistant";
    if (!out.length && role === "assistant") continue;
    const last = out.at(-1);
    if (last && last.role === role) last.content += `\n${r.body}`;
    else out.push({ role, content: r.body });
  }
  return out;
}
