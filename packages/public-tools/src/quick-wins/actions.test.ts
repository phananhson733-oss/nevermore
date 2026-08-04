import { describe, expect, it } from "vitest";

import type { CtrBucket, SiteCtrCurve } from "../site-baseline/types.ts";
import {
  buildQuickWinActions,
  firstCurveInversion,
  type QuickWinActionInput,
} from "./actions.ts";
import { withTracks } from "./track.ts";
import type { QuickWinActionId, QuickWinEvidenceRow } from "./types.ts";

function bucket(overrides: Partial<CtrBucket> = {}): CtrBucket {
  return {
    bucketId: "8-11",
    queryCount: 20,
    clicks: 100,
    impressions: 5000,
    ctr: 0.02,
    quality: "usable",
    ...overrides,
  };
}

function curveOf(buckets: readonly CtrBucket[]): SiteCtrCurve {
  return {
    buckets,
    rowsUsed: 100,
    brandRowsExcluded: 0,
    rowsBeyondBands: 0,
  };
}

function row(
  overrides: Partial<QuickWinEvidenceRow> = {},
): QuickWinEvidenceRow {
  return {
    query: "example query",
    position: 8.4,
    bucketId: "8-11",
    impressions: 4000,
    clicks: 12,
    observedCtr: 0.003,
    baselineCtr: 0.02,
    expectedClicks: 80,
    clickGap: 68,
    tailProbability: 0.0001,
    baselineBandUnderOnePercent: false,
    track: "read_the_serp",
    ...overrides,
  };
}

/** A run where nothing but the rows would fire an action. */
function input(
  overrides: Partial<QuickWinActionInput> = {},
): QuickWinActionInput {
  return {
    rows: withTracks([row()], new Set()),
    curve: curveOf([bucket()]),
    lowCtrBands: [],
    excluded: {
      below_impression_floor: 0,
      position_outside_bands: 0,
      bucket_not_usable: 0,
      no_leave_one_out_baseline: 0,
    },
    anonymization: {
      queryImpressions: 900,
      propertyImpressions: 1000,
      missingImpressionShare: 0.1,
      queryClicks: 90,
      propertyClicks: 100,
      missingClickShare: 0.1,
    },
    draftedQueries: [],
    anonymizationGapThreshold: 0.25,
    ...overrides,
  };
}

function ids(actions: readonly { id: QuickWinActionId }[]): QuickWinActionId[] {
  return actions.map((action) => action.id);
}

