import { describe, expect, it } from "vitest";

import {
  ASTROLOGYWIKI_BAND_8_11,
  ASTROLOGYWIKI_BAND_TOTALS,
  PUBLISHED_BENCHMARK_8_11,
} from "./__tests__/astrologywiki-queries.ts";
import { buildQuickWinsReport } from "./report.ts";

const COMPLETED_AT = "2026-08-03T09:00:00.000Z";

function run() {
  return buildQuickWinsReport({
    window: { startDate: "2026-07-02", endDate: "2026-07-29" },
    rows: ASTROLOGYWIKI_BAND_8_11,
    brandTerms: [],
    completedAt: COMPLETED_AT,
    queryAggregation: "byProperty",
    // §1.3: the query report held 32,465 impressions and 338 clicks against
    // property totals of 60,156 and 943.
    propertyTotals: {
      impressions: 60_156,
      clicks: 943,
      responseAggregationType: "byProperty",
    },
  });
}

describe("P0-1 on real astrologywiki data", () => {
  it("reproduces the published band totals exactly", () => {
    // The anchor, asserted directly rather than through a CTR tolerance that
    // an arithmetic slip can hide inside.
    const impressions = ASTROLOGYWIKI_BAND_8_11.reduce(
      (sum, r) => sum + r.impressions,
      0,
    );
    const clicks = ASTROLOGYWIKI_BAND_8_11.reduce((sum, r) => sum + r.clicks, 0);

    expect(ASTROLOGYWIKI_BAND_8_11).toHaveLength(
      ASTROLOGYWIKI_BAND_TOTALS.queries,
    );
    expect(impressions).toBe(ASTROLOGYWIKI_BAND_TOTALS.impressions);
    expect(clicks).toBe(ASTROLOGYWIKI_BAND_TOTALS.clicks);
  });

  it("reproduces the measured band CTR of about 0.51%", () => {
    const band = run().result.curve.buckets.find((b) => b.bucketId === "8-11");

    expect(band?.ctr).toBeCloseTo(0.0051, 4);
    expect(band?.queryCount).toBe(451);
  });

  it("measures the band at roughly a sixth of the published benchmark", () => {
    // This is the whole reason the site's own curve exists. A fixed table
    // would call this entire band under-performing, which is what the v2
    // detector did — and every one of its hits turned out to be a query
    // Google answers in the results page.
    const band = run().result.curve.buckets.find((b) => b.bucketId === "8-11");

    expect(band!.ctr!).toBeLessThan(PUBLISHED_BENCHMARK_8_11 / 5);
  });

  it("flags the band itself rather than presenting 6 separate findings", () => {
    const { result } = run();

    expect(result.limitations).toContain("site_level_low_ctr_band");
    expect(result.lowCtrBands.map((b) => b.bucketId)).toEqual(["8-11"]);
    // Guard the vacuous pass: every() is true on an empty array, so a
    // regression that emptied the table would slip through.
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every((r) => r.baselineBandUnderOnePercent)).toBe(true);
  });

  it("shrinks the yamal gap roughly fivefold versus a published benchmark", () => {
    const row = run().result.rows.find(
      (r) => r.query === "lamine yamal zodiac sign",
    );

    const againstPublished =
      row!.impressions * PUBLISHED_BENCHMARK_8_11 - row!.clicks;

    expect(row!.clickGap).toBeGreaterThan(0);
    expect(row!.clickGap).toBeLessThan(againstPublished / 4);
  });

  it("keeps the query out of its own baseline", () => {
    // At 3,439 of the band's 16,885 impressions this row is a fifth of its
    // own benchmark. Left in, it would flatten the very gap being measured.
    const { result } = run();
    const row = result.rows.find((r) => r.query === "lamine yamal zodiac sign");
    const band = result.curve.buckets.find((b) => b.bucketId === "8-11");

    expect(row!.baselineCtr).toBeGreaterThan(band!.ctr!);
  });

  it("admits it cannot explain any of it", () => {
    // Every named row here is a query Search answers directly. The engine has
    // no way to know that, and says so on every run instead of implying the
    // gap is a title problem.
    expect(run().result.limitations).toContain("serp_cause_unobserved");
  });

  it("surfaces the anonymization gap the property actually has", () => {
    const { anonymization, limitations } = run().result;

    // §1.3 measured 46% of impressions and 64% of clicks missing from the
    // query report. This fixture only carries the 8-11 band, so its gap is
    // larger still — the point of the assertion is that the number is
    // reported at all, not that it matches one band.
    expect(anonymization!.missingImpressionShare!).toBeGreaterThan(0.46);
    expect(limitations).toContain("high_query_anonymization_gap");
  });

  it("yields a handful of rows, not a page of them", () => {
    // §1.3: only 54 queries site-wide clear 100 impressions. A table that
    // returned hundreds of rows from this property would mean the floor
    // stopped doing its job.
    expect(run().result.rows.length).toBeLessThanOrEqual(10);
    expect(run().result.excluded.below_impression_floor).toBe(445);
  });
});
