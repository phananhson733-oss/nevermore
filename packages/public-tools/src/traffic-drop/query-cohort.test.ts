import { describe, expect, it } from "vitest";

import { describeQueryCohort, MIN_COHORT_IMPRESSIONS } from "./query-cohort.ts";
import type { QueryWindowEvidence } from "./brand-split.ts";
import type { GscQueryRow } from "../site-baseline/types.ts";

function row(
  query: string,
  position: number,
  impressions = 500,
  clicks = 10,
): GscQueryRow {
  return { query, clicks, impressions, position };
}

function evidence(
  rows: readonly GscQueryRow[],
  aggregation: string | null = "byProperty",
): QueryWindowEvidence {
  return {
    startDate: "2026-01-01",
    endDate: "2026-01-07",
    rows,
    paging: { pagesFetched: 1, truncated: false },
    queryAggregation: aggregation,
    totals: {
      clicks: rows.reduce((sum, r) => sum + r.clicks, 0),
      impressions: rows.reduce((sum, r) => sum + r.impressions, 0),
      responseAggregationType: aggregation,
    },
  };
}

/** Twelve queries, ten of them starting inside the top ten. */
const BEFORE = [
  ...Array.from({ length: 10 }, (_unused, index) => row(`q${index}`, 3)),
  row("deep-a", 30),
  row("deep-b", 44),
];

describe("describeQueryCohort", () => {
  it("says the read did not happen rather than reporting an empty migration", () => {
    expect(describeQueryCohort(null)).toEqual({
      kind: "not_available",
      reason: "read_not_performed",
    });
  });

  it("refuses across two different aggregation bases", () => {
    expect(
      describeQueryCohort({
        before: evidence(BEFORE),
        after: evidence(BEFORE, "byPage"),
      }),
    ).toEqual({ kind: "not_available", reason: "aggregation_basis_mixed" });
  });

  it("keeps a query that fell out of the report separate from one that fell in rank", () => {
    // This is the distinction the whole module exists to preserve. A query
    // drops out of the query report when it falls under Search Console's
    // anonymization threshold, which happens well above zero traffic — so
    // "gone from the report" and "lost its ranking" are different claims with
    // different fixes, and bucketing the first as "beyond 50" merges them.
    const after = [
      ...Array.from({ length: 4 }, (_unused, index) => row(`q${index}`, 3)),
      row("q4", 15),
      row("q5", 60),
      // q6..q9 absent: no longer visible.
      row("deep-a", 30),
      row("deep-b", 44),
    ];

    const result = describeQueryCohort({
      before: evidence(BEFORE),
      after: evidence(after),
    });

    expect(result.kind).toBe("migration");
    if (result.kind !== "migration") return;
    expect(result.topTen).toEqual({
      startedInTopTen: 10,
      heldTopTen: 4,
      slippedWithinFifty: 1,
      fellBelowFifty: 1,
      noLongerVisible: 4,
    });
    expect(result.noLongerVisible).toBe(4);
    // The four invisible queries are not in the after distribution at all.
    const bucketed = result.afterDistribution.reduce(
      (sum, entry) => sum + entry.queries,
      0,
    );
    expect(bucketed).toBe(result.stillVisible);
    expect(bucketed).toBe(8);
  });

  it("fixes the cohort on the before window and ignores newcomers", () => {
    // A query that only appears afterwards says nothing about what the
    // existing set did, and counting it would let a report about a decline be
    // diluted by unrelated new traffic.
    const result = describeQueryCohort({
      before: evidence(BEFORE),
      after: evidence([...BEFORE, row("brand-new", 2)]),
    });

    expect(result.kind).toBe("migration");
    if (result.kind !== "migration") return;
    expect(result.cohortSize).toBe(12);
    expect(result.stillVisible).toBe(12);
  });

  it("drops queries too small for their position to mean anything", () => {
    const noisy = [
      ...BEFORE,
      row("one-impression", 1, MIN_COHORT_IMPRESSIONS - 1),
    ];
    const result = describeQueryCohort({
      before: evidence(noisy),
      after: evidence(noisy),
    });

    expect(result.kind).toBe("migration");
    if (result.kind !== "migration") return;
    expect(result.cohortSize).toBe(12);
  });

  it("will not describe a migration from a handful of queries", () => {
    const tiny = [row("a", 3), row("b", 4)];
    expect(
      describeQueryCohort({ before: evidence(tiny), after: evidence(tiny) }),
    ).toEqual({ kind: "not_available", reason: "cohort_below_floor" });
  });

  it("reports a cohort that held its ground as holding its ground", () => {
    const result = describeQueryCohort({
      before: evidence(BEFORE),
      after: evidence(BEFORE),
    });

    expect(result.kind).toBe("migration");
    if (result.kind !== "migration") return;
    expect(result.topTen.heldTopTen).toBe(10);
    expect(result.topTen.fellBelowFifty).toBe(0);
    expect(result.noLongerVisible).toBe(0);
  });

  it("refuses outright on a truncated read, in either window", () => {
    // Fatal here in a way it is not elsewhere. A cohort query missing from a
    // truncated LATER window is indistinguishable from one that genuinely left
    // the report, so `noLongerVisible` — the number this module exists to state
    // carefully — would be counting our own paging cap. Reporting the
    // truncation beside the migration was not enough: the migration still
    // shipped, and a reader takes the number.
    const truncated: QueryWindowEvidence = {
      ...evidence(BEFORE),
      paging: { pagesFetched: 2, truncated: true },
    };

    expect(
      describeQueryCohort({ before: truncated, after: evidence(BEFORE) }),
    ).toEqual({ kind: "not_available", reason: "read_truncated" });
    expect(
      describeQueryCohort({ before: evidence(BEFORE), after: truncated }),
    ).toEqual({ kind: "not_available", reason: "read_truncated" });
  });

  it("will not describe a migration out of a top ten nobody was in", () => {
    // `clear` renders as "the queries that started in the top ten are still
    // there" — a sentence about an empty set that reads as good news.
    const deep = Array.from({ length: 12 }, (_unused, index) =>
      row(`deep-${index}`, 30),
    );

    expect(
      describeQueryCohort({ before: evidence(deep), after: evidence(deep) }),
    ).toEqual({ kind: "not_available", reason: "no_top_ten_queries" });
  });

  it("does not treat a coerced zero position as the best rank on the site", () => {
    // The transport client turns a missing or non-numeric metric into 0, so a
    // malformed row arrives indistinguishable from a real one — and `0 <= 10`
    // put it straight into the top bucket. A row reporting rank zero is a
    // parsing artefact; Search Console positions start at 1.
    const withGarbage = [...BEFORE, row("malformed", 0)];
    const result = describeQueryCohort({
      before: evidence(withGarbage),
      after: evidence(withGarbage),
    });

    expect(result.kind).toBe("migration");
    if (result.kind !== "migration") return;
    expect(result.cohortSize).toBe(12);
    expect(result.topTen.startedInTopTen).toBe(10);
  });
});
