import { describe, expect, it } from "vitest";
import { can, seesOnlyOwn } from "@/lib/permissions";
import { formatDuration, formatMoney, toE164, plural } from "@/lib/format";
import ru from "@/messages/ru.json";

describe("права (раздел 05)", () => {
  it("публикует анкету только собственник", () => {
    expect(can("owner", "publish")).toBe(true);
    expect(can("admin", "publish")).toBe(false);
  });
  it("админ редактирует анкету по разрешению", () => {
    expect(can("admin", "edit_questionnaire")).toBe(false);
    expect(can("admin", "edit_questionnaire", { edit_questionnaire: true })).toBe(true);
  });
  it("бухгалтер видит только тариф", () => {
    expect(can("accountant", "view_billing")).toBe(true);
    expect(can("accountant", "view_ops")).toBe(false);
  });
  it("сотрудник видит своё", () => expect(seesOnlyOwn("staff")).toBe(true));
});

describe("форматы", () => {
  it("деньги из минорных единиц", () => expect(formatMoney(150000, "KGS")).toMatch(/1\s500 сом/));
  it("телефон в E.164", () => expect(toE164("0555 12 34 56")).toBe("+996555123456"));
  it("неверный телефон", () => expect(toE164("123")).toBeNull());
  it("длительность", () => expect(formatDuration(125)).toBe("02:05"));
  it("склонение", () => expect(plural(3, "минута", "минуты", "минут")).toBe("минуты"));
});

describe("i18n", () => {
  it("кнопки — глаголом, обращение на «вы»", () => {
    expect(ru.common.save).toBe("Сохранить");
    expect(JSON.stringify(ru)).not.toMatch(/\bты\b/);
  });
});
