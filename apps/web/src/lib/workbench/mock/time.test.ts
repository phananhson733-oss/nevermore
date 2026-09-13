import { afterEach, describe, expect, it } from "vitest";
import { daysAgo, formatLocalStamp, parseLocalStamp, stampDate, withinDays } from "./time.ts";

const ORIGINAL_TZ = process.env.TZ;
const TIME_ZONES = ["Asia/Shanghai", "America/Los_Angeles"] as const;
const STAMP_SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
/** getTimezoneOffset() on 2026-09-11 in each zone; proves the TZ switch took effect. */
const SEPTEMBER_OFFSET: Readonly<Record<(typeof TIME_ZONES)[number], number>> = {
  "Asia/Shanghai": -480,
  "America/Los_Angeles": 420,
};

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const calendarDaysBetween = (later: Date, earlier: Date): number =>
  Math.round(
    (Date.UTC(later.getFullYear(), later.getMonth(), later.getDate()) -
      Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate())) /
      86_400_000,
  );

describe("formatLocalStamp", () => {
  for (const tz of TIME_ZONES) {
    it(`formats local wall-clock fields in ${tz}`, () => {
      process.env.TZ = tz;
      const date = new Date(2026, 8, 11, 9, 5);
      expect(date.getTimezoneOffset()).toBe(SEPTEMBER_OFFSET[tz]);
      const stamp = formatLocalStamp(date);
      expect(stamp).toBe("2026-09-11 09:05");
      expect(stamp).toMatch(STAMP_SHAPE);
    });
  }
});

describe("parseLocalStamp", () => {
  for (const tz of TIME_ZONES) {
    it(`round-trips a stamp in ${tz}`, () => {
      process.env.TZ = tz;
      const date = parseLocalStamp("2026-09-11 09:05");
      expect(date).not.toBeNull();
      expect(date && formatLocalStamp(date)).toBe("2026-09-11 09:05");
    });
  }

  it("rejects calendar dates that do not exist", () => {
    expect(parseLocalStamp("2026-02-30 10:00")).toBeNull();
    expect(parseLocalStamp("2026-13-01 10:00")).toBeNull();
    expect(parseLocalStamp("2026-00-10 10:00")).toBeNull();
    expect(parseLocalStamp("2026-09-00 10:00")).toBeNull();
  });

  it("rejects out-of-range clock fields instead of rolling them over", () => {
    expect(parseLocalStamp("2026-09-11 24:00")).toBeNull();
    expect(parseLocalStamp("2026-09-11 09:60")).toBeNull();
    expect(parseLocalStamp("2026-09-11 23:59")).not.toBeNull();
  });

  it("rejects two-digit-era years that Date would remap to 19xx", () => {
    expect(parseLocalStamp("0099-01-01 10:00")).toBeNull();
  });

  it("rejects other shapes", () => {
    expect(parseLocalStamp("2026-09-11T09:05")).toBeNull();
    expect(parseLocalStamp("2026-09-11 09:05:00")).toBeNull();
    expect(parseLocalStamp("2026-09-11T01:05:00.000Z")).toBeNull();
    expect(parseLocalStamp("")).toBeNull();
  });
});

describe("daysAgo", () => {
  for (const tz of TIME_ZONES) {
    it(`goes back calendar days at a fixed hour in ${tz}`, () => {
      process.env.TZ = tz;
      const now = new Date(2026, 6, 15, 12, 0);
      const stamp = daysAgo(now, 7, 10);
      expect(stamp).toMatch(STAMP_SHAPE);
      const parsed = parseLocalStamp(stamp);
      expect(parsed?.getHours()).toBe(10);
      expect(parsed && calendarDaysBetween(now, parsed)).toBe(7);
    });

    it(`counts calendar days across a DST switch in ${tz}`, () => {
      process.env.TZ = tz;
      // US daylight saving starts 2026-03-08; seven days back from 03-12 crosses it.
      const now = new Date(2026, 2, 12, 9, 0);
      expect(daysAgo(now, 7, 10)).toBe("2026-03-05 10:54");
      expect(daysAgo(now, 0, 9)).toBe("2026-03-12 09:05");
    });

    it(`keeps the time of day when no hour is given in ${tz}`, () => {
      process.env.TZ = tz;
      const now = new Date(2026, 8, 11, 9, 5);
      expect(daysAgo(now, 1)).toBe("2026-09-10 09:05");
      expect(daysAgo(now, 11)).toBe("2026-08-31 09:05");
    });
  }

  it("does not mutate now", () => {
    const now = new Date(2026, 6, 15, 12, 0);
    const before = now.getTime();
    daysAgo(now, 7, 10);
    daysAgo(now, 3);
    expect(now.getTime()).toBe(before);
  });
});

describe("withinDays", () => {
  for (const tz of TIME_ZONES) {
    it(`includes stamps up to exactly N days old in ${tz}`, () => {
      process.env.TZ = tz;
      // July: neither zone switches DST inside the window, so 7 days is 7 * 24 h.
      const now = new Date(2026, 6, 15, 12, 0);
      expect(withinDays(daysAgo(now, 7), 7, now)).toBe(true);
      expect(withinDays(daysAgo(now, 0), 7, now)).toBe(true);
      expect(withinDays(daysAgo(now, 8), 7, now)).toBe(false);
      expect(withinDays("2026-07-08 11:59", 7, now)).toBe(false);
    });

    it(`excludes future stamps in ${tz}`, () => {
      process.env.TZ = tz;
      const now = new Date(2026, 6, 15, 12, 0);
      expect(withinDays("2026-07-15 12:01", 7, now)).toBe(false);
      expect(withinDays(daysAgo(now, -1), 7, now)).toBe(false);
    });
  }

  it("treats unparseable stamps as outside every window", () => {
    const now = new Date(2026, 6, 15, 12, 0);
    expect(withinDays("2026-07-15T12:00", 7, now)).toBe(false);
    expect(withinDays("", 365, now)).toBe(false);
  });
});

describe("stampDate", () => {
  it("returns the date part", () => {
    expect(stampDate("2026-09-11 09:05")).toBe("2026-09-11");
  });
});
