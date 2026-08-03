/**
 * How the brand and non-brand halves of the visible query set moved.
 *
 * The industry story this is usually told to support — non-brand fell while
 * brand held, therefore a site-level quality signal — is not a conclusion this
 * data can carry, and this module deliberately cannot produce it. Two reasons,
 * both structural:
 *
 * 1. A technical fault reproduces the same shape. A `noindex` on one template,
 *    a robots rule covering one directory, a rendering regression on landing
 *    pages: all of these hit non-brand queries and leave the homepage's brand
 *    queries alone. That is a different problem with a different fix, and it
 *    is the one worth ruling out FIRST because it is cheap to check and cheap
 *    to repair.
 *
 * 2. Search Console withholds low-volume queries, and what it withholds is
 *    overwhelmingly long-tail non-brand. The withheld share is not stable
 *    between two windows — when traffic collapses, the set of queries sitting
 *    under the anonymization threshold changes with it. That alone can
 *    manufacture "non-brand fell further" out of a decline that was uniform.
 *    On the property this tool was evaluated against, the query report was
 *    missing 46% of impressions and 64% of clicks.
 *
 * So the output is a described slice with its coverage attached, and the shape
 * is reported as a shape. Which explanations it is compatible with is left to
 * the copy layer, which lists several and ranks none.
 */

import { splitBrandQueries } from "../site-baseline/normalize.ts";
import type { GscQueryRow } from "../site-baseline/types.ts";
import type { GscReadPaging } from "../gsc-analytics/types.ts";
import type { PropertyTotals } from "../gsc-analytics/reader.ts";

/**
 * Share of the property's clicks the query rows must account for.
 *
 * This threshold governs whether we SPEAK, not what we conclude — it is a
 * conservatism knob, and it is chosen rather than derived. The reasoning: at
 * 60% visible, a group-versus-group ratio computed on the visible part can be
 * wrong by more than the difference it is measuring, because the invisible
 * part is not distributed evenly across the two groups. Below that we say the
 * evidence is insufficient instead of publishing a number that looks precise.
 */
export const MIN_WINDOW_CLICK_COVERAGE = 0.6;

/**
 * How much the two windows' coverage may differ.
 *
 * Equal-but-low coverage biases both sides the same way; UNEQUAL coverage
 * biases the comparison itself, which is the thing being reported. A window
 * pair at 85% and 45% is not two measurements of the same quantity.
 */
export const MAX_COVERAGE_SHIFT = 0.15;

/**
 * Brand-side floor, before the split is worth describing.
 *
 * Both a click floor and a query floor, because they fail differently: five
 * queries carrying two clicks between them is not a sample, and neither is one
 * query carrying four hundred. The evaluated property had 12 brand queries in
 * the example the requirement was written from, which is exactly the region
 * where a percentage reads as a finding and is actually noise.
 */
export const MIN_BRAND_CLICKS = 30;
export const MIN_BRAND_SPLIT_QUERIES = 5;

/** Below this, a group's movement is described as flat rather than as a change. */
export const MATERIAL_CHANGE_RATIO = 0.15;

export interface QueryWindowEvidence {
  readonly startDate: string;
  readonly endDate: string;
  readonly rows: readonly GscQueryRow[];
  readonly paging: GscReadPaging;
  readonly queryAggregation: string | null;
  /** Null when the totals read failed. The gap is then unknown, never zero. */
  readonly totals: PropertyTotals | null;
}

export interface WindowCoverage {
  readonly startDate: string;
  readonly endDate: string;
  /** Null when the two reads are not on the same aggregation basis. */
  readonly clickShare: number | null;
  readonly impressionShare: number | null;
  readonly truncated: boolean;
}

export interface BrandSplitCoverage {
  readonly before: WindowCoverage;
  readonly after: WindowCoverage;
}

