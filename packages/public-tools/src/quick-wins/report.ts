// @input  -- one window of Search Console query rows, brand terms, and optional property totals
// @output -- the P0-1 evidence-table envelope with its machine-readable limitations
// @pos    -- the single entry point the handler calls; pure, no I/O
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createPublicToolResult } from "../contract.ts";
import type { PropertyTotals } from "../gsc-analytics/reader.ts";
import type { GscWindow } from "../gsc-analytics/window.ts";
import { buildSiteCtrCurve } from "../site-baseline/ctr-curve.ts";
import { splitBrandQueries } from "../site-baseline/normalize.ts";
import type { GscQueryRow } from "../site-baseline/types.ts";
import { buildQuickWinActions } from "./actions.ts";
import { buildEvidenceTable } from "./evidence.ts";
import { withTracks } from "./track.ts";
import type {
  QuickWinAnonymization,
  QuickWinLimitationCode,
  QuickWinsDraftView,
  QuickWinsEnvelope,
} from "./types.ts";

/**
 * Bumped from v1: every row gained a `track` and the result gained `actions`.
 *
 * The measured numbers are unchanged — a v1 and a v2 run over the same window
 * produce identical rates and gaps. What changed is that the report now says
 * which checking path each row belongs to and what to do with the table, so a
 * consumer written against v1 would silently drop both.
 */
export const QUICK_WINS_SCHEMA_VERSION = "seo_quick_wins.evidence.v2";

/**
 * Missing share above which the anonymization gap is raised as a limitation.
 *
 * Every property has some gap; only a large one changes how the table should
 * be read. The evaluated site sat at 46% of impressions.
 */
export const ANONYMIZATION_GAP_THRESHOLD = 0.25;

/**
 * Brand queries needed before the brand segment could be reported on at all.
 *
 * Matches the bucket query gate. Below it, brand queries are still excluded
 * from the non-brand curve — that part is always right — but we say plainly
 * that there is no brand view rather than drawing one from three rows.
 */
export const MIN_BRAND_QUERIES = 5;

export interface QuickWinsInput {
  /** The Pacific-calendar days these rows were measured over. */
  readonly window: GscWindow;
  /** All query rows for the window, brand and non-brand together. */
  readonly rows: readonly GscQueryRow[];
  /** Visitor-supplied brand terms. Empty means no brand filtering. */
  readonly brandTerms: readonly string[];
  /** ISO timestamp the run completed. Supplied by the caller, never generated here. */
  readonly completedAt: string;
  /**
   * Property-level totals for the same window, used to size the withheld
   * remainder. Omitted when the caller could not read them; the result then
   * says the gap is unknown rather than implying it is zero.
   */
  readonly propertyTotals?: PropertyTotals;
  /**
   * The basis the query rows were aggregated by, echoed by Search Console.
   *
   * Compared against the property total's basis before either is divided by
   * the other. Null means the service did not say, which is treated as
   * not-comparable rather than assumed-equal.
   */
  readonly queryAggregation?: string | null;
  /** Whether the caller hit a row limit or stopped paging. */
  readonly truncated?: boolean;
  /**
   * Wording candidates produced for this run, if drafts ran at all.
   *
   * Omitted when the run had no crawl or model available. The evidence table
   * does not depend on them.
   */
  readonly drafts?: readonly QuickWinsDraftView[];
  /** Why a row produced no draft, keyed by query. */
  readonly draftsSkipped?: Readonly<Record<string, string>>;
}

/**
 * The withheld share, or null when the two reads cannot be compared.
 *
 * `comparable` is false when the property total and the query rows were
 * aggregated on different bases. Clamping an incoherent subtraction to zero —
 * which the first version did with `Math.max(0, ...)` — turns "these two
 * numbers do not describe the same thing" into "we measured a 0% withheld
 * remainder", the one answer we know to be wrong. It would also have
 * suppressed the `high_query_anonymization_gap` limitation, so the report
 * would claim near-complete coverage precisely when its inputs prove it
 * cannot know.
 */
function shareOf(
  total: number,
  observed: number,
  comparable: boolean,
): number | null {
  if (!comparable) return null;
  // Positive assertions so a NaN total or sum fails rather than passes.
  if (!(Number.isFinite(total) && total > 0)) return null;
  if (!Number.isFinite(observed)) return null;
  // The observed sum exceeding the total is not a 0% gap; it is evidence the
  // two measurements disagree.
  if (observed > total) return null;
  return (total - observed) / total;
}

export function aggregationBasesAgree(
  totals: PropertyTotals,
  queryAggregation: string | null,
): boolean {
  return (
    totals.responseAggregationType !== null &&
    queryAggregation !== null &&
    totals.responseAggregationType === queryAggregation
  );
}

