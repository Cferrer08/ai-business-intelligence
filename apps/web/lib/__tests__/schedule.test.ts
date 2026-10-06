import { describe, expect, it } from "vitest";
import { describeSchedule, isValidTimeZone, nextRun, zonedToUtc } from "@/lib/workflows/schedule";

const NY = "America/New_York";

describe("schedules", () => {
  it("daily at 8 AM New York, before and after today's slot", () => {
    expect(nextRun({ frequency: "daily", hour: 8, timezone: NY }, new Date("2026-10-06T11:00:00Z")).toISOString()).toBe("2026-10-06T12:00:00.000Z");
    expect(nextRun({ frequency: "daily", hour: 8, timezone: NY }, new Date("2026-10-06T12:00:00Z")).toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });

  it("keeps 8 AM local across the November DST change", () => {
    const s = { frequency: "weekly" as const, hour: 8, weekday: 1, timezone: NY };   // Mondays
    expect(nextRun(s, new Date("2026-10-27T00:00:00Z")).toISOString()).toBe("2026-11-02T13:00:00.000Z"); // EST: UTC-5
    expect(nextRun(s, new Date("2026-10-20T00:00:00Z")).toISOString()).toBe("2026-10-26T12:00:00.000Z"); // EDT: UTC-4
  });

  it("handles the March DST jump and skipped hours", () => {
    expect(zonedToUtc(2026, 3, 8, 8, NY).toISOString()).toBe("2026-03-08T12:00:00.000Z");   // after the jump: EDT
    expect(zonedToUtc(2026, 3, 8, 2, NY).toISOString()).toBe("2026-03-08T07:00:00.000Z");   // 2 AM doesn't exist; moves to 3 AM EDT
  });

  it("monthly on day 1, and other time zones", () => {
    expect(nextRun({ frequency: "monthly", hour: 9, dayOfMonth: 1, timezone: "Europe/Madrid" }, new Date("2026-10-06T00:00:00Z")).toISOString())
      .toBe("2026-11-01T08:00:00.000Z");
    expect(nextRun({ frequency: "daily", hour: 7, timezone: "Asia/Kolkata" }, new Date("2026-10-06T00:00:00Z")).toISOString())
      .toBe("2026-10-06T01:30:00.000Z");
  });

  it("validates time zones and describes schedules", () => {
    expect(isValidTimeZone("America/Mexico_City")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(describeSchedule({ frequency: "weekly", hour: 8, weekday: 1, timezone: NY })).toBe("Every Monday at 8:00 AM");
    expect(describeSchedule({ frequency: "monthly", hour: 17, dayOfMonth: 15, timezone: NY })).toBe("Monthly on day 15 at 5:00 PM");
  });
});

describe("repeated hour", () => {
  it("uses the first 1 AM on the November fall-back day", () => {
    expect(zonedToUtc(2026, 11, 1, 1, "America/New_York").toISOString()).toBe("2026-11-01T05:00:00.000Z");   // 1 AM EDT
  });
});
