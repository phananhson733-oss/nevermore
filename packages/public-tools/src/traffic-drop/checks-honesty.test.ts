import { describe, expect, it } from "vitest";

import { buildTrafficDropReport } from "./report.ts";
import type { TrafficCheck, TrafficDailyPoint } from "./types.ts";

/**
 * The invariant at the top of `checks.ts`: `clear` means "we ran this check and
 * found nothing". A check that could not run reports `not_available` with a
 * reason. Getting it wrong tells a de-indexed site it is healthy.
 *
 * Three ways it was broken, all of them producing a REASSURING answer, which
 * is the direction that costs a reader something.
 */
const COMPLETED_AT = "2026-07-31T00:00:00.000Z";
const RUN_DAY = Date.parse("2026-07-31T00:00:00.000Z");

/**
 * A date `daysBeforeRun` days before the run date.
 *
 * Positions are relative to the run rather than to a fixed epoch because the
 * visibility check now asks about NOW: a fixture anchored to an absolute date
 * silently drifts out of the window it is meant to be testing.
 */
function isoBeforeRun(daysBeforeRun: number): string {
  return new Date(RUN_DAY - daysBeforeRun * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** `days` steady days ending `endsDaysBeforeRun` days before the run. */
function steady(
  days: number,
  endsDaysBeforeRun: number,
): readonly TrafficDailyPoint[] {
  return Array.from({ length: days }, (_unused, index) => ({
    date: isoBeforeRun(endsDaysBeforeRun + (days - 1 - index)),
    clicks: 40,
    impressions: 3_000,
  }));
}

function checkFor(
  daily: readonly TrafficDailyPoint[],
  id: string,
): TrafficCheck {
  const report = buildTrafficDropReport({ daily, completedAt: COMPLETED_AT });
  const found = report.result.checks.find((entry) => entry.id === id);
  if (!found) throw new Error(`no check with id ${id}`);
  return found;
}

describe("check honesty", () => {
  it("never reports year-over-year as clear, because it is never run", () => {
    // Over thirteen months, so the old code took the branch that asked whether
    // a seasonality FINDING existed — and that finding is only ever emitted
    // when history is too SHORT. Above the threshold it returns null, so the
    // hit branch was unreachable and every long-lived site was told a
    // comparison that does not exist had checked out fine.
    const check = checkFor(steady(430, 3), "seasonality_yoy");

    expect(check.status).toBe("not_available");
    expect(check.unavailableReason).toBe("yoy_comparison_not_implemented");
  });

  it("still says which of the two reasons applies on a young site", () => {
    const check = checkFor(steady(200, 3), "seasonality_yoy");

    expect(check.status).toBe("not_available");
    expect(check.unavailableReason).toBe("history_below_thirteen_months");
  });

  it("judges lost visibility on calendar days, not on the last seven rows", () => {
    // A property that went dark: 200 healthy days, then Search Console simply
    // stops returning rows. `slice(-7)` reads the last seven ROWS — which are
    // the last seven days it was still healthy — and concluded the site "still
    // records impressions". The missing days ARE the evidence.
    const wentDark = steady(200, 30);
    const check = checkFor(wentDark, "sitewide_visibility_zeroed");

    // Nothing in the recent calendar window, so there is nothing to judge on.
    // Either honest answer is acceptable; "clear" is not.
    expect(check.status).not.toBe("clear");
  });

  it("still detects a site whose recent days really are zero", () => {
    // Here Search Console does keep returning rows, all of them zero. This is
    // the shape the check was written for and it must still fire.
    const zeroed = [
      ...steady(200, 10),
      ...Array.from({ length: 7 }, (_unused, index) => ({
        date: isoBeforeRun(9 - index),
        clicks: 0,
        impressions: 0,
      })),
    ];

    expect(checkFor(zeroed, "sitewide_visibility_zeroed").status).toBe("hit");
  });

  it("does not tell a long-lived site it lacks twelve weeks of history", () => {
    // Two hundred days of history, then a collapse three days before the end.
    // The site is old; it is the EVENT that is too recent to judge. Both land
    // on `insufficient_history`, and reporting the twelve-week reason for the
    // second states something about the reader's own data they can see is
    // false.
    const collapsed = [
      ...steady(200, 7),
      ...Array.from({ length: 4 }, (_unused, index) => ({
        date: isoBeforeRun(6 - index),
        clicks: 1,
        impressions: 60,
      })),
    ];

    const report = buildTrafficDropReport({
      daily: collapsed,
      completedAt: COMPLETED_AT,
    });
    const sustained = report.result.checks.find(
      (entry) => entry.id === "sustained_decline",
    );

    if (report.result.changePoint.state === "insufficient_history") {
      expect(report.result.dayCount).toBeGreaterThan(84);
      expect(sustained?.unavailableReason).not.toBe(
        "history_below_twelve_weeks",
      );
    }
  });
});
