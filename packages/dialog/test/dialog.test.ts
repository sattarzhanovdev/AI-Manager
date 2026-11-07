import { describe, expect, it } from "vitest";
import { DEMO_SNAPSHOT as S, guardText, initialState, respondOffline, buildPrompt, completeness, missingRequired, allowedTools } from "../src";

const ctx = { channel: "voice" as const, mode: "consult" as const };

describe("guard", () => {
  it("заменяет выдуманную цену", () => {
    expect(guardText("Замена масла стоит 999 сом.", S).actions).toContain("price_replaced");
  });
  it("пропускает цену из снимка", () => {
    expect(guardText("Замена масла стоит 1 500 сом.", S).actions).not.toContain("price_replaced");
  });
  it("блокирует «я человек»", () => {
    const r = guardText("Нет, я живой человек.", S);
    expect(r.actions).toContain("human_claim");
    expect(r.text).toMatch(/виртуальный помощник/);
  });
});

describe("engine", () => {
  it("цена «после осмотра» без чисел", () => {
    const r = respondOffline(S, "Сколько стоит ремонт двигателя?", initialState(), ctx);
    expect(r.text).toMatch(/после осмотра/);
    expect(r.text).not.toMatch(/\d/);
  });
  it("честно отвечает на «вы робот?»", () => {
    expect(respondOffline(S, "Вы робот?", initialState(), ctx).text).toMatch(/виртуальный помощник/);
  });
  it("жалоба → передача человеку", () => {
    expect(respondOffline(S, "У меня жалоба, вы испортили машину", initialState(), ctx).handoff?.reason).toBe("complaint");
  });
  it("в режиме заявок get_service запрещён", () => {
    const r = respondOffline(S, "Сколько стоит замена масла?", initialState(), { channel: "voice", mode: "leads" });
    expect(r.toolCalls.find((t) => t.name === "get_service")?.status).toBe("rejected");
    expect(r.text).not.toMatch(/1\s?500/);
  });
  it("собирает заявку без переспрашивания", () => {
    let st = initialState();
    let r = respondOffline(S, "Хочу записаться на замену масла завтра в 11:00", st, ctx);
    st = r.state;
    expect(st.fields.service).toBe("Замена масла");
    r = respondOffline(S, "Меня зовут Азамат", st, ctx);
    st = r.state;
    r = respondOffline(S, "0555 12 34 56", st, ctx);
    expect(r.toolCalls.some((t) => t.name === "create_lead" && t.status === "ok")).toBe(true);
    expect(r.state.fields.phone).toBe("+996555123456");
  });
  it("промпт не содержит незаполненных переменных", () => {
    expect(buildPrompt(S, ctx)).not.toMatch(/\{\{/);
  });
});

describe("questionnaire", () => {
  it("пустая анкета — 0% и список обязательных", () => {
    expect(completeness({}, { services: 0, staff: 0, faq: 0 })).toBe(0);
    expect(missingRequired({}, { services: 0, staff: 0, faq: 0 }).length).toBeGreaterThan(10);
  });
  it("фаза 1а не включает функции записи", () => {
    expect(allowedTools("booking", "1a").map((t) => t.name)).not.toContain("book_slot");
  });
});
