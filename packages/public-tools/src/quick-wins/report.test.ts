import { describe, expect, it } from "vitest";

import { MIN_BUCKET_QUERIES } from "../site-baseline/ctr-curve.ts";
import type { GscQueryRow } from "../site-baseline/types.ts";
import { QUICK_WINS_SCHEMA_VERSION, buildQuickWinsReport } from "./report.ts";

const COMPLETED_AT = "2026-08-03T09:00:00.000Z";

function row(
  query: string,
  position: number,
  impressions: number,
  clicks: number,
): GscQueryRow {
  return { query, position, impressions, clicks };
}

/** A healthy 5% band that clears both bucket gates. */
function healthyBand(): GscQueryRow[] {
  return Array.from({ length: MIN_BUCKET_QUERIES }, (_, i) =>
    row(`peer${i}`, 9, 1000, 50),
  );
}

function report(
  input: Partial<Parameters<typeof buildQuickWinsReport>[0]> = {},
) {
  return buildQuickWinsReport({
    window: { startDate: "2026-07-06", endDate: "2026-08-02" },
    rows: healthyBand(),
    brandTerms: [],
    completedAt: COMPLETED_AT,
    queryAggregation: "byProperty",
    ...input,
  });
}

describe("buildQuickWinsReport", () => {
  it("stamps a public-tool envelope that stores nothing", () => {
    const { run } = report();

    expect(run).toEqual({
      tool: "seo_quick_wins",
      schemaVersion: QUICK_WINS_SCHEMA_VERSION,
      scope: "property",
      mode: "public_preview",
      persistence: "none",
      completedAt: COMPLETED_AT,
    });
  });

  it("always declares that SERP causes are unobserved", () => {
    // We never detect AI Overviews or featured snippets, and the 2026-07-31
    // evaluation found those to be the leading cause of the gaps in this
    // table. A run that omitted this would be selling the table as a
    // diagnosis.
    expect(report().result.limitations).toContain("serp_cause_unobserved");
  });

  it("excludes brand queries from the curve and counts them", () => {
    const { result } = report({
      rows: [...healthyBand(), row("acme pricing", 9, 5000, 500)],
      brandTerms: ["acme"],
    });

    expect(result.curve.brandRowsExcluded).toBe(1);
    expect(result.rows.some((r) => r.query === "acme pricing")).toBe(false);
    // Brand rows must not lift the non-brand baseline.
    expect(
      result.curve.buckets.find((b) => b.bucketId === "8-11")?.ctr,
    ).toBeCloseTo(0.05);
  });

  it("reports insufficient_bucket_sample when no band clears the gates", () => {
    const { result } = report({ rows: [row("lonely", 9, 200, 1)] });

    expect(result.limitations).toContain("insufficient_bucket_sample");
    expect(result.rows).toEqual([]);
  });

  it("reports insufficient_query_sample when bands exist but no query qualifies", () => {
    // Every query is under the 100-impression floor, yet together they build
    // a usable band. "We could not look at any single query" is a different
    // statement from "we looked and there was nothing".
    const rows = Array.from({ length: 20 }, (_, i) => row(`t${i}`, 9, 50, 2));
    const { result } = report({ rows });

    expect(result.limitations).toContain("insufficient_query_sample");
    expect(result.limitations).not.toContain("insufficient_bucket_sample");
  });

  it("reports site_level_low_ctr_band when a whole band earns under one percent", () => {
    const rows = Array.from({ length: MIN_BUCKET_QUERIES + 1 }, (_, i) =>
      row(`weak${i}`, 9, 3000, 15),
    );
    const { result } = report({ rows });

    expect(result.limitations).toContain("site_level_low_ctr_band");
    expect(result.lowCtrBands.map((b) => b.bucketId)).toContain("8-11");
  });

  it("computes the anonymization gap from property totals", () => {
    const { result } = report({
      propertyTotals: {
        impressions: 10_000,
        clicks: 500,
        responseAggregationType: "byProperty",
      },
    });

    // healthyBand is 5,000 impressions and 250 clicks.
    expect(result.anonymization?.missingImpressionShare).toBeCloseTo(0.5);
    expect(result.anonymization?.missingClickShare).toBeCloseTo(0.5);
    expect(result.limitations).toContain("high_query_anonymization_gap");
  });

  it("leaves anonymization null when property totals were not supplied", () => {
    const { result } = report();

    expect(result.anonymization).toBeNull();
    expect(result.limitations).not.toContain("high_query_anonymization_gap");
  });

  it("does not flag a small anonymization gap", () => {
    const { result } = report({
      propertyTotals: {
        impressions: 5200,
        clicks: 260,
        responseAggregationType: "byProperty",
      },
    });

    expect(result.limitations).not.toContain("high_query_anonymization_gap");
  });

  it("reports a share of null rather than 0 when the property had no impressions", () => {
    const { result } = report({
      rows: [],
      propertyTotals: {
        impressions: 0,
        clicks: 0,
        responseAggregationType: "byProperty",
      },
    });

    expect(result.anonymization?.missingImpressionShare).toBeNull();
  });

  it("refuses to divide two different aggregation bases", () => {
    // Search Console picks its own basis once a query groups or filters by
    // page. Dividing one basis by another produces a number describing
    // neither, so the share is unavailable rather than approximate.
    const { result } = report({
      propertyTotals: {
        impressions: 10_000,
        clicks: 500,
        responseAggregationType: "byPage",
      },
      queryAggregation: "byProperty",
    });

    expect(result.anonymization?.missingImpressionShare).toBeNull();
    expect(result.anonymization?.missingClickShare).toBeNull();
    expect(result.limitations).toContain("aggregation_basis_mismatch");
    expect(result.limitations).not.toContain("high_query_anonymization_gap");
  });

  it("treats an unstated aggregation basis as not comparable", () => {
    const { result } = report({
      propertyTotals: {
        impressions: 10_000,
        clicks: 500,
        responseAggregationType: null,
      },
    });

    expect(result.anonymization?.missingImpressionShare).toBeNull();
  });

  it("reports null rather than a 0% gap when the rows exceed the property total", () => {
    // Not "we measured no withholding" — evidence that the two reads
    // disagree. Clamping to 0 would also suppress the gap limitation.
    const { result } = report({
      propertyTotals: {
        impressions: 100,
        clicks: 5,
        responseAggregationType: "byProperty",
      },
    });

    expect(result.anonymization?.missingImpressionShare).toBeNull();
    expect(result.anonymization?.propertyImpressions).toBe(100);
    expect(result.anonymization?.queryImpressions).toBe(5000);
  });

  it("reports the measured window so the table is not read as current", () => {
    expect(report().result.window).toEqual({
      startDate: "2026-07-06",
      endDate: "2026-08-02",
    });
  });

  it("reports partial_gsc_export when the caller saw truncation", () => {
    expect(report({ truncated: true }).result.limitations).toContain(
      "partial_gsc_export",
    );
    expect(report().result.limitations).not.toContain("partial_gsc_export");
  });

  it("reports brand_segment_insufficient_evidence when brand terms match almost nothing", () => {
    // The evaluated site had exactly 2 brand queries. Excluding them is right;
    // pretending we can say anything about the brand segment is not.
    const { result } = report({
      rows: [...healthyBand(), row("acme login", 9, 300, 40)],
      brandTerms: ["acme"],
    });

    expect(result.limitations).toContain("brand_segment_insufficient_evidence");
  });

  it("does not raise the brand limitation when no brand terms were given", () => {
    expect(report().result.limitations).not.toContain(
      "brand_segment_insufficient_evidence",
    );
  });

  it("never emits display prose, only codes", () => {
    const { result } = report({ rows: [row("lonely", 9, 200, 1)] });

    for (const code of result.limitations) {
      expect(code).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
