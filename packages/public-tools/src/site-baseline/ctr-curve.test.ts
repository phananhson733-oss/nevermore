import { describe, expect, it } from "vitest";

import {
  MIN_BUCKET_IMPRESSIONS,
  MIN_BUCKET_QUERIES,
  bucketForPosition,
  buildSiteCtrCurve,
  leaveOneOutCtr,
} from "./ctr-curve.ts";
import type { GscQueryRow } from "./types.ts";

function row(
  query: string,
  position: number,
  impressions: number,
  clicks: number,
): GscQueryRow {
  return { query, position, impressions, clicks };
}

/** Enough rows to clear both bucket gates, all inside the 8-11 band. */
function usableBand(): GscQueryRow[] {
  return Array.from({ length: MIN_BUCKET_QUERIES }, (_, i) =>
    row(`q${i}`, 9, MIN_BUCKET_IMPRESSIONS, 5),
  );
}

describe("bucketForPosition", () => {
  it("places a position in the band whose lower bound it meets", () => {
    expect(bucketForPosition(1)?.id).toBe("1-2");
    expect(bucketForPosition(8.9)?.id).toBe("8-11");
    expect(bucketForPosition(15.99)?.id).toBe("11-16");
  });

  it("uses an exclusive upper bound so a boundary lands in exactly one band", () => {
    expect(bucketForPosition(4)?.id).toBe("4-6");
    expect(bucketForPosition(3.999)?.id).toBe("3-4");
  });

  it("returns null beyond the last band and above the first", () => {
    expect(bucketForPosition(21)).toBeNull();
    expect(bucketForPosition(40)).toBeNull();
    // Search Console never reports below 1, but a malformed row must not
    // silently land in the top band.
    expect(bucketForPosition(0.5)).toBeNull();
  });
});

describe("buildSiteCtrCurve", () => {
  it("aggregates impression-weighted CTR per band", () => {
    const curve = buildSiteCtrCurve([
      row("a", 9, 1000, 10),
      row("b", 10, 1000, 30),
      ...usableBand(),
    ]);

    const band = curve.buckets.find((b) => b.bucketId === "8-11");
    // Weighted, not the mean of the two rates: 40 clicks + the fixture band.
    expect(band?.clicks).toBe(40 + 5 * MIN_BUCKET_QUERIES);
    expect(band?.ctr).toBeCloseTo(
      (40 + 5 * MIN_BUCKET_QUERIES) /
        (2000 + MIN_BUCKET_IMPRESSIONS * MIN_BUCKET_QUERIES),
    );
  });

  it("marks a band with too few impressions as insufficient rather than dropping it", () => {
    const curve = buildSiteCtrCurve([row("a", 9, 10, 0), row("b", 9, 10, 0)]);
    const band = curve.buckets.find((b) => b.bucketId === "8-11");

    expect(band?.quality).toBe("insufficient_impressions");
  });

  it("marks a band with enough impressions but too few queries as insufficient", () => {
    const curve = buildSiteCtrCurve([
      row("only-one", 9, MIN_BUCKET_IMPRESSIONS * 10, 100),
    ]);
    const band = curve.buckets.find((b) => b.bucketId === "8-11");

    expect(band?.quality).toBe("insufficient_queries");
  });

  it("reports a band with zero impressions as ctr null, never 0", () => {
    const curve = buildSiteCtrCurve([]);
    const band = curve.buckets.find((b) => b.bucketId === "8-11");

    expect(band?.ctr).toBeNull();
    expect(band?.impressions).toBe(0);
  });

  it("counts rows beyond the last band instead of forcing them into 16-21", () => {
    const curve = buildSiteCtrCurve([row("deep", 45, 500, 0)]);

    expect(curve.rowsBeyondBands).toBe(1);
    expect(curve.buckets.find((b) => b.bucketId === "16-21")?.impressions).toBe(0);
  });

  it("emits every band even when the site only occupies one", () => {
    const curve = buildSiteCtrCurve(usableBand());

    expect(curve.buckets).toHaveLength(8);
  });
});

describe("leaveOneOutCtr", () => {
  it("excludes the query's own clicks and impressions from its baseline", () => {
    const rows = [
      row("target", 9, 1000, 0),
      ...Array.from({ length: MIN_BUCKET_QUERIES }, (_, i) =>
        row(`other${i}`, 9, 1000, 50),
      ),
    ];
    const curve = buildSiteCtrCurve(rows);
    const band = curve.buckets.find((b) => b.bucketId === "8-11");

    // Including the target would drag its own baseline down toward its own
    // rate, which is exactly the comparison we are trying to make.
    const baseline = leaveOneOutCtr(band!, rows[0]!);

    expect(baseline).toBeCloseTo(0.05);
    expect(band?.ctr).toBeLessThan(0.05);
  });

  it("returns null when removing the query empties the band", () => {
    const rows = [row("only", 9, 1000, 10)];
    const curve = buildSiteCtrCurve(rows);
    const band = curve.buckets.find((b) => b.bucketId === "8-11");

    expect(leaveOneOutCtr(band!, rows[0]!)).toBeNull();
  });

  it("returns null when the remainder falls under the impression gate", () => {
    // A baseline that only clears its gate because the measured query is in it
    // is not a baseline. Removing the query has to leave a usable band behind.
    const rows = [
      row("dominant", 9, MIN_BUCKET_IMPRESSIONS * 5, 10),
      ...Array.from({ length: MIN_BUCKET_QUERIES }, (_, i) =>
        row(`tiny${i}`, 9, 10, 0),
      ),
    ];
    const curve = buildSiteCtrCurve(rows);
    const band = curve.buckets.find((b) => b.bucketId === "8-11");

    expect(band?.quality).toBe("usable");
    expect(leaveOneOutCtr(band!, rows[0]!)).toBeNull();
  });
});