function anonymizationOf(
  rows: readonly GscQueryRow[],
  totals: PropertyTotals,
  queryAggregation: string | null,
): QuickWinAnonymization {
  const queryImpressions = rows.reduce((sum, r) => sum + r.impressions, 0);
  const queryClicks = rows.reduce((sum, r) => sum + r.clicks, 0);
  const comparable = aggregationBasesAgree(totals, queryAggregation);

  return {
    queryImpressions,
    propertyImpressions: totals.impressions,
    missingImpressionShare: shareOf(
      totals.impressions,
      queryImpressions,
      comparable,
    ),
    queryClicks,
    propertyClicks: totals.clicks,
    missingClickShare: shareOf(totals.clicks, queryClicks, comparable),
  };
}

/**
 * Run the whole evidence table over one window.
 *
 * There is no verdict anywhere in the output. The engine reports what each
 * query earned, what the site's own curve earned at the same position, the
 * difference, and every reason the picture is incomplete. Deciding what a gap
 * means needs SERP context this tool does not have (v3.1 §二.3), so the tool
 * says so on every run rather than only when it happens to be inconvenient.
 */
export function buildQuickWinsReport(input: QuickWinsInput): QuickWinsEnvelope {
  const { brand, nonBrand } = splitBrandQueries(input.rows, input.brandTerms);
  const curve = buildSiteCtrCurve(nonBrand, brand.length);
  const table = buildEvidenceTable(nonBrand, curve);

  const anonymizationComparable =
    input.propertyTotals !== undefined &&
    aggregationBasesAgree(input.propertyTotals, input.queryAggregation ?? null);
  const anonymization =
    input.propertyTotals === undefined
      ? null
      : anonymizationOf(
          input.rows,
          input.propertyTotals,
          input.queryAggregation ?? null,
        );

  const limitations: QuickWinLimitationCode[] = [];

  // Always. We do not look at SERP features, and the evaluation found them to
  // be the leading cause of exactly the gaps this table lists. Stating it only
  // sometimes would make its absence read as "no SERP problem here".
  limitations.push("serp_cause_unobserved");

  const usableBands = curve.buckets.filter((b) => b.quality === "usable");
  if (usableBands.length === 0) {
    limitations.push("insufficient_bucket_sample");
  } else if (table.rows.length === 0) {
    limitations.push("insufficient_query_sample");
  }

  if (table.lowCtrBands.length > 0) {
    limitations.push("site_level_low_ctr_band");
  }

  if (
    anonymization?.missingImpressionShare !== null &&
    anonymization !== null &&
    anonymization.missingImpressionShare > ANONYMIZATION_GAP_THRESHOLD
  ) {
    limitations.push("high_query_anonymization_gap");
  }

  if (input.truncated === true) {
    limitations.push("partial_gsc_export");
  }

  if (input.brandTerms.length > 0 && brand.length < MIN_BRAND_QUERIES) {
    limitations.push("brand_segment_insufficient_evidence");
  }

  // Two distinct facts, reported as two codes. Either share being null is
  // enough: a clicks-only contradiction used to slip through because only the
  // impression share was checked, and a zero property total used to be
  // reported as a basis mismatch, which is a false explanation.
  if (anonymization !== null) {
    const uncomputable =
      anonymization.missingImpressionShare === null ||
      anonymization.missingClickShare === null;
    if (uncomputable) {
      limitations.push(
        anonymizationComparable
          ? "anonymization_gap_uncomputable"
          : "aggregation_basis_mismatch",
      );
    }
  }

  // Tracks are assigned here rather than in `buildEvidenceTable` because one
  // of them depends on whether a wording candidate exists, and candidates are
  // produced from the finished table.
  const drafts = input.drafts ?? [];
  const draftedQueries = drafts.map((draft) => draft.query);
  const rows = withTracks(table.rows, new Set(draftedQueries));

  return createPublicToolResult(
    {
      tool: "seo_quick_wins",
      schemaVersion: QUICK_WINS_SCHEMA_VERSION,
      scope: "property",
      completedAt: input.completedAt,
    },
    {
      window: input.window,
      rows,
      actions: buildQuickWinActions({
        rows,
        curve,
        lowCtrBands: table.lowCtrBands,
        excluded: table.excluded,
        anonymization,
        draftedQueries,
        anonymizationGapThreshold: ANONYMIZATION_GAP_THRESHOLD,
      }),
      curve,
      lowCtrBands: table.lowCtrBands,
      excluded: table.excluded,
      anonymization,
      limitations,
      drafts,
      draftsSkipped: input.draftsSkipped ?? {},
    },
  );
}
