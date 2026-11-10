/** Calendar wall time follows the company, independent of the browser's timezone. */
export function calendarClock(timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const offset = (t: number) => {
    const p = Object.fromEntries(formatter.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(t / 1000) * 1000;
  };
  const fromLocal = (wall: number) => { let utc = wall; for (let i = 0; i < 3; i++) utc = wall - offset(utc); return utc; };
  const localDate = (t: number) => new Date(t + offset(t));
  const dayStart = (t: number) => { const d = localDate(t); return fromLocal(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
  return { fromLocal, localDate, dayStart, timezone };
}
