import { describe, expect, it } from "vitest";
import { classify, summarize } from "../src/postprocess";
import { mask } from "../src/queue";

describe("postprocess", () => {
  it("запись → lead_created", () => {
    const r = classify([{ speaker: "ai", text: "Здравствуйте" }, { speaker: "caller", text: "Хочу записаться на замену масла" }, { speaker: "ai", text: "Записала на субботу" }]);
    expect(r.type).toBe("booking");
    expect(r.outcome).toBe("lead_created");
  });
  it("вопрос без ответа попадает в список", () => {
    const r = classify([{ speaker: "caller", text: "Ставите газовое оборудование?" }, { speaker: "ai", text: "Это уточнит администратор." }]);
    expect(r.unanswered).toEqual(["Ставите газовое оборудование?"]);
    expect(r.flags).toContain("unanswered");
  });
  it("резюме не пустое", () => {
    expect(summarize([{ speaker: "caller", text: "Сколько стоит?" }, { speaker: "ai", text: "1500 сом." }])).toContain("1500");
  });
  it("логи без телефонов", () => {
    expect(mask('{"phone":"+996555123456"}')).toBe('{"phone":"+996****"}');
  });
});
