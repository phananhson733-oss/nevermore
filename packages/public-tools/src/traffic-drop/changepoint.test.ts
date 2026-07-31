import { describe, expect, it } from "vitest";

import { detectTrafficChangePoint } from "./changepoint.ts";
import { ASTROLOGYWIKI_DAILY } from "./__tests__/astrologywiki-fixture.ts";
import type { TrafficDailyPoint } from "./types.ts";

/** Build a synthetic series of `days` consecutive days from 2026-01-01. */
function series(
  days: number,
  shape: (index: number) => { clicks: number; impressions: number },
): readonly TrafficDailyPoint[] {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: days }, (_unused, index) => {
    const date = new Date(start + index * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return { date, ...shape(index) };
  });
}

describe("detectTrafficChangePoint", () => {
  it("locates the real collapse on astrologywiki.com and splits it into three fixed windows", () => {
    const result = detectTrafficChangePoint(ASTROLOGYWIKI_DAILY);

    expect(result.state).toBe("sustained_decline");
    // The collapse is recent enough that the most recent window still contains
    // days Search Console has not finalised. The verdict stands and the caveat
    // rides along with it, rather than the tool either hiding the caveat or
    // refusing to answer.
    expect(result.limitation).toBe("recent_window_unfinalized");
    expect(result.windows).toHaveLength(3);

    const [peak, mid, recent] = result.windows;
    expect(peak).toEqual({
      id: "peak",
      startDate: "2026-07-09",
      endDate: "2026-07-15",
      clicks: 411,
      impressions: 20_626,
      ctr: 411 / 20_626,
    });
    expect(mid).toMatchObject({
      id: "mid",
      startDate: "2026-07-16",
      endDate: "2026-07-22",
      clicks: 168,
      impressions: 19_791,
    });
    expect(recent).toMatchObject({
      id: "recent",
      startDate: "2026-07-23",
      endDate: "2026-07-29",
      clicks: 78,
      impressions: 5_351,
    });
  });

  it("carries the two-stage shape the fixed 28-day comparison hid: clicks collapse while impressions hold", () => {
    const [peak, mid, recent] =
      detectTrafficChangePoint(ASTROLOGYWIKI_DAILY).windows;

    // Stage one: impressions barely move, clicks more than halve.
    expect(
      (mid!.impressions - peak!.impressions) / peak!.impressions,
    ).toBeCloseTo(-0.04, 2);
    expect((mid!.clicks - peak!.clicks) / peak!.clicks).toBeCloseTo(-0.59, 2);
    // Stage two: impressions finally collapse, and CTR recovers rather than falls.
    expect(
      (recent!.impressions - mid!.impressions) / mid!.impressions,
    ).toBeCloseTo(-0.73, 2);
    expect(recent!.ctr!).toBeGreaterThan(mid!.ctr!);
  });

  it("refuses to detect on less than twelve weeks of history", () => {
    const short = ASTROLOGYWIKI_DAILY.slice(-83);
    const result = detectTrafficChangePoint(short);

    expect(result.state).toBe("insufficient_history");
    expect(result.windows).toHaveLength(0);
    expect(result.limitation).not.toBeNull();
  });

  it("does not turn a young site's ordinary wobble into an event", () => {
    // Peaks at 84 clicks/week — below the absolute floor even though it is a
    // clean 3x spike over the surrounding weeks.
    const result = detectTrafficChangePoint(
      series(90, (index) => ({
        clicks: index >= 40 && index < 47 ? 12 : 4,
        impressions: 900,
      })),
    );

    expect(result.state).toBe("no_material_decline");
    expect(result.windows).toHaveLength(0);
    // ...and it says why, rather than letting "no decline found" read as a
    // clean bill of health for a site it cannot actually assess.
    expect(result.limitation).toBe("site_below_detection_floor");
  });

  it("does not claim the small-site limitation for a site that is simply stable", () => {
    const result = detectTrafficChangePoint(
      series(90, () => ({ clicks: 300, impressions: 20_000 })),
    );

    expect(result.state).toBe("no_material_decline");
    expect(result.limitation).toBeNull();
  });

  it("does not report a decline while the site is still growing", () => {
    const result = detectTrafficChangePoint(
      series(90, (index) => ({ clicks: index * 2, impressions: index * 100 })),
    );

    expect(result.state).toBe("no_material_decline");
  });

  it("separates a dip that bounced back from a decline that persisted", () => {
    // Peak week, one week far below it, then a partial recovery that never
    // returns to peak. The drop is real but it did not hold for two windows.
    const result = detectTrafficChangePoint(
      series(90, (index) => {
        if (index >= 74) return { clicks: 20, impressions: 1_600 };
        if (index >= 67) return { clicks: 4, impressions: 300 };
        if (index >= 60) return { clicks: 30, impressions: 2_400 };
        return { clicks: 5, impressions: 400 };
      }),
    );

    expect(result.state).toBe("transient_visibility_anomaly");
    expect(result.limitation).toBe("recovery_observed_within_one_window");
  });

  it("stays quiet once a dip has fully recovered to the site's normal level", () => {
    // Recovering all the way back makes that level the site's normal week, so
    // there is no peak standing out from it and nothing to warn about.
    const result = detectTrafficChangePoint(
      series(90, (index) => {
        if (index >= 67) return { clicks: 30, impressions: 2_400 };
        if (index >= 60) return { clicks: 4, impressions: 300 };
        if (index >= 40) return { clicks: 30, impressions: 2_400 };
        return { clicks: 5, impressions: 400 };
      }),
    );

    expect(result.state).toBe("no_material_decline");
  });

  it("reports an unavailable CTR as null rather than zero", () => {
    const result = detectTrafficChangePoint(
      series(90, (index) => {
        if (index >= 40 && index < 47)
          return { clicks: 40, impressions: 3_000 };
        if (index >= 47) return { clicks: 0, impressions: 0 };
        return { clicks: 2, impressions: 500 };
      }),
    );

    const recent = result.windows.find((window) => window.id === "recent");
    expect(recent?.impressions).toBe(0);
    expect(recent?.ctr).toBeNull();
  });

  it("cuts windows by calendar date, not by row position", () => {
    // Search Console omits days a property drew nothing. With rows missing, an
    // index-sliced "7-day window" silently spans two or three weeks and gets
    // compared against a real week.
    const gappy = series(200, (index) => ({
      clicks: index >= 150 ? 4 : 40,
      impressions: index >= 150 ? 300 : 3_000,
    })).filter((_day, index) => index % 3 !== 0);

    const result = detectTrafficChangePoint(gappy);

    for (const window of result.windows) {
      const span =
        (Date.parse(`${window.endDate}T00:00:00Z`) -
          Date.parse(`${window.startDate}T00:00:00Z`)) /
        86_400_000;
      expect(span).toBe(6);
    }
  });

  it("does not call the end of a seasonal spike a decline", () => {
    // A retailer: quiet baseline, a promotional peak, then back to the same
    // baseline. Returning to normal is not a decline, however steep the fall
    // from the peak looks.
    const retailer = series(200, (index) => {
      if (index >= 150 && index < 164) {
        return { clicks: 900, impressions: 40_000 };
      }
      return { clicks: 120, impressions: 9_000 };
    });

    const result = detectTrafficChangePoint(retailer);

    expect(result.state).toBe("no_material_decline");
    expect(result.limitation).toBe("returned_to_prior_normal");
  });

  it("still reports a decline that falls below the pre-spike baseline", () => {
    const collapsed = series(200, (index) => {
      if (index >= 164) return { clicks: 20, impressions: 1_500 };
      if (index >= 150) return { clicks: 900, impressions: 40_000 };
      return { clicks: 120, impressions: 9_000 };
    });

    expect(detectTrafficChangePoint(collapsed).state).toBe("sustained_decline");
  });

  it("stays sensitive once a collapse has lasted most of the history", () => {
    // The peak floor is judged against the weeks BEFORE the candidate. Judged
    // against the whole series instead, the median falls with the decline and
    // the tool goes quiet exactly when the problem is worst.
    const longCollapse = series(200, (index) =>
      index >= 70
        ? { clicks: 15, impressions: 1_200 }
        : { clicks: 300, impressions: 20_000 },
    );

    expect(detectTrafficChangePoint(longCollapse).state).toBe(
      "sustained_decline",
    );
  });

  it("does not let a peak at the very end of the series pose as a decline", () => {
    const growing = series(120, (index) =>
      index >= 113
        ? { clicks: 400, impressions: 20_000 }
        : { clicks: 30, impressions: 2_000 },
    );

    expect(detectTrafficChangePoint(growing).state).toBe("no_material_decline");
  });

  it("drops duplicate dates instead of double-counting them into a peak", () => {
    const base = series(120, () => ({ clicks: 30, impressions: 2_000 }));
    const duplicated = [...base, ...base.slice(60, 67)];

    const fromDuplicated = detectTrafficChangePoint(duplicated);
    expect(fromDuplicated).toEqual(detectTrafficChangePoint(base));
  });

  it("accepts an out-of-order series without changing the verdict", () => {
    const shuffled = [...ASTROLOGYWIKI_DAILY].reverse();
    const result = detectTrafficChangePoint(shuffled);

    expect(result.state).toBe("sustained_decline");
    expect(result.windows[0]?.startDate).toBe("2026-07-09");
  });
});
