import { describe, expect, it } from "vitest";

import {
  describeBrandSplit,
  MAX_COVERAGE_SHIFT,
  MIN_WINDOW_CLICK_COVERAGE,
  type QueryWindowEvidence,
} from "./brand-split.ts";
import type { GscQueryRow } from "../site-baseline/types.ts";

function row(
  query: string,
  clicks: number,
  impressions = clicks * 20,
  position = 8,
): GscQueryRow {
  return { query, clicks, impressions, position };
}

function evidence(
  rows: readonly GscQueryRow[],
  options: {
    readonly totalClicks?: number | null;
    readonly aggregation?: string | null;
    readonly totalsAggregation?: string | null;
    readonly truncated?: boolean;
  } = {},
): QueryWindowEvidence {
  const clicks = rows.reduce((sum, r) => sum + r.clicks, 0);
  const impressions = rows.reduce((sum, r) => sum + r.impressions, 0);
  // `??` would swallow an explicit null, which is the case this helper exists
  // to express: totals we could not read at all.
  const totalClicks =
    options.totalClicks === undefined ? clicks : options.totalClicks;
  const aggregation = options.aggregation ?? "byProperty";

  return {
    startDate: "2026-01-01",
    endDate: "2026-01-07",
    rows,
    paging: { pagesFetched: 1, truncated: options.truncated ?? false },
    queryAggregation: aggregation,
    totals:
      totalClicks === null
        ? null
        : {
            clicks: totalClicks,
            impressions: Math.max(impressions, totalClicks),
            responseAggregationType: options.totalsAggregation ?? aggregation,
          },
  };
}

/** Brand side comfortably over both floors, non-brand collapsing. */
const BEFORE = [
  row("acme", 200),
  row("acme login", 60),
  row("acme pricing", 40),
  row("acme reviews", 30),
  row("acme app", 20),
  row("widget guide", 400),
  row("best widgets", 300),
];
const AFTER = [
  row("acme", 190),
  row("acme login", 55),
  row("acme pricing", 38),
  row("acme reviews", 28),
  row("acme app", 19),
  row("widget guide", 40),
  row("best widgets", 30),
];

const CONFIRMED = { brandTerms: ["acme"], brandTermsConfirmed: true } as const;