describe("buildQuickWinActions", () => {
  it("recommends nothing when there is nothing to recommend on", () => {
    // No rows means no table, and a page of advice under an empty table is
    // advice about a site we did not measure.
    expect(
      buildQuickWinActions(input({ rows: [], draftedQueries: [] })),
    ).toEqual([]);
  });

  it("always warns that the gap is not a forecast, on every run with rows", () => {
    // The single most load-bearing sentence in the report. A reader who takes
    // the gap column as recoverable clicks has been misled by our own table,
    // so the warning cannot be conditional — an absent warning reads as
    // permission.
    expect(ids(buildQuickWinActions(input()))).toContain(
      "avoid_gap_as_forecast",
    );
  });

  it("sums only the shortfalls, not the rows that beat the curve", () => {
    // Netting a positive gap against a negative one would report a smaller
    // total than any single row in it, which describes no query on the site.
    const actions = buildQuickWinActions(
      input({
        rows: withTracks(
          [
            row({ query: "a", clickGap: 40 }),
            row({ query: "b", clickGap: 10 }),
            row({ query: "c", clickGap: -100 }),
          ],
          new Set(),
        ),
      }),
    );
    const forecast = actions.find((a) => a.id === "avoid_gap_as_forecast");
    expect(forecast?.measures).toEqual([{ key: "totalGapClicks", value: 50 }]);
  });

  it("orders do before external_data before avoid", () => {
    // The order someone acts in. A warning only lands once the reader knows
    // what they were about to do.
    const actions = buildQuickWinActions(
      input({
        rows: withTracks(
          [row({ query: "a" }), row({ query: "b" })],
          new Set(["b"]),
        ),
        draftedQueries: ["b"],
      }),
    );
    const kinds = actions.map((action) => action.kind);
    const rank = { do: 0, external_data: 1, avoid: 2 } as const;
    expect(kinds.map((kind) => rank[kind])).toEqual(
      [...kinds].map((kind) => rank[kind]).sort((a, b) => a - b),
    );
  });

  it("names the largest shortfalls even when the rows arrive out of order", () => {
    // "The top five" and "the largest shortfall here is N" are claims about
    // ordering. Today the rows do arrive sorted, but an action that quietly
    // means "the first five we were handed" is wrong the moment anything
    // re-sorts upstream — and it would be wrong silently, in a worklist.
    const rows = withTracks(
      [
        row({ query: "small", clickGap: 3 }),
        row({ query: "huge", clickGap: 120 }),
        row({ query: "middling", clickGap: 40 }),
      ],
      new Set(),
    );
    const serp = buildQuickWinActions(input({ rows })).find(
      (action) => action.id === "open_serps_for_top_gaps",
    );

    expect(serp?.queries).toEqual(["huge", "middling", "small"]);
    expect(serp?.measures).toContainEqual({
      key: "largestGapClicks",
      value: 120,
    });
  });

  it("names the queries rather than only counting them", () => {
    // "Open the SERPs" is a sentiment until it names which ones.
    const rows = withTracks(
      Array.from({ length: 8 }, (_, i) =>
        row({ query: `q${i}`, clickGap: 100 - i }),
      ),
      new Set(),
    );
    const serp = buildQuickWinActions(input({ rows })).find(
      (action) => action.id === "open_serps_for_top_gaps",
    );

    expect(serp?.queries).toEqual(["q0", "q1", "q2", "q3", "q4"]);
    // The cap trims the list, never the count: a reader must be able to see
    // that three more were left out.
    expect(serp?.measures).toContainEqual({ key: "serpRowCount", value: 8 });
    expect(serp?.measures).toContainEqual({
      key: "largestGapClicks",
      value: 100,
    });
  });

  it("does not send anyone to a SERP for a row that has a candidate", () => {
    const rows = withTracks([row({ query: "a" })], new Set(["a"]));
    const actions = buildQuickWinActions(
      input({ rows, draftedQueries: ["a"] }),
    );

    expect(ids(actions)).toContain("apply_wording_candidates");
    expect(ids(actions)).not.toContain("open_serps_for_top_gaps");
  });

  it("reports a low band once, with the rows it covers", () => {
    const low = bucket({ bucketId: "4-6", ctr: 0.005 });
    const rows = withTracks(
      [
        row({ query: "a", bucketId: "4-6", baselineBandUnderOnePercent: true }),
        row({ query: "b", bucketId: "4-6", baselineBandUnderOnePercent: true }),
        row({ query: "c", bucketId: "8-11" }),
      ],
      new Set(),
    );
    const action = buildQuickWinActions(
      input({ rows, curve: curveOf([low, bucket()]), lowCtrBands: [low] }),
    ).find((a) => a.id === "read_low_band_as_one_finding");

    expect(action?.kind).toBe("avoid");
    expect(action?.bands).toEqual(["4-6"]);
    expect(action?.measures).toContainEqual({
      key: "lowBandRowCount",
      value: 2,
    });
  });

  it("counts only the rows in a low band that are actually short of it", () => {
    // The copy says every one of them falls short for the same structural
    // reason. A row that beats its own band's rate is not one of them, and
    // counting it makes an otherwise exact sentence false for one row.
    const low = bucket({ bucketId: "4-6", ctr: 0.005 });
    const rows = withTracks(
      [
        row({ query: "a", bucketId: "4-6", baselineBandUnderOnePercent: true }),
        row({
          query: "b",
          bucketId: "4-6",
          baselineBandUnderOnePercent: true,
          clickGap: -12,
        }),
      ],
      new Set(),
    );
    const action = buildQuickWinActions(
      input({ rows, curve: curveOf([low]), lowCtrBands: [low] }),
    ).find((a) => a.id === "read_low_band_as_one_finding");

    expect(action?.measures).toContainEqual({
      key: "lowBandRowCount",
      value: 1,
    });
  });

  it("raises the withheld share when it is large, unknown, or unmeasurable", () => {
    expect(ids(buildQuickWinActions(input({ anonymization: null })))).toContain(
      "size_the_withheld_share",
    );

    const uncomputable = buildQuickWinActions(
      input({
        anonymization: {
          queryImpressions: 900,
          propertyImpressions: 0,
          missingImpressionShare: null,
          queryClicks: 90,
          propertyClicks: 0,
          missingClickShare: null,
        },
      }),
    ).find((a) => a.id === "size_the_withheld_share");

    // Null, never 0. A 0% withheld share is the one answer we know is false.
    expect(uncomputable?.measures).toEqual([
      { key: "withheldImpressionShare", value: null },
      { key: "withheldClickShare", value: null },
    ]);

    expect(
      ids(
        buildQuickWinActions(
          input({
            anonymization: {
              queryImpressions: 500,
              propertyImpressions: 1000,
              missingImpressionShare: 0.5,
              queryClicks: 40,
              propertyClicks: 100,
              missingClickShare: 0.6,
            },
          }),
        ),
      ),
    ).toContain("size_the_withheld_share");
  });

  it("stays quiet about the withheld share when it is small and known", () => {
    expect(ids(buildQuickWinActions(input()))).not.toContain(
      "size_the_withheld_share",
    );
  });

  it("points at the page report only when the floor is what excluded them", () => {
    const mixed = buildQuickWinActions(
      input({
        excluded: {
          below_impression_floor: 5,
          position_outside_bands: 5,
          bucket_not_usable: 0,
          no_leave_one_out_baseline: 0,
        },
      }),
    );
    expect(ids(mixed)).not.toContain("check_pages_report");

    const dominated = buildQuickWinActions(
      input({
        excluded: {
          below_impression_floor: 900,
          position_outside_bands: 20,
          bucket_not_usable: 10,
          no_leave_one_out_baseline: 0,
        },
      }),
    );
    expect(ids(dominated)).toContain("check_pages_report");
  });
});

