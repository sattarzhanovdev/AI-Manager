import { describe, it, expect } from "vitest";
import { calendarClock } from "../lib/calendar-clock";
describe("company calendar timezone", () => {
  it("uses Bishkek, Almaty and Moscow midnights instead of browser timezone", () => {
    const t = Date.parse("2026-11-10T12:00:00Z");
    for (const [tz, expected] of [["Asia/Bishkek", "2026-11-09T18:00:00.000Z"], ["Asia/Almaty", "2026-11-09T19:00:00.000Z"], ["Europe/Moscow", "2026-11-09T21:00:00.000Z"]]) {
      expect(new Date(calendarClock(tz!).dayStart(t)).toISOString()).toBe(expected);
    }
  });
  it("handles different summer and winter offsets", () => {
    const clock = calendarClock("Europe/Berlin");
    expect(new Date(clock.dayStart(Date.parse("2026-07-10T12:00:00Z"))).toISOString()).toBe("2026-07-09T22:00:00.000Z");
    expect(new Date(clock.dayStart(Date.parse("2026-11-10T12:00:00Z"))).toISOString()).toBe("2026-11-09T23:00:00.000Z");
  });
});
