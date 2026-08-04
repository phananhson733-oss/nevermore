// @input  -- Search Console query rows plus the site's own CTR curve
// @output -- the evidence-table shapes and the machine-readable limitation codes
// @pos    -- type boundary for P0-1; the engine emits codes, never display prose
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { PublicToolResultEnvelope } from "../contract.ts";
import type {
  CtrBucket,
  PositionBucketId,
  SiteCtrCurve,
} from "../site-baseline/types.ts";

/**
 * One row of the evidence table.
 *
 * Every field is either measured or derived from measurement. There is no
 * verdict field, and that is deliberate: v1 reports what the numbers are and
 * what they are being compared against, and stops there. The 2026-07-31
 * evaluation found that on a real site every query the old hit-detector
 * flagged was one where Search itself answered the question — the observation
 * was true and the conclusion drawn from it was wrong every single time.
 */
export interface QuickWinEvidenceRow {
  readonly query: string;
  /** Impression-weighted average position for the window, not a rank. */
  readonly position: number;
  readonly bucketId: PositionBucketId;
  readonly impressions: number;
  readonly clicks: number;
  /** Null when impressions is 0. Unavailable is never reported as 0. */
  readonly observedCtr: number | null;
  /** The band's rate with this query's own clicks and impressions removed. */
  readonly baselineCtr: number;
  /** impressions × baselineCtr. What the site's own curve would predict. */
  readonly expectedClicks: number;
  /**
   * expectedClicks − clicks. Positive means below the site's own curve.
   *
   * This is a measured difference between two observed quantities, NOT a
   * forecast of clicks recoverable by any action. Copy rendering this field
   * must not imply the gap is retrievable.
   */
  readonly clickGap: number;
  /** Continuous disclosure only. See `binomialLowerTail` for what it is not. */
  readonly tailProbability: number | null;
  /**
   * Whether the band this row is measured against sits under 1% overall.
   *
   * When a whole band earns under 1%, the band itself is the anomaly and
   * per-query comparison inside it says very little. The engine still reports
   * the row; the flag exists so the surface can say so instead of presenting
   * a dozen rows that are all "below baseline" for the same structural reason.
   */
  readonly baselineBandUnderOnePercent: boolean;
  /**
   * Which checking path this row belongs to.
   *
   * Assigned in `report.ts` rather than here, because one of the paths depends
   * on whether a wording candidate was found, and candidates are produced from
   * the finished table. `buildEvidenceTable` emits `read_the_serp` as the
   * provisional value and the report narrows it.
   */
  readonly track: QuickWinTrack;
}

/**
 * What to do with one row, as a code the surface renders.
 *
 * This is a triage, not a verdict. The engine still refuses to say whether a
 * row is a problem — the 2026-07-31 evaluation settled that question, and it
 * settled it against us. What it can say is which *checking path* a row
 * belongs to, because that follows from the numbers alone:
 *
 * - a row with a comparable page on the same site has a control to compare against;
 * - a row in a band earning under 1% overall shares its shortfall with the
 *   whole band, so reading it alone re-describes the band;
 * - a row with a material shortfall and no control needs SERP context, which
 *   is exactly the thing this tool cannot see and the visitor can;
 * - a row whose shortfall is under a single click is inside the noise its own
 *   sample size creates;
 * - a row at or above the site's own rate has nothing to check.
 *
 * Every one of those is a statement about the evidence, and none of them says
 * a rewrite would recover anything.
 */
export type QuickWinTrack =
  | "compare_with_own_page"
  | "band_is_the_story"
  | "read_the_serp"
  | "gap_within_noise"
  | "at_or_above_curve";

/** Why a query never reached the evidence table. */
export type QuickWinExclusionReason =
  | "below_impression_floor"
  | "position_outside_bands"
  | "bucket_not_usable"
  | "no_leave_one_out_baseline";

export type QuickWinExclusionCounts = Readonly<
  Record<QuickWinExclusionReason, number>
>;

/**
 * Machine-readable limitation codes. The UI renders them through i18n
 * (`limitations.<code>`); the engine never emits display prose.
 */
export type QuickWinLimitationCode =
  /** No band cleared the sample gates. Nothing could be compared at all. */
  | "insufficient_bucket_sample"
  /** Bands exist but no query cleared the impression floor. */
  | "insufficient_query_sample"
  /**
   * Search Console withholds low-volume queries. On the evaluated site 46% of
   * impressions and 64% of clicks never appeared in the query report, so the
   * table is computed on a partial universe by construction.
   */
  | "high_query_anonymization_gap"
  /** The row set was truncated by paging or row limits. */
  | "partial_gsc_export"
  /**
   * One or more bands earn under 1% overall. Per-query comparison inside such
   * a band mostly re-describes the band.
   */
  | "site_level_low_ctr_band"
  /**
   * We do not detect AI Overviews, featured snippets or any other SERP
   * feature, and those are a leading cause of the gaps in this table.
   */
  | "serp_cause_unobserved"
  /**
   * Brand queries were excluded from the curve but the brand group is too
   * small to report on separately.
   */
  | "brand_segment_insufficient_evidence"
  /**
   * The property total and the query-row sum were not measured on the same
   * basis, so the withheld remainder cannot be computed from them. Search
   * Console picks its own aggregation once a query groups or filters by page,
   * and dividing one basis by another produces a number that describes
   * neither.
   */
  | "aggregation_basis_mismatch"
  /**
   * The withheld remainder could not be computed for a reason other than a
   * basis mismatch — a zero property total, or a query-row sum larger than
   * the property total. Reported separately because
   * `aggregation_basis_mismatch` states a specific fact, and stating it when
   * the bases actually agreed would be a false explanation.
   */
  | "anonymization_gap_uncomputable";

