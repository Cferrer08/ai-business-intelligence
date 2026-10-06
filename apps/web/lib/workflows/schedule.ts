/**
 * Schedules in the user's time zone. "Every Monday at 8:00" stays 8:00 local time across
 * daylight-saving changes. Uses the platform's time-zone data (Intl), no date library.
 */
export type Frequency = "daily" | "weekly" | "monthly";
export interface Schedule { frequency: Frequency; hour: number; weekday?: number | null; dayOfMonth?: number | null; timezone: string }

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

function parts(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(date).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour === 24 ? 0 : p.hour, min: p.minute, s: p.second };
}

/** Minutes the zone is ahead of UTC at this instant (e.g. -240 for New York in summer). */
export function offsetMinutes(date: Date, tz: string): number {
  const p = parts(date, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** The UTC instant of a local wall-clock time. A time skipped by a DST jump moves forward. */
export function zonedToUtc(y: number, m: number, d: number, h: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, 0, 0);
  const a = guess - offsetMinutes(new Date(guess), tz) * 60000;
  const b = guess - offsetMinutes(new Date(a), tz) * 60000;
  const hits = [a, b].filter((t) => parts(new Date(t), tz).h === h);
  // Repeated hour (autumn): the first occurrence. Skipped hour (spring): the later instant,
  // so the run happens just after the jump rather than an hour early.
  return new Date(hits.length ? Math.min(...hits) : Math.max(a, b));
}

/** First run strictly after `after`. */
export function nextRun(s: Schedule, after: Date): Date {
  const local = parts(after, s.timezone);
  for (let i = 0; i < 62; i++) {
    const day = new Date(Date.UTC(local.y, local.m - 1, local.d + i));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    if (s.frequency === "weekly" && day.getUTCDay() !== s.weekday) continue;
    if (s.frequency === "monthly" && d !== s.dayOfMonth) continue;
    const at = zonedToUtc(y, m, d, s.hour, s.timezone);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error("No run time found in the next two months");
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;

export function describeSchedule(s: Schedule): string {
  const at = `at ${hourLabel(s.hour)}`;
  if (s.frequency === "daily") return `Every day ${at}`;
  if (s.frequency === "weekly") return `Every ${DAYS[s.weekday ?? 1]} ${at}`;
  return `Monthly on day ${s.dayOfMonth} ${at}`;
}

export function formatInZone(date: Date, tz: string): string {
  return date.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}