export interface BrandSliceGroup {
  readonly queries: number;
  readonly clicksBefore: number;
  readonly clicksAfter: number;
  /** Null when the before window had no clicks: a ratio needs a denominator. */
  readonly clickChangeRatio: number | null;
  readonly impressionsBefore: number;
  readonly impressionsAfter: number;
  readonly impressionChangeRatio: number | null;
}

/**
 * A neutral description of how the two groups moved relative to each other.
 *
 * Named for the shape and nothing else. There is no member called
 * `site_level_signal` and there is not going to be one.
 */
export type BrandSplitShape =
  | "both_declined"
  | "non_brand_declined_more"
  | "brand_declined_more"
  | "no_material_change";

export type BrandSplitUnavailableReason =
  | "read_not_performed"
  | "brand_terms_not_confirmed"
  | "property_totals_unavailable"
  | "aggregation_basis_mixed"
  | "coverage_below_floor"
  | "coverage_shift_too_large"
  | "brand_sample_below_floor";

export type BrandSplitOutcome =
  | {
      readonly kind: "not_available";
      readonly reason: BrandSplitUnavailableReason;
      /** Null only when no read happened at all. */
      readonly coverage: BrandSplitCoverage | null;
    }
  | {
      readonly kind: "slice";
      readonly brand: BrandSliceGroup;
      readonly nonBrand: BrandSliceGroup;
      readonly shape: BrandSplitShape;
      readonly coverage: BrandSplitCoverage;
    };

export interface BrandSplitInput {
  readonly before: QueryWindowEvidence;
  readonly after: QueryWindowEvidence;
  /** Terms the visitor confirmed. Domain guesses alone never reach here. */
  readonly brandTerms: readonly string[];
  /**
   * Whether the visitor actually confirmed the list.
   *
   * A guess derived from the domain is a candidate, not evidence. On the
   * property this was evaluated against, the domain-derived token matches
   * neither the spaced form of the brand nor anything else useful, and the
   * shortened form would swallow every generic query in the niche.
   */
  readonly brandTermsConfirmed: boolean;
}

function sum(rows: readonly GscQueryRow[], field: "clicks" | "impressions") {
  return rows.reduce((total, row) => total + row[field], 0);
}

function shareOf(observed: number, total: number): number | null {
  if (!(Number.isFinite(total) && total > 0)) return null;
  if (!Number.isFinite(observed)) return null;
  // Observed above total is not 100% coverage; it is proof the two numbers do
  // not describe the same thing.
  if (observed > total) return null;
  return observed / total;
}

function coverageOf(evidence: QueryWindowEvidence): WindowCoverage {
  const comparable =
    evidence.totals !== null &&
    evidence.totals.responseAggregationType !== null &&
    evidence.queryAggregation !== null &&
    evidence.totals.responseAggregationType === evidence.queryAggregation;

  const totals = evidence.totals;

  return {
    startDate: evidence.startDate,
    endDate: evidence.endDate,
    clickShare:
      comparable && totals !== null
        ? shareOf(sum(evidence.rows, "clicks"), totals.clicks)
        : null,
    impressionShare:
      comparable && totals !== null
        ? shareOf(sum(evidence.rows, "impressions"), totals.impressions)
        : null,
    truncated: evidence.paging.truncated,
  };
}

function changeRatio(before: number, after: number): number | null {
  if (!(Number.isFinite(before) && before > 0)) return null;
  return (after - before) / before;
}

function groupOf(
  before: readonly GscQueryRow[],
  after: readonly GscQueryRow[],
): BrandSliceGroup {
  const queries = new Set<string>();
  for (const row of before) queries.add(row.query);
  for (const row of after) queries.add(row.query);

  const clicksBefore = sum(before, "clicks");
  const clicksAfter = sum(after, "clicks");
  const impressionsBefore = sum(before, "impressions");
  const impressionsAfter = sum(after, "impressions");

  return {
    queries: queries.size,
    clicksBefore,
    clicksAfter,
    clickChangeRatio: changeRatio(clicksBefore, clicksAfter),
    impressionsBefore,
    impressionsAfter,
    impressionChangeRatio: changeRatio(impressionsBefore, impressionsAfter),
  };
}

