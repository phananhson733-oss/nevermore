import { describe, expect, it } from "vitest";

import { daysBetween, historySpanDays } from "@sf/public-tools";
import type { TrafficDailyPoint } from "@sf/public-tools";

/**
 * The chart carries its own copy of these two helpers.
 *
 * Not by preference: importing a VALUE from `@sf/public-tools` inside a client
 * component pulls the whole engine index into the browser bundle, and that
 * index reaches `node:net` through the source adapters, which fails the build.
 * The type-only import the chart already had is erased at compile time, which
 * is why it never had this problem.
 *
 * A copy that nothing compares is a copy that drifts, and this one decides
 * where points land on the time axis — so the copy is restated here and
 * checked against the engine. If the engine's definition changes, this fails
 * and the chart gets updated with it.
 *
 * These bodies must stay character-identical to the ones in
 * `traffic-drop-chart.tsx`.
 */
const MS_PER_DAY = 86_400_000;

function chartDaysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      MS_PER_DAY,
  );
}

function chartHistorySpanDays(series: readonly TrafficDailyPoint[]): number {
  const first = series.find((day) => day.impressions > 0)?.date;
  const last = series[series.length - 1]?.date;
  if (!first || !last) return 0;
  return chartDaysBetween(first, last) + 1;
}

function day(
  date: string,
  clicks: number,
  impressions: number,
): TrafficDailyPoint {
  return { date, clicks, impressions };
}

describe("chart calendar helpers match the engine", () => {
  it("agrees on day distance, including across month and year ends", () => {
    const pairs: readonly (readonly [string, string])[] = [
      ["2026-01-01", "2026-01-01"],
      ["2026-01-01", "2026-01-31"],
      ["2026-02-27", "2026-03-02"],
      ["2025-12-30", "2026-01-02"],
      // A DST transition in local time; both sides work in UTC.
      ["2026-03-07", "2026-03-09"],
      ["2025-01-01", "2026-07-31"],
    ];

    for (const [from, to] of pairs) {
      expect(chartDaysBetween(from, to), `${from} → ${to}`).toBe(
        daysBetween(from, to),
      );
    }
  });

  it("agrees on history span, including with a zero-impression prefix", () => {
    const cases: readonly (readonly TrafficDailyPoint[])[] = [
      [],
      [day("2026-06-29", 0, 0)],
      [day("2026-06-29", 0, 0), day("2026-06-30", 0, 6)],
      [
        day("2026-06-29", 0, 0),
        day("2026-06-30", 0, 6),
        day("2026-07-30", 1, 17),
      ],
      [day("2026-01-01", 5, 500), day("2026-04-01", 5, 500)],
    ];

    for (const series of cases) {
      expect(chartHistorySpanDays(series), JSON.stringify(series)).toBe(
        historySpanDays(series),
      );
    }
  });
});
