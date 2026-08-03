/**
 * Where a fixed set of queries sat before, and where the same set sits now.
 *
 * The cohort is fixed on the QUERY, not on the page. That choice is the whole
 * point of this module, so it is worth writing down why the obvious version is
 * wrong:
 *
 * Search Console's page-dimension `position` is an aggregate across every
 * query that page appeared for. A page holding one high-volume query at 2 and
 * forty long-tail queries at 60 reports something near 2 while that query
 * carries the impressions — and reports something near 60 the moment that
 * query's demand goes away, having never moved in the results at all. So
 * "pages that fell out of the top 50" cannot be measured from page rows; the
 * number would cross the threshold for a reason that has nothing to do with
 * ranking. Holding the PAGE set fixed does not help, because the drift comes
 * from the query mix underneath each page, not from which pages are in view.
 *
 * Per query the aggregate is still an aggregate — a query at 3 for one week
 * and 25 for the next reports something between — but it is an aggregate over
 * one query's impressions, which is what "roughly where this query sat" means.
 * That is a defensible bucket assignment. Attributing it to a page is not:
 * `[query,page]` drops rows at Search Console's end and paging does not
 * recover them, so this module never asks which page carried a query.
 */

import type { GscQueryRow } from "../site-baseline/types.ts";
import type { QueryWindowEvidence } from "./brand-split.ts";

/**
 * Impressions a query needs in the before window to join the cohort.
 *
 * A query with three impressions has a position that is an average of three
 * numbers; moving it between buckets is describing noise. The floor also keeps
 * the cohort from being dominated by rows that were about to fall under
 * Search Console's own anonymization threshold anyway.
 */
export const MIN_COHORT_IMPRESSIONS = 30;

/** Cohort size below which the migration is not worth describing. */
export const MIN_COHORT_QUERIES = 10;

export type PositionBucket = "top_10" | "11_20" | "21_50" | "beyond_50";

export const COHORT_POSITION_BUCKETS: readonly PositionBucket[] = [
  "top_10",
  "11_20",
  "21_50",
  "beyond_50",
];

export function bucketFor(position: number): PositionBucket {
  if (!Number.isFinite(position)) return "beyond_50";
  if (position <= 10) return "top_10";
  if (position <= 20) return "11_20";
  if (position <= 50) return "21_50";
  return "beyond_50";
}

export interface BucketCount {
  readonly bucket: PositionBucket;
  readonly queries: number;
}

/**
 * What became of the cohort queries that started in the top ten.
 *
 * `noLongerVisible` is deliberately NOT called "disappeared" and must never be
 * rendered as "lost all traffic". A query drops out of the query report when
 * it falls under Search Console's anonymization threshold, which happens at a
 * volume well above zero. The honest statement is that we can no longer see
 * it, and the two possibilities — demand gone, or volume merely low — have
 * completely different implications.
 */
export interface TopTenOutcome {
  readonly startedInTopTen: number;
  readonly heldTopTen: number;
  readonly slippedWithinFifty: number;
  readonly fellBelowFifty: number;
  readonly noLongerVisible: number;
}

export type QueryCohortUnavailableReason =
  | "read_not_performed"
  | "aggregation_basis_mixed"
  | "cohort_below_floor";

export interface QueryCohortCoverage {
  readonly beforeTruncated: boolean;
  readonly afterTruncated: boolean;
  /** Share of the before window's visible clicks the cohort accounts for. */
  readonly cohortClickShare: number | null;
}

export type QueryCohortOutcome =
  | {
      readonly kind: "not_available";
      readonly reason: QueryCohortUnavailableReason;
    }
  | {
      readonly kind: "migration";
      readonly cohortSize: number;
      readonly beforeDistribution: readonly BucketCount[];
      /** Survivors only. Queries no longer visible are counted separately, never bucketed as "beyond 50". */
      readonly afterDistribution: readonly BucketCount[];
      readonly stillVisible: number;
      readonly noLongerVisible: number;
      readonly topTen: TopTenOutcome;
      readonly coverage: QueryCohortCoverage;
    };

function distributionOf(rows: readonly GscQueryRow[]): readonly BucketCount[] {
  const counts = new Map<PositionBucket, number>(
    COHORT_POSITION_BUCKETS.map((bucket) => [bucket, 0]),
  );
  for (const row of rows) {
    const bucket = bucketFor(row.position);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return COHORT_POSITION_BUCKETS.map((bucket) => ({
    bucket,
    queries: counts.get(bucket) ?? 0,
  }));
}

function comparable(evidence: QueryWindowEvidence): string | null {
  return evidence.queryAggregation;
}

/**
 * Compare the same query set across the two windows.
 *
 * Everything reported is scoped to the queries Search Console showed us in the
 * BEFORE window. That is a real limit and it is stated in the output rather
 * than smoothed over: the cohort cannot contain queries that were already
 * withheld, so this is a statement about the visible part of the property.
 */
export function describeQueryCohort(
  input: {
    readonly before: QueryWindowEvidence;
    readonly after: QueryWindowEvidence;
  } | null,
): QueryCohortOutcome {
  if (input === null) {
    return { kind: "not_available", reason: "read_not_performed" };
  }

  const beforeBasis = comparable(input.before);
  const afterBasis = comparable(input.after);
  // Two windows aggregated on different bases are two different measurements.
  // A migration computed across them would be an artefact of the basis change.
  if (
    beforeBasis === null ||
    afterBasis === null ||
    beforeBasis !== afterBasis
  ) {
    return { kind: "not_available", reason: "aggregation_basis_mixed" };
  }

  const cohort = input.before.rows.filter(
    (row) => row.impressions >= MIN_COHORT_IMPRESSIONS,
  );
  if (cohort.length < MIN_COHORT_QUERIES) {
    return { kind: "not_available", reason: "cohort_below_floor" };
  }

  const afterByQuery = new Map<string, GscQueryRow>();
  for (const row of input.after.rows) afterByQuery.set(row.query, row);

  const survivors: GscQueryRow[] = [];
  let noLongerVisible = 0;
  const topTen = {
    startedInTopTen: 0,
    heldTopTen: 0,
    slippedWithinFifty: 0,
    fellBelowFifty: 0,
    noLongerVisible: 0,
  };

  for (const row of cohort) {
    const after = afterByQuery.get(row.query);
    const startedTop = bucketFor(row.position) === "top_10";
    if (startedTop) topTen.startedInTopTen += 1;

    if (after === undefined) {
      noLongerVisible += 1;
      if (startedTop) topTen.noLongerVisible += 1;
      continue;
    }

    survivors.push(after);
    if (!startedTop) continue;

    const bucket = bucketFor(after.position);
    if (bucket === "top_10") topTen.heldTopTen += 1;
    else if (bucket === "beyond_50") topTen.fellBelowFifty += 1;
    else topTen.slippedWithinFifty += 1;
  }

  const visibleClicks = input.before.rows.reduce(
    (total, row) => total + row.clicks,
    0,
  );
  const cohortClicks = cohort.reduce((total, row) => total + row.clicks, 0);

  return {
    kind: "migration",
    cohortSize: cohort.length,
    beforeDistribution: distributionOf(cohort),
    afterDistribution: distributionOf(survivors),
    stillVisible: survivors.length,
    noLongerVisible,
    topTen,
    coverage: {
      beforeTruncated: input.before.paging.truncated,
      afterTruncated: input.after.paging.truncated,
      cohortClickShare: visibleClicks > 0 ? cohortClicks / visibleClicks : null,
    },
  };
}
