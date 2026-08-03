import { describe, expect, it } from "vitest";

import {
  MIN_BUCKET_IMPRESSIONS,
  MIN_BUCKET_QUERIES,
  buildSiteCtrCurve,
} from "../site-baseline/ctr-curve.ts";
import type { GscQueryRow } from "../site-baseline/types.ts";
import { MIN_QUERY_IMPRESSIONS, buildEvidenceTable } from "./evidence.ts";

function row(
  query: string,
  position: number,
  impressions: number,
  clicks: number,
): GscQueryRow {
  return { query, position, impressions, clicks };
}

/** A band that clears both gates, earning a clean 5%. */
function healthyBand(prefix = "peer"): GscQueryRow[] {
  return Array.from({ length: MIN_BUCKET_QUERIES }, (_, i) =>
    row(`${prefix}${i}`, 9, 1000, 50),
  );
}

function tableOf(rows: readonly GscQueryRow[]) {
  return buildEvidenceTable(rows, buildSiteCtrCurve(rows));
}

describe("buildEvidenceTable", () => {
  it("computes the gap against a leave-one-out baseline", () => {
    const target = row("target", 9, 2000, 10);
    const table = tableOf([target, ...healthyBand()]);
    const found = table.rows.find((r) => r.query === "target");

    expect(found?.observedCtr).toBeCloseTo(0.005);
    // Peers only: 250 clicks / 5,000 impressions.
    expect(found?.baselineCtr).toBeCloseTo(0.05);
    expect(found?.expectedClicks).toBeCloseTo(100);
    expect(found?.clickGap).toBeCloseTo(90);
  });

  it("keeps a query's own weak result out of the baseline it is judged against", () => {
    // The target is four times the band's impressions. Left in, it would drag
    // the band down toward its own rate and hide its own gap.
    const target = row("dominant", 9, 20_000, 0);
    const table = tableOf([target, ...healthyBand()]);
    const found = table.rows.find((r) => r.query === "dominant");

    expect(found?.baselineCtr).toBeCloseTo(0.05);
  });

  it("sorts by gap, largest first", () => {
    const table = tableOf([
      row("small-gap", 9, 1000, 40),
      row("big-gap", 9, 5000, 0),
      row("mid-gap", 9, 2000, 20),
      ...healthyBand(),
    ]);

    const ranked = table.rows
      .filter((r) => r.query.endsWith("-gap"))
      .map((r) => r.query);

    expect(ranked).toEqual(["big-gap", "mid-gap", "small-gap"]);
  });

  it("keeps rows that beat the baseline, with a negative gap", () => {
    // The evidence table is a neutral record. A page doing better than the
    // site's own curve is evidence too, and dropping it would make the table
    // look like a list of problems rather than a measurement.
    const table = tableOf([row("winner", 9, 1000, 200), ...healthyBand()]);
    const found = table.rows.find((r) => r.query === "winner");

    expect(found).toBeDefined();
    expect(found!.clickGap).toBeLessThan(0);
  });

  it("excludes queries under the impression floor and counts them", () => {
    const table = tableOf([
      row("tiny", 9, MIN_QUERY_IMPRESSIONS - 1, 0),
      ...healthyBand(),
    ]);

    expect(table.rows.some((r) => r.query === "tiny")).toBe(false);
    expect(table.excluded.below_impression_floor).toBe(1);
  });

  it("excludes queries whose position falls outside every band", () => {
    const table = tableOf([row("deep", 45, 5000, 0), ...healthyBand()]);

    expect(table.rows.some((r) => r.query === "deep")).toBe(false);
    expect(table.excluded.position_outside_bands).toBe(1);
  });

  it("excludes queries whose band never cleared the sample gates", () => {
    // One lonely query at position 3: the band has impressions but not enough
    // distinct queries to be anyone's baseline.
    const table = tableOf([
      row("lonely", 3.5, MIN_BUCKET_IMPRESSIONS * 4, 10),
      ...healthyBand(),
    ]);

    expect(table.rows.some((r) => r.query === "lonely")).toBe(false);
    expect(table.excluded.bucket_not_usable).toBe(1);
  });

  it("excludes a query whose removal leaves no usable baseline", () => {
    const rows = [
      row("carries-the-band", 9, MIN_BUCKET_IMPRESSIONS * 5, 100),
      ...Array.from({ length: MIN_BUCKET_QUERIES }, (_, i) =>
        row(`speck${i}`, 9, 10, 0),
      ),
    ];
    const table = tableOf(rows);

    expect(table.rows.some((r) => r.query === "carries-the-band")).toBe(false);
    expect(table.excluded.no_leave_one_out_baseline).toBe(1);
  });

  it("flags rows measured against a band earning under one percent", () => {
    // The shape the 2026-07-31 evaluation actually found: a whole band at
    // roughly half a percent, where every query in it looks "below baseline".
    const band = Array.from({ length: MIN_BUCKET_QUERIES + 1 }, (_, i) =>
      row(`weak${i}`, 9, 3000, 15),
    );
    const table = tableOf(band);

    expect(table.rows.length).toBeGreaterThan(0);
    expect(table.rows.every((r) => r.baselineBandUnderOnePercent)).toBe(true);
  });

  it("does not flag rows measured against a healthy band", () => {
    const table = tableOf([row("target", 9, 1000, 10), ...healthyBand()]);

    expect(
      table.rows.find((r) => r.query === "target")?.baselineBandUnderOnePercent,
    ).toBe(false);
  });

  it("attaches a tail probability without letting it gate the row", () => {
    const table = tableOf([row("target", 9, 2000, 10), ...healthyBand()]);
    const found = table.rows.find((r) => r.query === "target");

    expect(found?.tailProbability).not.toBeNull();
    expect(found!.tailProbability!).toBeGreaterThanOrEqual(0);
    expect(found!.tailProbability!).toBeLessThanOrEqual(1);
  });

  it("returns an empty table with counted exclusions rather than throwing", () => {
    const table = tableOf([]);

    expect(table.rows).toEqual([]);
    expect(table.excluded.below_impression_floor).toBe(0);
  });
});
