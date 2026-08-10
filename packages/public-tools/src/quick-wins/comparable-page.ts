// @input  -- one query, the property's page rows, and the query's page split
// @output -- a NAMED same-band page that earns clearly more, or the reason there is none
// @pos    -- the evidence a Title/Meta draft is allowed to be modelled on (v3.1 §2.5)
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  MIN_DIMENSION_COVERAGE,
  type GscPageRow,
  type GscQueryPageRow,
} from "../gsc-analytics/page-reader.ts";
import { bucketForPosition } from "../site-baseline/ctr-curve.ts";

/**
 * Impressions a candidate needs before its rate is treated as a rate.
 *
 * A page with 99 impressions and 50 clicks reads as 50%, and one click either
 * way moves it five points. Modelling a draft on that is modelling it on
 * noise.
 */
export const MIN_COMPARABLE_PAGE_IMPRESSIONS = 500;

/**
 * How much better a candidate must be before it is worth pointing at.
 *
 * Anything smaller is inside the range two similar pages differ by for
 * reasons that have nothing to do with wording.
 */
export const MIN_CTR_ADVANTAGE = 2;

export interface ComparablePageInput {
  readonly query: string;
  /** Every page on the property with its own totals for the window. */
  readonly pages: readonly GscPageRow[];
  /** The query's page split — which pages Search Console attributed it to. */
  readonly queryPages: readonly GscQueryPageRow[];
  /** How much of the query the split accounts for. Null means unknown. */
  readonly coverage: number | null;
}

export type ComparablePageResult =
  | {
      readonly kind: "found";
      readonly subjectPage: string;
      readonly subjectCtr: number;
      readonly comparablePage: string;
      readonly comparableCtr: number;
      /** Both pages sit in this band; the comparison is only valid inside one. */
      readonly bucketId: string;
    }
  /**
   * The page split does not cover enough of the query to say which page
   * carries it. Naming one anyway would be a guess presented as evidence.
   */
  | { readonly kind: "low_dimension_coverage" }
  /** The split covers the query but attributes it to no page we can see. */
  | { readonly kind: "no_subject_page" }
  /**
   * No page in the same band earns clearly more with a sample worth trusting.
   *
   * This is a terminal answer, not a prompt to lower the bar: a draft with no
   * named source is a generic template, and generic templates are why drafts
   * were cut from v1 in the first place.
   */
  | { readonly kind: "no_comparable_high_ctr_page" };

function ctrOf(row: GscPageRow): number | null {
  if (!(Number.isFinite(row.impressions) && row.impressions > 0)) return null;
  if (!(Number.isFinite(row.clicks) && row.clicks >= 0)) return null;
  return row.clicks / row.impressions;
}

/** A page that already cleared the impression floor, with its rate. */
interface RankedPage {
  readonly page: string;
  readonly ctr: number;
}

/**
 * The page rows arranged so one query's answer costs a lookup, not a scan.
 *
 * Built once per run and reused for every row. Deriving it per row is the
 * same answer at N times the cost: the planner asks this question for every
 * evidence row with a shortfall, and a property is allowed to bring 100,000
 * rows, so a per-row rebuild turns planning quadratic and can spend the
 * request's whole budget before anything is fetched.
 */
export interface ComparablePageIndex {
  /** The page carrying most of each query's impressions. */
  readonly subjectByQuery: ReadonlyMap<string, string>;
  readonly pagesByUrl: ReadonlyMap<string, GscPageRow>;
  /**
   * Eligible pages per band, highest rate first.
   *
   * Sorted rather than searched because the winner is always the highest rate
   * that is not the subject: the advantage test is a threshold, so if the best
   * candidate fails it, every lower one fails it too.
   */
  readonly rankedByBucket: ReadonlyMap<string, readonly RankedPage[]>;
}

