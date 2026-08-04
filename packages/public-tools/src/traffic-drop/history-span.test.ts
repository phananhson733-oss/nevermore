import { describe, expect, it } from "vitest";

import { buildTrafficDropReport } from "./report.ts";
import { firstVisibleDate, historySpanDays } from "./series.ts";
import type { TrafficDailyPoint } from "./types.ts";
import { BOTH_CLEAR } from "./__tests__/self-check-fixtures.ts";

/**
 * One definition of "how much history is there".
 *
 * This used to be four. The report measured from the first VISIBLE day, while
 * the twelve-week gate, the year-over-year gate and the check list each
 * measured from the first ROW — and Search Console does return real rows with
 * `impressions: 0` for days a young property existed but drew nothing. (That
 * is not a hypothetical: the property this tool was accepted against came back
 * with `{"date":"2026-06-29","clicks":0,"impressions":0}` as its first row.)
 *
 * The visible symptom was small — one screen saying "31 days of history" and
 * "history: 32" a few centimetres apart. The real problem was which of the two
 * the GATES used: the looser one. A site could clear a twelve-week threshold
 * the same page said it had not met, and be handed a "sustained decline" about
 * a history the report called too short to judge.
 */
function day(
  date: string,
  clicks: number,
  impressions: number,
): TrafficDailyPoint {
  return { date, clicks, impressions };
}

/** `leadingBlankDays` rows of real-but-empty history, then real traffic. */
function seriesWithBlankPrefix(
  leadingBlankDays: number,
  visibleDays: number,
): readonly TrafficDailyPoint[] {
  const start = Date.UTC(2026, 0, 1);
  const iso = (offset: number) =>
    new Date(start + offset * 86_400_000).toISOString().slice(0, 10);

  return [
    ...Array.from({ length: leadingBlankDays }, (_unused, index) =>
      day(iso(index), 0, 0),
    ),
    ...Array.from({ length: visibleDays }, (_unused, index) =>
      day(iso(leadingBlankDays + index), 40, 3_000),
    ),
  ];
}

describe("history span", () => {
  it("measures from the first visible day, not the first row", () => {
    const series = seriesWithBlankPrefix(30, 10);

    expect(firstVisibleDate(series)).toBe("2026-01-31");
    // Ten visible days, not the forty rows Search Console handed back.
    expect(historySpanDays(series)).toBe(10);
  });

  it("is null-and-zero together when nothing was ever visible", () => {
    const series = seriesWithBlankPrefix(20, 0);

    expect(firstVisibleDate(series)).toBeNull();
    expect(historySpanDays(series)).toBe(0);

    // The pair the report publishes has to agree: "0 days of history" beside a
    // start date is a span and a date contradicting each other on one line.
    const report = buildTrafficDropReport({
      daily: series,
      completedAt: "2026-07-31T00:00:00.000Z",
      selfChecks: BOTH_CLEAR,
    });
    expect(report.result.dataStartDate).toBeNull();
    expect(report.result.dayCount).toBe(0);
  });

  it("holds the twelve-week gate to the number the report shows", () => {
    // 60 blank rows then 60 visible days: 120 ROWS, but only 60 days of
    // visibility. The old row-based gate cleared twelve weeks here and went on
    // to look for a decline; the displayed history said 60 days.
    const series = seriesWithBlankPrefix(60, 60);
    const report = buildTrafficDropReport({
      daily: series,
      completedAt: "2026-07-31T00:00:00.000Z",
      selfChecks: BOTH_CLEAR,
    });

    expect(series).toHaveLength(120);
    expect(report.result.dayCount).toBe(60);
    expect(report.result.changePoint.state).toBe("insufficient_history");
    expect(report.result.changePoint.limitation).toBe(
      "history_below_twelve_weeks",
    );
  });

  it("still clears the gate on a genuinely long visible history", () => {
    const series = seriesWithBlankPrefix(0, 120);
    const report = buildTrafficDropReport({
      daily: series,
      completedAt: "2026-07-31T00:00:00.000Z",
      selfChecks: BOTH_CLEAR,
    });

    expect(report.result.dayCount).toBe(120);
    expect(report.result.changePoint.state).not.toBe("insufficient_history");
  });

  it("reports one history length everywhere in a single report", () => {
    const series = seriesWithBlankPrefix(1, 31);
    const report = buildTrafficDropReport({
      daily: series,
      completedAt: "2026-07-31T00:00:00.000Z",
      selfChecks: BOTH_CLEAR,
    });

    const seasonality = report.result.findings.find(
      (finding) => finding.id === "seasonality_unavailable",
    );
    const reported = seasonality?.measures.find(
      (measure) => measure.key === "history_days",
    )?.value;

    // The number in the finding and the number in the header are the same
    // measurement; they were 32 and 31 on the accepted production run.
    expect(reported).toBe(report.result.dayCount);
    expect(report.result.dayCount).toBe(31);
  });
});