describe("firstCurveInversion", () => {
  it("finds a lower band out-earning a higher one", () => {
    // Reproduced on the evaluated site: 11-16 earned four times what 8-11 did.
    const found = firstCurveInversion(
      curveOf([
        bucket({ bucketId: "8-11", ctr: 0.0048 }),
        bucket({ bucketId: "11-16", ctr: 0.0193 }),
      ]),
    );
    expect(found?.higher.bucketId).toBe("8-11");
    expect(found?.lower.bucketId).toBe("11-16");
  });

  it("compares by band order, not by the order the buckets arrive in", () => {
    const found = firstCurveInversion(
      curveOf([
        bucket({ bucketId: "11-16", ctr: 0.0193 }),
        bucket({ bucketId: "8-11", ctr: 0.0048 }),
      ]),
    );
    expect(found?.higher.bucketId).toBe("8-11");
  });

  it("ignores bands that are not usable as baselines", () => {
    // An under-sampled band out-earning its neighbour is a sample-size
    // artefact. Reporting it as a shape in the curve would be inventing a
    // finding out of four queries.
    expect(
      firstCurveInversion(
        curveOf([
          bucket({ bucketId: "8-11", ctr: 0.0048 }),
          bucket({
            bucketId: "11-16",
            ctr: 0.9,
            quality: "insufficient_queries",
          }),
        ]),
      ),
    ).toBeNull();
  });

  it("reports the highest-ranked band that anything below it beats", () => {
    // The shape a real run produced: a gentle descent through the middle and
    // then 11-16 earning four times what 8-11 does. Several pairs invert; the
    // one worth naming is the strongest claim available — that even the
    // best-ranked band we can measure is beaten from below. Pinned because
    // which pair gets named is a choice, not an accident of iteration order.
    const found = firstCurveInversion(
      curveOf([
        bucket({ bucketId: "3-4", ctr: 0.0125 }),
        bucket({ bucketId: "4-6", ctr: 0.0079 }),
        bucket({ bucketId: "6-8", ctr: 0.0056 }),
        bucket({ bucketId: "8-11", ctr: 0.0048 }),
        bucket({ bucketId: "11-16", ctr: 0.0193 }),
      ]),
    );

    expect(found?.higher.bucketId).toBe("3-4");
    expect(found?.lower.bucketId).toBe("11-16");
  });

  it("returns null for a curve that descends the way it should", () => {
    expect(
      firstCurveInversion(
        curveOf([
          bucket({ bucketId: "1-2", ctr: 0.09 }),
          bucket({ bucketId: "4-6", ctr: 0.03 }),
          bucket({ bucketId: "8-11", ctr: 0.01 }),
        ]),
      ),
    ).toBeNull();
  });

  it("fires the action that tells the reader not to read the curve as a law", () => {
    const inverted = curveOf([
      bucket({ bucketId: "8-11", ctr: 0.0048 }),
      bucket({ bucketId: "11-16", ctr: 0.0193 }),
    ]);
    const action = buildQuickWinActions(input({ curve: inverted })).find(
      (a) => a.id === "avoid_curve_as_law",
    );

    expect(action?.bands).toEqual(["8-11", "11-16"]);
    expect(action?.measures).toEqual([
      { key: "higherBandCtr", value: 0.0048 },
      { key: "lowerBandCtr", value: 0.0193 },
    ]);
  });
});
