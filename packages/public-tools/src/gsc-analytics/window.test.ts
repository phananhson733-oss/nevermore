import { describe, expect, it } from "vitest";

import {
  GSC_FINAL_LAG_DAYS,
  WINDOW_LENGTH_DAYS,
  latestFinalWindow,
  pacificDate,
  shiftDate,
} from "./window.ts";

describe("pacificDate", () => {
  it("reports the Pacific calendar day, not the UTC one", () => {
    // 05:00Z in August is 22:00 the previous day in Los Angeles (PDT, UTC-7).
    expect(pacificDate(new Date("2026-08-03T05:00:00Z"))).toBe("2026-08-02");
    expect(pacificDate(new Date("2026-08-03T08:00:00Z"))).toBe("2026-08-03");
  });

  it("follows the standard-time offset in winter", () => {
    // 07:00Z in January is 23:00 the previous day (PST, UTC-8).
    expect(pacificDate(new Date("2026-01-15T07:00:00Z"))).toBe("2026-01-14");
    expect(pacificDate(new Date("2026-01-15T08:00:00Z"))).toBe("2026-01-15");
  });

  it("crosses the spring-forward boundary on the right day", () => {
    // DST begins 2026-03-08. 09:00Z is 01:00 PST before the switch,
    // and the day does not roll over until 08:00Z.
    expect(pacificDate(new Date("2026-03-08T07:59:00Z"))).toBe("2026-03-07");
    expect(pacificDate(new Date("2026-03-08T08:01:00Z"))).toBe("2026-03-08");
  });

  it("crosses the fall-back boundary on the right day", () => {
    // DST ends 2026-11-01.
    expect(pacificDate(new Date("2026-11-01T06:59:00Z"))).toBe("2026-10-31");
    expect(pacificDate(new Date("2026-11-01T07:01:00Z"))).toBe("2026-11-01");
  });
});

describe("shiftDate", () => {
  it("moves a calendar day without touching time zones", () => {
    expect(shiftDate("2026-08-03", -1)).toBe("2026-08-02");
    expect(shiftDate("2026-08-03", 1)).toBe("2026-08-04");
  });

  it("crosses month and year boundaries", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(shiftDate("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("does not drift across a DST boundary", () => {
    // Naive Date arithmetic in a local zone loses or gains an hour here and
    // can land on the wrong calendar day. These are pure date shifts.
    expect(shiftDate("2026-03-09", -1)).toBe("2026-03-08");
    expect(shiftDate("2026-11-02", -1)).toBe("2026-11-01");
  });
});

describe("latestFinalWindow", () => {
  it("ends the configured lag behind the Pacific day, not the UTC day", () => {
    // 2026-08-03T05:00Z is still 2026-08-02 in Los Angeles.
    const window = latestFinalWindow(new Date("2026-08-03T05:00:00Z"));

    expect(window.endDate).toBe(shiftDate("2026-08-02", -GSC_FINAL_LAG_DAYS));
  });

  it("spans exactly the configured number of days, inclusive", () => {
    const window = latestFinalWindow(new Date("2026-08-03T20:00:00Z"));
    const start = Date.parse(`${window.startDate}T00:00:00Z`);
    const end = Date.parse(`${window.endDate}T00:00:00Z`);

    expect((end - start) / 86_400_000).toBe(WINDOW_LENGTH_DAYS - 1);
  });

  it("produces the same window for two instants inside one Pacific day", () => {
    // A run at 09:00Z and one at 23:00Z on the same Pacific day must compare
    // the same 28 days, or two visitors get different answers for reasons
    // that have nothing to do with their sites.
    const morning = latestFinalWindow(new Date("2026-08-03T09:00:00Z"));
    const evening = latestFinalWindow(new Date("2026-08-03T23:00:00Z"));

    expect(morning).toEqual(evening);
  });

  it("accepts an explicit window length for callers that need history", () => {
    const window = latestFinalWindow(new Date("2026-08-03T20:00:00Z"), {
      lengthDays: 7,
    });
    const start = Date.parse(`${window.startDate}T00:00:00Z`);
    const end = Date.parse(`${window.endDate}T00:00:00Z`);

    expect((end - start) / 86_400_000).toBe(6);
  });
});
