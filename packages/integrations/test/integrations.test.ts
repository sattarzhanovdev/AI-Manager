import { describe, expect, it } from "vitest";
import { nextRetry, isRetryable, sign, verify, renderEvent, parseCallback } from "../src";

describe("retry", () => {
  it("расписание 1м/5м/30м/2ч/12ч, затем очередь ошибок", () => {
    expect(nextRetry(1)).toEqual({ delayS: 60 });
    expect(nextRetry(5)).toEqual({ delayS: 43200 });
    expect(nextRetry(6)).toEqual({ dead: true });
    expect(isRetryable(503)).toBe(true);
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(429)).toBe(true);
  });
});

describe("webhook HMAC", () => {
  it("подпись проверяется и ломается при подмене тела", () => {
    const { header } = sign("s3cret", '{"a":1}');
    expect(verify("s3cret", '{"a":1}', header)).toBe(true);
    expect(verify("s3cret", '{"a":2}', header)).toBe(false);
    expect(verify("other", '{"a":1}', header)).toBe(false);
  });
});

describe("telegram", () => {
  it("новая заявка с кнопкой «Взять»", () => {
    const r = renderEvent({ type: "lead.created", leadId: "ld_1", number: 1, title: "Замена масла", urgent: false, url: "https://x" });
    expect(r.buttons[0]).toEqual({ text: "Взять", data: "take:ld_1" });
  });
  it("разбор callback", () => {
    expect(parseCallback("take:ld_5")).toEqual({ action: "take", leadId: "ld_5" });
    expect(parseCallback("called:cl_9")).toEqual({ action: "called", callId: "cl_9" });
    expect(parseCallback("bad")).toBeNull();
  });
});

import { normalizeTelegram, normalizeWhatsApp, verifyMeta } from "../src";
import { createHmac } from "node:crypto";

describe("нормализация чатов", () => {
  it("Telegram: голосовое", () => {
    const m = normalizeTelegram({ message: { message_id: 5, chat: { id: 77 }, from: { first_name: "Азамат" }, voice: { file_id: "f1", duration: 9 }, date: 1 } });
    expect(m?.attachments[0]).toMatchObject({ kind: "voice", durationS: 9 });
    expect(m?.externalChatId).toBe("77");
  });
  it("WhatsApp: текст и телефон", () => {
    const [m] = normalizeWhatsApp({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: "Нурлан" } }], messages: [{ from: "996555123456", id: "w1", timestamp: "1", text: { body: "Привет" } }] } }] }] });
    expect(m).toMatchObject({ phone: "+996555123456", text: "Привет", name: "Нурлан" });
  });
  it("подпись Meta", () => {
    const sig = "sha256=" + createHmac("sha256", "s").update("{}").digest("hex");
    expect(verifyMeta("s", "{}", sig)).toBe(true);
    expect(verifyMeta("s", "{ }", sig)).toBe(false);
  });
});