export function buildComparablePageIndex(
  pages: readonly GscPageRow[],
  queryPages: readonly GscQueryPageRow[],
): ComparablePageIndex {
  const subjectByQuery = new Map<string, string>();
  const bestImpressions = new Map<string, number>();
  for (const row of queryPages) {
    if (!Number.isFinite(row.impressions)) continue;
    // Strictly greater, so ties keep the first row seen — the same page the
    // single-pass version picked.
    if (row.impressions > (bestImpressions.get(row.query) ?? -1)) {
      bestImpressions.set(row.query, row.impressions);
      subjectByQuery.set(row.query, row.page);
    }
  }

  const pagesByUrl = new Map<string, GscPageRow>();
  const byBucket = new Map<string, RankedPage[]>();
  for (const row of pages) {
    pagesByUrl.set(row.page, row);

    if (row.impressions < MIN_COMPARABLE_PAGE_IMPRESSIONS) continue;
    const ctr = ctrOf(row);
    if (ctr === null) continue;
    const bucket = bucketForPosition(row.position);
    if (bucket === null) continue;

    const group = byBucket.get(bucket.id);
    if (group === undefined) byBucket.set(bucket.id, [{ page: row.page, ctr }]);
    else group.push({ page: row.page, ctr });
  }
  // Array.prototype.sort is stable, so equal rates stay in the order the rows
  // arrived — again matching the single-pass version's tie-break.
  for (const group of byBucket.values()) group.sort((a, b) => b.ctr - a.ctr);

  return { subjectByQuery, pagesByUrl, rankedByBucket: byBucket };
}

/**
 * Find the page a draft for this query may be modelled on.
 *
 * Three gates, all of them terminal rather than best-effort:
 *
 * 1. The query's page split must cover the query. Search Console drops rows
 *    when a query groups by page, so without coverage we do not know which
 *    page carries it.
 * 2. Subject and candidate must sit in the SAME position band. A page at
 *    position 2 earns more than one at 9 for reasons no rewrite transfers.
 * 3. The candidate must clear both an impression floor and an advantage
 *    threshold, so the thing being copied is a pattern rather than a lucky
 *    week.
 */
export function selectComparablePage(
  input: ComparablePageInput,
): ComparablePageResult {
  return selectComparablePageFrom(
    buildComparablePageIndex(input.pages, input.queryPages),
    input,
  );
}

/**
 * The same three gates, answered against an index built once for the run.
 *
 * Callers asking for one query keep `selectComparablePage`. Callers asking for
 * many — the planner asks for every row with a shortfall — build the index
 * once and come here, so the page rows are walked a fixed number of times
 * rather than once per row.
 */
export function selectComparablePageFrom(
  index: ComparablePageIndex,
  input: { readonly query: string; readonly coverage: number | null },
): ComparablePageResult {
  if (
    input.coverage === null ||
    !Number.isFinite(input.coverage) ||
    input.coverage < MIN_DIMENSION_COVERAGE
  ) {
    return { kind: "low_dimension_coverage" };
  }

  // The page carrying most of the query's impressions is the one a rewrite
  // would land on.
  const subjectUrl = index.subjectByQuery.get(input.query);
  if (subjectUrl === undefined) return { kind: "no_subject_page" };

  const subject = index.pagesByUrl.get(subjectUrl);
  if (subject === undefined) return { kind: "no_subject_page" };

  const subjectCtr = ctrOf(subject);
  const subjectBucket = bucketForPosition(subject.position);
  if (subjectCtr === null || subjectBucket === null) {
    return { kind: "no_comparable_high_ctr_page" };
  }

  // Highest rate in the band that is not the subject itself. Nothing below it
  // can clear a threshold it fails.
  const best = index.rankedByBucket
    .get(subjectBucket.id)
    ?.find((candidate) => candidate.page !== subjectUrl);
  if (best === undefined) return { kind: "no_comparable_high_ctr_page" };

  // A subject earning nothing has no meaningful multiple; require the
  // candidate to clear the floor on its own instead of dividing by zero.
  const clearsAdvantage =
    subjectCtr > 0 ? best.ctr >= subjectCtr * MIN_CTR_ADVANTAGE : best.ctr > 0;
  if (!clearsAdvantage) return { kind: "no_comparable_high_ctr_page" };

  return {
    kind: "found",
    subjectPage: subjectUrl,
    subjectCtr,
    comparablePage: best.page,
    comparableCtr: best.ctr,
    bucketId: subjectBucket.id,
  };
}
