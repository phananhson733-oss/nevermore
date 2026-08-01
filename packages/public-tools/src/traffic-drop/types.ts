import type { PublicToolResultEnvelope } from "../contract.ts";

/**
 * One day of Search Console totals for the whole property.
 *
 * `clicks` and `impressions` are raw counts as reported by GSC. A day that GSC
 * did not report at all must be absent from the series, never present as a
 * zero row: unavailable is not zero.
 */
export interface TrafficDailyPoint {
  readonly date: string;
  readonly clicks: number;
  readonly impressions: number;
}

/**
 * A 7-day comparison window chosen by the detector.
 *
 * Windows are always produced by the engine and never accepted from the
 * caller: a user-selected window means a user-selected conclusion, which is
 * not a diagnosis (Owner 2026-07-31).
 */
export type TrafficWindowId = "peak" | "mid" | "recent";

export interface TrafficWindow {
  readonly id: TrafficWindowId;
  readonly startDate: string;
  readonly endDate: string;
  readonly clicks: number;
  readonly impressions: number;
  /** Null when impressions === 0. An unavailable ratio is never reported as 0. */
  readonly ctr: number | null;
}

/**
 * Outcome of the frozen change-point detector.
 *
 * - `sustained_decline` — a peak week followed by at least two non-overlapping
 *   windows below the sustain threshold.
 * - `transient_visibility_anomaly` — a drop that did not persist across two
 *   windows. Reported separately so a two-day dip is never sold as a decline.
 * - `insufficient_history` — fewer than the minimum days of history.
 * - `no_material_decline` — history is sufficient and no qualifying peak/trough
 *   pair exists.
 */
export type TrafficChangeState =
  | "sustained_decline"
  | "transient_visibility_anomaly"
  | "insufficient_history"
  | "no_material_decline";

/**
 * Machine-readable limitation codes. The UI renders them through i18n
 * (`limitations.<code>`); the engine never emits display prose.
 */
export type TrafficLimitationCode =
  | "history_below_twelve_weeks"
  | "post_event_history_below_two_windows"
  | "recovery_observed_within_one_window"
  | "query_breakdown_unavailable"
  | "index_report_predates_event"
  /**
   * The site has never had a week big enough for the detector to work on.
   * Reported instead of a bare "no decline found", which would read as "we
   * checked and you are fine" when the truth is that we cannot tell.
   */
  | "site_below_detection_floor"
  /**
   * Traffic fell from a spike back to the level it held before the spike. A
   * promotion or seasonal peak ending is not a decline, and reporting it as
   * one would have every retailer diagnosing a crisis each January.
   */
  | "returned_to_prior_normal"
  /**
   * The event falls inside the days Search Console has not finalised, so it may
   * be the reporting lag rather than something that happened to the site.
   */
  | "event_within_unfinalized_window"
  /**
   * The verdict stands, but the most recent comparison window includes days
   * Search Console has not finalised, which read low and may revise upward.
   */
  | "recent_window_unfinalized";

/**
 * Explanations the data is consistent with but cannot establish. Kept as codes
 * so a hypothesis can never be authored into a claim at the copy layer.
 */
export type TrafficHypothesisCode =
  | "demand_cohort_receded"
  | "low_intent_query_influx";

export interface TrafficChangePoint {
  readonly state: TrafficChangeState;
  /** Empty when no event was located. Ordered peak → mid → recent. */
  readonly windows: readonly TrafficWindow[];
  /** Why the detector could not go further. Null when nothing held it back. */
  readonly limitation: TrafficLimitationCode | null;
}

/**
 * Evidence tier of a finding. The engine never blurs these:
 * an observation is a fact in the data, a hypothesis is not.
 */
export type TrafficFindingTier = "observed" | "hypothesis" | "data_boundary";

export type TrafficFindingId =
  | "two_stage_decline"
  | "sustained_decline"
  | "decline_concentration"
  | "high_impression_low_click_day"
  | "transient_visibility_anomaly"
  | "seasonality_unavailable";

/** One measured quantity backing a finding. Rendered as-is; never re-derived in the UI. */
export interface TrafficMeasure {
  /** i18n key (`measures.<key>`), not display text. */
  readonly key: string;
  /** Null carries "not available", which the UI must not render as 0. */
  readonly value: number | string | null;
}

export interface TrafficFinding {
  readonly id: TrafficFindingId;
  readonly tier: TrafficFindingTier;
  readonly measures: readonly TrafficMeasure[];
  /** Query strings that carry the finding, when query-level data was supplied. */
  readonly queries: readonly string[];
  /**
   * A competing explanation the data is consistent with but cannot establish.
   * Present only on findings that invite a causal read; null otherwise.
   */
  readonly hypothesis: TrafficHypothesisCode | null;
  readonly limitation: TrafficLimitationCode | null;
}

/**
 * What the reader should do next.
 *
 * `avoid` is a first-class kind: telling someone not to chase a composition
 * artefact is as actionable as telling them to fix something, and it is the
 * recommendation an evidence-first tool is uniquely able to make.
 */
export type TrafficActionKind = "do" | "external_data" | "avoid";

export interface TrafficAction {
  readonly id: string;
  readonly kind: TrafficActionKind;
  /** Findings this action rests on. Never empty: no evidence, no action. */
  readonly basis: readonly TrafficFindingId[];
}

/**
 * Every check the run performed, including the ones that found nothing and the
 * ones it could not run. Publishing only the hits would read as "we looked at
 * everything and this is all there was".
 */
export type TrafficCheckStatus = "hit" | "clear" | "not_available";

export type TrafficUnavailableReason =
  | "history_below_twelve_weeks"
  | "history_below_thirteen_months"
  | "query_data_not_supplied"
  | "page_data_not_supplied"
  | "probe_data_not_supplied"
  | "index_report_lag"
  | "site_below_detection_floor"
  | "no_recent_days"
  /**
   * The site is old enough, but the event is too recent to judge yet. Distinct
   * from `history_below_twelve_weeks`: telling the owner of a two-year-old
   * property that it "has not been around for twelve weeks" is a statement
   * about their own data that they know to be false, and it costs the whole
   * report its credibility.
   */
  | "post_event_history_below_two_windows"
  /**
   * Year-over-year comparison is not implemented in this tool. The honest
   * status for a check that does not exist is `not_available`, never `clear` —
   * `clear` claims we looked.
   */
  | "yoy_comparison_not_implemented";

export interface TrafficCheck {
  readonly id: string;
  readonly status: TrafficCheckStatus;
  /** Why the check could not run. Null unless status is not_available. */
  readonly unavailableReason: TrafficUnavailableReason | null;
}

export interface TrafficDropResult {
  /**
   * Inclusive bounds of the analysed series, and the calendar span it covers.
   *
   * Null when the property returned no rows: a range we do not have is not
   * today's date. `dayCount` is a calendar span, not a row count, because
   * Search Console omits days a property drew nothing.
   */
  readonly dataStartDate: string | null;
  readonly dataEndDate: string | null;
  readonly dayCount: number;
  readonly changePoint: TrafficChangePoint;
  readonly findings: readonly TrafficFinding[];
  readonly actions: readonly TrafficAction[];
  readonly checks: readonly TrafficCheck[];
}

export type TrafficDropEnvelope = PublicToolResultEnvelope<
  TrafficDropResult,
  "traffic_drop_diagnosis",
  "property"
>;

export type TrafficDropErrorCode =
  | "insufficient_history"
  | "no_gsc_data"
  | "gsc_unavailable";