/**
 * How much of the property never appeared in the query report.
 *
 * Search Console withholds queries below an undisclosed volume threshold for
 * privacy. The difference between the property totals and the sum of the
 * returned query rows is that withheld remainder. On the site evaluated on
 * 2026-07-31 it was 46% of impressions and 64% of clicks — the evidence table
 * is computed on a partial universe by construction, and the size of the
 * missing part is itself worth reporting.
 */
export interface QuickWinAnonymization {
  readonly queryImpressions: number;
  readonly propertyImpressions: number;
  /** Null when property impressions are 0 — a share of nothing is not 0. */
  readonly missingImpressionShare: number | null;
  readonly queryClicks: number;
  readonly propertyClicks: number;
  readonly missingClickShare: number | null;
}

/**
 * A wording candidate for one query, with the page it was modelled on.
 *
 * Optional by construction: drafts need a crawl and a model, and a run
 * without either still produces the evidence table. An absent draft is never
 * an error — `draftsUnavailable` says which reason applies.
 */
export interface QuickWinsDraftView {
  readonly query: string;
  readonly subjectPage: string;
  readonly title: string;
  readonly metaDescription: string;
  readonly comparablePage: string;
}

/**
 * What the reader should do next.
 *
 * `avoid` is a first-class kind, carried over from the traffic-drop tool for
 * the same reason: naming the wrong move is as useful as naming the right one,
 * and on this table the most expensive wrong move — reading the gap column as
 * clicks a rewrite would recover — is one the numbers actively invite.
 *
 * `external_data` covers everything that needs a look the tool cannot take.
 * That is not a hedge: SERP features are the leading cause of the gaps in this
 * table, we do not observe them, and the visitor can observe them in a browser
 * tab in about a minute.
 */
export type QuickWinActionKind = "do" | "external_data" | "avoid";

export type QuickWinActionId =
  /** Wording candidates exist; compare them against the page they were modelled on. */
  | "apply_wording_candidates"
  /** Rows with a material shortfall and no same-site control. Open their SERPs. */
  | "open_serps_for_top_gaps"
  /** A whole band earns under 1%. One finding, not a dozen. */
  | "read_low_band_as_one_finding"
  /** The gap column is a measured difference, not a forecast. Always fires. */
  | "avoid_gap_as_forecast"
  /** A large share of the property never reached the query report. */
  | "size_the_withheld_share"
  /** Most queries never cleared the impression floor; the page report sees them. */
  | "check_pages_report"
  /** A lower band out-earns a higher one, so the curve is not a rank→CTR law here. */
  | "avoid_curve_as_law";

/** One measured quantity backing an action. Rendered as-is; never re-derived in the UI. */
export interface QuickWinMeasure {
  /** i18n key (`measures.<key>`), not display text. */
  readonly key: string;
  /** Null carries "not available", which the UI must not render as 0. */
  readonly value: number | null;
}

export interface QuickWinAction {
  readonly id: QuickWinActionId;
  readonly kind: QuickWinActionKind;
  /**
   * The evidence rows this action points at, in table order.
   *
   * Empty when the action is about the table as a whole. A non-empty list is
   * the difference between advice and a worklist: "open the SERPs" is a
   * sentiment until it names the five queries.
   */
  readonly queries: readonly string[];
  /** Position bands this action points at. Empty unless the action is about bands. */
  readonly bands: readonly PositionBucketId[];
  readonly measures: readonly QuickWinMeasure[];
}

export interface QuickWinsResult {
  /**
   * The days this report was measured over, in Pacific calendar days.
   *
   * Carried in the result rather than left implicit: a 28-day table ending
   * three days in the past reads as current unless the page says otherwise,
   * and the reader has no other way to learn which days these numbers cover.
   */
  readonly window: { readonly startDate: string; readonly endDate: string };
  readonly rows: readonly QuickWinEvidenceRow[];
  /**
   * What to do next, derived from the table and nothing else.
   *
   * Ordered do → external_data → avoid, which is the order someone reading a
   * report acts in. Every entry is gated on evidence that is present in this
   * same result, so an action can never appear without the numbers that put it
   * there being visible on the same page.
   */
  readonly actions: readonly QuickWinAction[];
  readonly curve: SiteCtrCurve;
  /** Bands under 1%, reported at site level rather than per query. */
  readonly lowCtrBands: readonly CtrBucket[];
  readonly excluded: QuickWinExclusionCounts;
  /** Null when the caller could not supply property totals to compare against. */
  readonly anonymization: QuickWinAnonymization | null;
  readonly limitations: readonly QuickWinLimitationCode[];
  /**
   * Wording candidates, at most one per evidence row.
   *
   * Empty is the normal case: drafts require a comparable page on the same
   * site earning clearly more at the same position, and most queries do not
   * have one.
   */
  readonly drafts: readonly QuickWinsDraftView[];
  /**
   * Why a row has no draft, keyed by query.
   *
   * Present so the surface can distinguish "we looked and there was no
   * comparable page" from "we never looked".
   */
  readonly draftsSkipped: Readonly<Record<string, string>>;
}

export type QuickWinsEnvelope = PublicToolResultEnvelope<
  QuickWinsResult,
  "seo_quick_wins",
  "property"
>;
