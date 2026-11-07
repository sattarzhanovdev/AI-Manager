import { describe, expect, it } from "vitest";
import { DEMO_SNAPSHOT, guardText, initialState, respondOffline } from "@all/dialog";
import { companyFacts, extractPhone, leadTitle, mvpRules, priceInfo, resolveDate, toLlmHistory, zonedParts } from "@/lib/ai/helpers";
import ru from "@/messages/ru.json";
import ky from "@/messages/ky.json";

const TZ = "Asia/Bishkek";
// Пятница, 6 ноября 2026, 15:00 по Бишкеку (09:00 UTC)
const NOW = new Date("2026-11-06T09:00:00Z");

describe("даты заявки в часовом поясе компании", () => {
  it("сегодня/завтра/послезавтра", () => {
    expect(zonedParts(NOW, TZ).date).toBe("2026-11-06");
    expect(resolveDate("сегодня вечером", TZ, NOW)).toBe("2026-11-06");
    expect(resolveDate("завтра утром", TZ, NOW)).toBe("2026-11-07");
    expect(resolveDate("послезавтра", TZ, NOW)).toBe("2026-11-08");
  });
  it("день недели — ближайший будущий", () => {
    expect(resolveDate("в понедельник", TZ, NOW)).toBe("2026-11-09");
    expect(resolveDate("в пятницу", TZ, NOW)).toBe("2026-11-13");
  });
  it("число и месяц; прошедшая дата — следующий год", () => {
    expect(resolveDate("12.11", TZ, NOW)).toBe("2026-11-12");
    expect(resolveDate("01.02", TZ, NOW)).toBe("2027-02-01");
  });
  it("без даты — undefined (не выдумываем)", () => expect(resolveDate("когда удобно", TZ, NOW)).toBeUndefined());
  it("полночь по UTC — уже следующий день в Бишкеке", () => expect(zonedParts(new Date("2026-11-06T19:30:00Z"), TZ).date).toBe("2026-11-07"));
});

describe("извлечение телефона", () => {
  it("E.164 из реплики", () => expect(extractPhone("Меня зовут Азамат, мой номер +996 555 123 456")).toBe("+996555123456"));
  it("национальный формат", () => expect(extractPhone("0555 123 456")).toBe("+996555123456"));
  it("мусор не телефон", () => expect(extractPhone("заказ 12 34")).toBeUndefined());
});

describe("цены только из базы знаний", () => {
  it("«после осмотра» — без чисел", () => {
    expect(priceInfo({ id: "1", name: "Ремонт", synonyms: [], priceType: "after_inspection", currency: "KGS", staff: [] })).not.toMatch(/\d/);
  });
  it("диапазон", () => {
    expect(priceInfo({ id: "1", name: "ТО", synonyms: [], priceType: "range", priceMin: 450000, priceMax: 900000, currency: "KGS", staff: [] })).toBe("от 4 500 сом до 9 000 сом");
  });
  it("охрана заменяет выдуманную цену", () => {
    expect(guardText("Замена масла стоит 999 сом.", DEMO_SNAPSHOT).actions).toContain("price_replaced");
  });
  it("факты компании не содержат цен", () => {
    expect(companyFacts(DEMO_SNAPSHOT)).not.toMatch(/\d[\d\s]*\s?сом/);
  });
});

describe("правила веб-демо для LLM", () => {
  const rules = mvpRules({ tz: TZ, now: NOW, voice: true, state: { ...initialState(), fields: { name: "Азамат" } } });
  it("дата и честность о записи", () => {
    expect(rules).toContain("пятница, 2026-11-06");
    expect(rules).toMatch(/Никогда не говори, что время забронировано/);
    expect(rules).toContain("name=Азамат");
  });
});

describe("история диалога для LLM", () => {
  it("начинается с клиента и склеивает подряд идущие реплики", () => {
    const h = toLlmHistory([
      { author: "ai", body: "Здравствуйте!" }, { author: "client", body: "Сколько стоит?" }, { author: "client", body: "Замена масла" },
      { author: "ai", body: "1 500 сом" }, { author: "system", body: "служебное" },
    ]);
    expect(h).toEqual([{ role: "user", content: "Сколько стоит?\nЗамена масла" }, { role: "assistant", content: "1 500 сом" }]);
  });
});

describe("заявка из диалога", () => {
  it("заголовок записи", () => expect(leadTitle("booking", { service: "Замена масла", preferred_time: "завтра" })).toBe("Запись: Замена масла, завтра"));
  it("локальный движок не обещает подтверждённую запись", () => {
    let st = initialState();
    for (const m of ["Сколько стоит замена масла?", "Хочу записаться на завтра", "Меня зовут Азамат, мой номер +996 555 123 456"]) {
      const r = respondOffline(DEMO_SNAPSHOT, m, st, { channel: "chat", mode: "consult" });
      st = r.state;
      if (r.toolCalls.some((t) => t.name === "create_lead")) {
        expect(r.text).toMatch(/не подтверждённая запись/);
        expect(r.text).not.toMatch(/^Записала/);
      }
    }
  });
});

describe("локализация", () => {
  it("строки MVP есть в ru и ky", () => {
    for (const k of Object.keys(ru.mvp)) expect(ky.mvp).toHaveProperty(k);
    for (const k of Object.keys(ru.auth)) expect(ky.auth).toHaveProperty(k);
  });
});