function shapeOf(
  brand: BrandSliceGroup,
  nonBrand: BrandSliceGroup,
): BrandSplitShape {
  const brandMoved = brand.clickChangeRatio;
  const nonBrandMoved = nonBrand.clickChangeRatio;
  // Without both ratios there is no relative statement to make.
  if (brandMoved === null || nonBrandMoved === null)
    return "no_material_change";

  const brandFell = brandMoved <= -MATERIAL_CHANGE_RATIO;
  const nonBrandFell = nonBrandMoved <= -MATERIAL_CHANGE_RATIO;

  if (!brandFell && !nonBrandFell) return "no_material_change";
  if (brandFell && nonBrandFell) {
    // Both fell. Only call it lopsided when the gap itself is material.
    if (nonBrandMoved <= brandMoved - MATERIAL_CHANGE_RATIO) {
      return "non_brand_declined_more";
    }
    if (brandMoved <= nonBrandMoved - MATERIAL_CHANGE_RATIO) {
      return "brand_declined_more";
    }
    return "both_declined";
  }
  return nonBrandFell ? "non_brand_declined_more" : "brand_declined_more";
}

/**
 * Describe the brand / non-brand split, or say why it cannot be described.
 *
 * Gates run in a fixed order and the FIRST failure is reported, so the reason
 * the visitor sees is the one closest to the root: an unconfirmed brand list
 * is reported as such rather than as a coverage problem it also happens to
 * have.
 */
export function describeBrandSplit(
  input: BrandSplitInput | null,
): BrandSplitOutcome {
  if (input === null) {
    return {
      kind: "not_available",
      reason: "read_not_performed",
      coverage: null,
    };
  }

  const coverage: BrandSplitCoverage = {
    before: coverageOf(input.before),
    after: coverageOf(input.after),
  };

  if (!input.brandTermsConfirmed || input.brandTerms.length === 0) {
    return {
      kind: "not_available",
      reason: "brand_terms_not_confirmed",
      coverage,
    };
  }

  if (input.before.totals === null || input.after.totals === null) {
    return {
      kind: "not_available",
      reason: "property_totals_unavailable",
      coverage,
    };
  }

  const beforeShare = coverage.before.clickShare;
  const afterShare = coverage.after.clickShare;
  if (beforeShare === null || afterShare === null) {
    return {
      kind: "not_available",
      reason: "aggregation_basis_mixed",
      coverage,
    };
  }

  if (
    beforeShare < MIN_WINDOW_CLICK_COVERAGE ||
    afterShare < MIN_WINDOW_CLICK_COVERAGE
  ) {
    return { kind: "not_available", reason: "coverage_below_floor", coverage };
  }

  if (Math.abs(beforeShare - afterShare) > MAX_COVERAGE_SHIFT) {
    return {
      kind: "not_available",
      reason: "coverage_shift_too_large",
      coverage,
    };
  }

  const beforeSplit = splitBrandQueries(input.before.rows, input.brandTerms);
  const afterSplit = splitBrandQueries(input.after.rows, input.brandTerms);

  const brand = groupOf(beforeSplit.brand, afterSplit.brand);
  const nonBrand = groupOf(beforeSplit.nonBrand, afterSplit.nonBrand);

  if (
    brand.clicksBefore < MIN_BRAND_CLICKS ||
    beforeSplit.brand.length < MIN_BRAND_SPLIT_QUERIES
  ) {
    return {
      kind: "not_available",
      reason: "brand_sample_below_floor",
      coverage,
    };
  }

  return {
    kind: "slice",
    brand,
    nonBrand,
    shape: shapeOf(brand, nonBrand),
    coverage,
  };
}