describe("describeBrandSplit", () => {
  it("says the read did not happen rather than inventing a null result", () => {
    expect(describeBrandSplit(null)).toEqual({
      kind: "not_available",
      reason: "read_not_performed",
      coverage: null,
    });
  });

  it("will not run on a brand list nobody confirmed", () => {
    // A domain-derived guess is a candidate for a form, not evidence. On the
    // property this was designed against, the guess is wrong in both
    // directions and silently so.
    const result = describeBrandSplit({
      before: evidence(BEFORE),
      after: evidence(AFTER),
      brandTerms: ["acme"],
      brandTermsConfirmed: false,
    });

    expect(result).toMatchObject({
      kind: "not_available",
      reason: "brand_terms_not_confirmed",
    });
    // Coverage is still reported: the reader deserves to know how much of the
    // property was visible even when the split is withheld.
    expect(result.coverage).not.toBeNull();
  });

  it("refuses when the two reads are on different aggregation bases", () => {
    const result = describeBrandSplit({
      before: evidence(BEFORE, { totalsAggregation: "byPage" }),
      after: evidence(AFTER),
      ...CONFIRMED,
    });

    expect(result).toMatchObject({
      kind: "not_available",
      reason: "aggregation_basis_mixed",
    });
  });

  it("refuses when too much of the property is withheld", () => {
    // The evaluated property was missing 64% of its clicks from the query
    // report. A group-versus-group ratio computed on the visible third can be
    // wrong by more than the difference it is measuring.
    const visible = BEFORE.reduce((sum, r) => sum + r.clicks, 0);
    const result = describeBrandSplit({
      before: evidence(BEFORE, { totalClicks: Math.round(visible / 0.36) }),
      after: evidence(AFTER, { totalClicks: Math.round(visible / 0.36) }),
      ...CONFIRMED,
    });

    expect(result).toMatchObject({
      kind: "not_available",
      reason: "coverage_below_floor",
    });
    expect(result.coverage?.before.clickShare).toBeLessThan(
      MIN_WINDOW_CLICK_COVERAGE,
    );
  });

  it("refuses when the two windows are not equally visible", () => {
    // Equal-but-low coverage biases both sides the same way. UNEQUAL coverage
    // biases the comparison itself, which is the thing being reported — and it
    // is the specific mechanism that manufactures "non-brand fell further" out
    // of a uniform decline.
    const beforeVisible = BEFORE.reduce((sum, r) => sum + r.clicks, 0);
    const afterVisible = AFTER.reduce((sum, r) => sum + r.clicks, 0);
    const result = describeBrandSplit({
      before: evidence(BEFORE, {
        totalClicks: Math.round(beforeVisible / 0.95),
      }),
      after: evidence(AFTER, { totalClicks: Math.round(afterVisible / 0.65) }),
      ...CONFIRMED,
    });

    expect(result).toMatchObject({
      kind: "not_available",
      reason: "coverage_shift_too_large",
    });
    const shift =
      (result.coverage?.before.clickShare ?? 0) -
      (result.coverage?.after.clickShare ?? 0);
    expect(Math.abs(shift)).toBeGreaterThan(MAX_COVERAGE_SHIFT);
  });

  it("refuses on a brand side too small to carry a percentage", () => {
    const tinyBrand = [row("acme", 4), row("widget guide", 400)];
    const result = describeBrandSplit({
      before: evidence(tinyBrand),
      after: evidence([row("acme", 4), row("widget guide", 40)]),
      ...CONFIRMED,
    });

    expect(result).toMatchObject({
      kind: "not_available",
      reason: "brand_sample_below_floor",
    });
  });

  it("describes the slice with its coverage attached", () => {
    const result = describeBrandSplit({
      before: evidence(BEFORE),
      after: evidence(AFTER),
      ...CONFIRMED,
    });

    expect(result.kind).toBe("slice");
    if (result.kind !== "slice") return;
    expect(result.brand.queries).toBe(5);
    expect(result.nonBrand.queries).toBe(2);
    // 330 of 350 brand clicks held; 70 of 700 non-brand clicks did.
    expect(result.brand.clickChangeRatio).toBeCloseTo(-20 / 350, 6);
    expect(result.nonBrand.clickChangeRatio).toBeCloseTo(-0.9, 6);
    expect(result.shape).toBe("non_brand_declined_more");
    // Coverage travels with the number it qualifies, always.
    expect(result.coverage.before.clickShare).toBe(1);
  });

  it("calls a uniform decline uniform", () => {
    const result = describeBrandSplit({
      before: evidence(BEFORE),
      after: evidence(
        BEFORE.map((r) => row(r.query, Math.round(r.clicks / 10))),
      ),
      ...CONFIRMED,
    });

    expect(result.kind).toBe("slice");
    if (result.kind !== "slice") return;
    expect(result.shape).toBe("both_declined");
  });

  it("does not call a flat pair a decline", () => {
    const result = describeBrandSplit({
      before: evidence(BEFORE),
      after: evidence(BEFORE),
      ...CONFIRMED,
    });

    expect(result.kind).toBe("slice");
    if (result.kind !== "slice") return;
    expect(result.shape).toBe("no_material_change");
  });

  it("reports an unknown withheld share as unknown, never as zero", () => {
    const result = describeBrandSplit({
      before: evidence(BEFORE, { totalClicks: null }),
      after: evidence(AFTER),
      ...CONFIRMED,
    });

    expect(result).toMatchObject({
      kind: "not_available",
      reason: "property_totals_unavailable",
    });
    expect(result.coverage?.before.clickShare).toBeNull();
  });
});
