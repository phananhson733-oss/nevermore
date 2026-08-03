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
  if (
    input.coverage === null ||
    !Number.isFinite(input.coverage) ||
    input.coverage < MIN_DIMENSION_COVERAGE
  ) {
    return { kind: "low_dimension_coverage" };
  }

  // The page carrying most of the query's impressions is the one a rewrite
  // would land on.
  let subjectUrl: string | null = null;
  let subjectImpressions = -1;
  for (const row of input.queryPages) {
    if (row.query !== input.query) continue;
    if (!Number.isFinite(row.impressions)) continue;
    if (row.impressions > subjectImpressions) {
      subjectImpressions = row.impressions;
      subjectUrl = row.page;
    }
  }
  if (subjectUrl === null) return { kind: "no_subject_page" };

  const byUrl = new Map(input.pages.map((p) => [p.page, p]));
  const subject = byUrl.get(subjectUrl);
  if (subject === undefined) return { kind: "no_subject_page" };

  const subjectCtr = ctrOf(subject);
  const subjectBucket = bucketForPosition(subject.position);
  if (subjectCtr === null || subjectBucket === null) {
    return { kind: "no_comparable_high_ctr_page" };
  }

  let best: { page: GscPageRow; ctr: number } | null = null;
  for (const candidate of input.pages) {
    if (candidate.page === subjectUrl) continue;
    if (candidate.impressions < MIN_COMPARABLE_PAGE_IMPRESSIONS) continue;
    if (bucketForPosition(candidate.position)?.id !== subjectBucket.id) continue;

    const ctr = ctrOf(candidate);
    if (ctr === null) continue;
    // A subject earning nothing has no meaningful multiple; require the
    // candidate to clear the floor on its own instead of dividing by zero.
    const clearsAdvantage =
      subjectCtr > 0 ? ctr >= subjectCtr * MIN_CTR_ADVANTAGE : ctr > 0;
    if (!clearsAdvantage) continue;

    if (best === null || ctr > best.ctr) best = { page: candidate, ctr };
  }

  if (best === null) return { kind: "no_comparable_high_ctr_page" };

  return {
    kind: "found",
    subjectPage: subjectUrl,
    subjectCtr,
    comparablePage: best.page.page,
    comparableCtr: best.ctr,
    bucketId: subjectBucket.id,
  };
}
