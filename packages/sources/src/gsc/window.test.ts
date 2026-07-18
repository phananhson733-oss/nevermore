import { describe, expect, it } from "vitest";
import { computeGscWindow } from "./window.ts";

/** Whole-day difference between two `YYYY-MM-DD` strings (b - a). */
function dayDiff(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

/** Add whole days to a `YYYY-MM-DD` string, returning a `YYYY-MM-DD` string. */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

describe("computeGscWindow", () => {
  it("ends 3 LA calendar days before now and spans 56 days", () => {
    // 2026-07-18 11:00 PDT -> LA calendar date is 2026-07-18.
    const window = computeGscWindow(new Date("2026-07-18T18:00:00Z"));

    expect(window.endDate).toBe("2026-07-15"); // 2026-07-18 minus the 3-day lag
    expect(window.startDate).toBe("2026-05-21"); // 55 days before endDate
    expect(dayDiff(window.startDate, window.endDate)).toBe(55);
  });

  it("splits into two contiguous, non-overlapping 28-day halves", () => {
    const window = computeGscWindow(new Date("2026-07-18T18:00:00Z"));

    expect(window.current28d).toEqual({ start: "2026-06-18", end: "2026-07-15" });
    expect(window.previous28d).toEqual({ start: "2026-05-21", end: "2026-06-17" });

    // Each half is exactly 28 inclusive days.
    expect(dayDiff(window.current28d.start, window.current28d.end)).toBe(27);
    expect(dayDiff(window.previous28d.start, window.previous28d.end)).toBe(27);

    // No gap, no overlap: previous ends the day before current starts.
    expect(addDays(window.previous28d.end, 1)).toBe(window.current28d.start);
    // Boundaries agree with the outer window.
    expect(window.startDate).toBe(window.previous28d.start);
    expect(window.endDate).toBe(window.current28d.end);
  });

  it("resolves the LA calendar date, not the UTC date, across the day boundary", () => {
    // 2026-07-18 05:00Z is still 2026-07-17 22:00 PDT in Los Angeles.
    const window = computeGscWindow(new Date("2026-07-18T05:00:00Z"));
    expect(window.endDate).toBe("2026-07-14"); // LA date 2026-07-17 minus 3 days
  });

  it("is DST-independent: winter (PST) windows are still exactly 28/56 days", () => {
    // 2026-01-15 04:00 PST -> LA calendar date 2026-01-15.
    const window = computeGscWindow(new Date("2026-01-15T12:00:00Z"));

    expect(window.endDate).toBe("2026-01-12");
    expect(dayDiff(window.startDate, window.endDate)).toBe(55);
    expect(dayDiff(window.current28d.start, window.current28d.end)).toBe(27);
    expect(dayDiff(window.previous28d.start, window.previous28d.end)).toBe(27);
  });

  it("honours an injected timezone override", () => {
    const instant = new Date("2026-07-18T05:00:00Z");
    // UTC keeps the calendar date at 2026-07-18 (no offset back a day).
    expect(computeGscWindow(instant, "UTC").endDate).toBe("2026-07-15");
    // LA rolls back to 2026-07-17.
    expect(computeGscWindow(instant, "America/Los_Angeles").endDate).toBe("2026-07-14");
  });
});
