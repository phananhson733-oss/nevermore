// @input  -- final Search Console day rows and optional query-level attachments
// @output -- the schema-versioned, non-persistent daily briefing contract
// @pos    -- public type boundary for the deterministic daily briefing core

import type { PublicToolResultEnvelope } from "../contract.ts";
import type {
  GscQueryPageRow,
} from "../gsc-analytics/page-reader.ts";
import type {
  PropertyTotals,
  QueryRowsRead,
} from "../gsc-analytics/reader.ts";
import type { GscReadPaging } from "../gsc-analytics/types.ts";
import type { GscWindow } from "../gsc-analytics/window.ts";
import type { GscQueryRow } from "../site-baseline/types.ts";

export type DailyBriefingCadence = "daily" | "weekly";

/**
 * Which briefing the property can actually support this run.
 *
 * Claimed from measured capability, never from what the tool wishes it had.
 * `change_detection` requires that at least one strict change lane had the
 * paired evidence to ask its question. `position_observation` says no strict
 * lane could be asked but some queries carry a prior window large enough to
 * watch a position move provisionally. `current_position_watchlist` says only
 * the current window can be described at all.
 *
 * `unavailable` is not a fourth kind of briefing: it says the query rows could
 * not be read, so no claim can be made. Calling that `change_detection` put a
 * mode the data never supported in front of the reader, and let the cadence
 * promise a daily one.
 */
export type DailyBriefingMode =
  | "change_detection"
  | "position_observation"
  | "current_position_watchlist"
  | "unavailable";

export type DailyBriefingEvidenceState =
  | "observed"
  | "not_observed"
  | "partial"
  | "unavailable";

export type DailyBriefingChangeKind =
  | "click_opportunity"
  | "stable_position_click_decline"
  | "average_position_crossed_page_one_band"
  | "actionable_position_decline"
  | "first_observed";

/**
 * Whether a lane produced evidence, could not apply, or could not be read.
 *
 * `not_applicable` and `unavailable` both yield zero signals and must stay
 * distinguishable: the first says the property has nothing this lane could
 * ever measure, the second says we could not look.
 */
export type DailyBriefingLaneState =
  | "evaluated"
  | "not_applicable"
  | "unavailable";

/** Why the CTR opportunity lane could not run, in the operator's terms. */
export type DailyBriefingCtrLaneBlocker =
  | "brand_terms_not_confirmed"
  | "insufficient_band_impressions"
  | "insufficient_band_queries"
  | "no_position_band_coverage";

export type DailyBriefingActionDestination =
  | "seo-quick-wins"
  | "traffic-drop-diagnosis"
  | "on-page-seo-check";

export interface DailyBriefingDateRow {
  readonly date: string;
  readonly clicks: number;
  readonly impressions: number;
  /** Impression-weighted average position reported by Search Console. */
  readonly position: number;
}

export interface DailyBriefingKpis {
  readonly clicks: number;
  readonly impressions: number;
  /** Null when impressions are zero. */
  readonly ctr: number | null;
  /** Null when impressions are zero. */
  readonly position: number | null;
}

export interface DailyBriefingKpiDelta {
  readonly clicks: number | null;
  readonly clicksRatio: number | null;
  readonly impressions: number | null;
  readonly impressionsRatio: number | null;
  readonly ctr: number | null;
  readonly position: number | null;
}

export interface DailyBriefingKpiComparison {
  readonly evidence: "observed" | "unavailable";
  readonly current: DailyBriefingKpis | null;
  readonly previous: DailyBriefingKpis | null;
  readonly delta: DailyBriefingKpiDelta;
}

export interface DailyBriefingWindows {
  readonly latestDay: GscWindow;
  readonly previousDay: GscWindow;
  readonly current7Days: GscWindow;
  readonly previous7Days: GscWindow;
  /** The single required date-dimension read. */
  readonly readRange: GscWindow;
}

export interface DailyBriefingQueryPageRead {
  readonly rows: readonly GscQueryPageRow[];
  readonly paging: GscReadPaging;
  readonly responseAggregationType: string | null;
}

export interface DailyBriefingQueryEvidence {
  readonly queryRead: QueryRowsRead | null;
  readonly queryPageRead: DailyBriefingQueryPageRead | null;
  readonly propertyTotals: PropertyTotals | null;
}

export interface DailyBriefingWindowCoverage {
  readonly evidence: Exclude<DailyBriefingEvidenceState, "not_observed">;
  readonly queryRows: number;
  readonly queryPageRows: number;
  readonly eligibleQueries: number;
  readonly coveredQueries: number;
  readonly minimumQueryPageCoverage: number;
}

export interface DailyBriefingCoverage {
  readonly current: DailyBriefingWindowCoverage;
  readonly previous: DailyBriefingWindowCoverage;
}

export interface DailyBriefingAnonymization {
  readonly evidence: Exclude<DailyBriefingEvidenceState, "not_observed">;
  readonly queryImpressions: number | null;
  readonly propertyImpressions: number | null;
  readonly missingImpressionShare: number | null;
  readonly queryClicks: number | null;
  readonly propertyClicks: number | null;
  readonly missingClickShare: number | null;
}

export interface DailyBriefingAnonymizationWindows {
  readonly current: DailyBriefingAnonymization;
  readonly previous: DailyBriefingAnonymization;
}

export interface DailyBriefingChange {
  readonly kind: DailyBriefingChangeKind;
  readonly evidence: "observed" | "not_observed";
  readonly query: string;
  /**
   * The page carrying the query, or null when page evidence is withheld.
   *
   * A query signal and its page attribution are separate facts. Withholding
   * the page must not delete the query signal that was observed.
   */
  readonly page: string | null;
  readonly pageEvidence: "observed" | "unavailable";
  /** Query totals for query-level changes; exact pair metrics for first_observed. */
  readonly current: GscQueryRow;
  /** Null means this exact query/page pair was not observed in the prior read. */
  readonly previous: GscQueryRow | null;
  readonly clickChange: number | null;
  readonly clickChangeRatio: number | null;
  readonly positionDelta: number | null;
  /** Populated only for click_opportunity. */
  readonly baselineCtr: number | null;
  /** Populated only for click_opportunity. */
  readonly clickGap: number | null;
}

export interface DailyBriefingAction {
  readonly kind: DailyBriefingChangeKind;
  readonly destination: DailyBriefingActionDestination;
  readonly query: string;
  readonly page: string;
}

/**
 * A property-level move large enough to hand off.
 *
 * These three spellings license the words "material decline" and "material
 * gain". Nothing else does.
 */
export type DailyBriefingPropertyActionKind =
  | "sitewide_click_decline"
  | "sitewide_visibility_decline"
  | "sitewide_visibility_gain";

/**
 * A property-level move that stayed inside its own counting noise.
 *
 * The earlier contract encoded these as declines and let the noise floor
 * decide only whether to dispatch a diagnosis, so a headline asserted a
 * material decline and the sentence under it withdrew the claim. The kind
 * itself now carries what the sample can support.
 */
export type DailyBriefingPropertyObservationKind =
  | "sitewide_click_observation"
  | "sitewide_visibility_observation";

export type DailyBriefingPropertyChangeKind =
  | DailyBriefingPropertyActionKind
  | DailyBriefingPropertyObservationKind;

export interface DailyBriefingPropertyChange {
  readonly kind: DailyBriefingPropertyChangeKind;
  readonly evidence: "observed";
  readonly query: null;
  readonly page: null;
  readonly current: DailyBriefingKpis;
  readonly previous: DailyBriefingKpis;
  readonly clickChange: number;
  readonly clickChangeRatio: number | null;
  readonly impressionChange: number;
  readonly impressionChangeRatio: number | null;
  readonly positionDelta: number | null;
}

/**
 * The counting-noise floor a property-level change must clear to drive action.
 *
 * Weekly totals are counts, so their run-to-run spread grows with the square
 * root of the base. A fifteen percent move on twenty-one clicks sits inside
 * that spread; calling it a material decline and dispatching a diagnosis is a
 * claim the sample cannot support.
 */
export interface DailyBriefingPropertyNoiseFloor {
  readonly basis: "clicks" | "impressions";
  readonly observedChange: number;
  readonly minimumForAction: number;
  readonly cleared: boolean;
}

export interface DailyBriefingPropertyTrend {
  readonly change: DailyBriefingPropertyChange | null;
  /** Null when the change was observed but stayed inside the noise floor. */
  readonly action: {
    readonly kind: DailyBriefingPropertyActionKind;
    readonly destination: "traffic-drop-diagnosis" | "seo-quick-wins";
  } | null;
  readonly noiseFloor: DailyBriefingPropertyNoiseFloor | null;
}

export interface DailyBriefingCtrLane {
  readonly state: DailyBriefingLaneState;
  readonly blockers: readonly DailyBriefingCtrLaneBlocker[];
  /** Position bands whose own rows can serve as a baseline, or null when unread. */
  readonly usableBaselineBands: number | null;
}

/**
 * Which lanes this property can support, measured rather than assumed.
 *
 * The action-eligible query count cannot answer this: a query sitting at
 * average position ninety with a hundred impressions clears that floor and
 * still cannot produce a single click signal.
 */
export interface DailyBriefingLaneCapability {
  readonly evidence: "observed" | "partial" | "unavailable";
  /** Queries with a comparable prior window carrying at least the click floor. */
  readonly clickDeclineCapableQueries: number | null;
  /** Queries the CTR lane could measure against a usable band baseline. */
  readonly ctrOpportunityCapableQueries: number | null;
  /**
   * Queries a strict position lane could ask about: both windows at the
   * sample floor, both average positions readable.
   */
  readonly strictPairedPositionQueries: number | null;
  /**
   * Queries whose prior window carries 50-99 impressions.
   *
   * Enough to watch a position move, never enough to call it a change. Kept
   * separate so a provisional observation can never be counted as strict
   * capability.
   */
  readonly provisionalPairedPositionQueries: number | null;
  /** Queries at the current sample floor with no comparable prior window. */
  readonly currentFloorOnlyQueries: number | null;
  readonly ctrLane: DailyBriefingCtrLane;
  readonly lanes: Readonly<Record<DailyBriefingChangeKind, DailyBriefingLaneState>>;
}

export interface DailyBriefingSignalFunnel {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly observedQueryRows: number | null;
  /** Current query rows with 50–99 impressions; never action-eligible. */
  readonly observationCandidates: number | null;
  /** Current query rows at the existing 100-impression sample floor. */
  readonly actionEligibleQueries: number | null;
  readonly ctrBaselineRows: number | null;
  readonly clickOpportunityCandidates: number | null;
  readonly stableDeclineCandidates: number | null;
  readonly pageOneBandCandidates: number | null;
  readonly positionDeclineCandidates: number | null;
  readonly firstObservedCandidates: number | null;
  /** Position moves seen only against a 50-99 impression prior window. */
  readonly provisionalMoveCandidates: number | null;
  readonly pageAttributionWithheld: number | null;
  readonly selectedQueryChanges: number;
  readonly propertyTrendShown: boolean;
}

/** What one lane did with the current window's query rows. */
export interface DailyBriefingLaneRowCounts {
  /** Rows this lane had no way to ask about. */
  readonly notEvaluated: number;
  /** Rows this lane asked about and found nothing in. */
  readonly evaluatedNoSignal: number;
  /** Rows this lane produced a candidate from. */
  readonly candidates: number;
}

/**
 * Where the current window's query rows ended up, per lane.
 *
 * The single `filteredObservedRows` count this replaces could only be read as
 * "rows that formed no candidate", and the copy above it read it as "rows that
 * failed a threshold" - which most of them were never tested against. Rows a
 * lane never evaluated and rows it evaluated and rejected are different facts
 * and are now reported as different numbers.
 */
export interface DailyBriefingRowAccounting {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly observedRows: number | null;
  /** Rows that produced a candidate but lost the display budget. */
  readonly notSelectedVisibleRows: number | null;
  readonly byLane: Readonly<
    Record<DailyBriefingChangeKind, DailyBriefingLaneRowCounts>
  > | null;
}

/**
 * The sample state of an observation.
 *
 * `sample_floor_reached` says only that the row cleared the impression floor.
 * It does not claim any lane evaluated it, which is why the earlier
 * `evaluation_eligible` spelling had to go.
 */
export type DailyBriefingQueryObservationKind =
  | "sample_floor_reached"
  | "sample_building";

/** Actionability band of an observation's current average position. */
export type DailyBriefingObservationBand =
  | "page_one"
  | "near_page_one"
  | "mid"
  | "far";

export interface DailyBriefingQueryObservation {
  readonly kind: DailyBriefingQueryObservationKind;
  readonly band: DailyBriefingObservationBand;
  readonly query: string;
  readonly page: string | null;
  readonly pageEvidence: "observed" | "unavailable";
  readonly current: GscQueryRow;
  readonly previous: GscQueryRow | null;
  readonly positionDelta: number | null;
}

export interface DailyBriefingQueryWatchlist {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly items: readonly DailyBriefingQueryObservation[];
  /** Observations that qualified before the display budget was applied. */
  readonly candidates: number | null;
  /**
   * Qualified observations the display budget left out, by band.
   *
   * Without this the page called the rows it dropped "below the threshold",
   * when several of them had cleared every threshold and simply lost the cut.
   */
  readonly withheldByBand: Readonly<
    Record<DailyBriefingObservationBand, number>
  > | null;
  /**
   * Withheld observations by sample tier.
   *
   * The band alone cannot say whether a dropped row had cleared the strict
   * sample floor, and "they are not below a threshold" is true of one tier and
   * false of the other.
   */
  readonly withheldByKind: Readonly<
    Record<DailyBriefingQueryObservationKind, number>
  > | null;
}

/**
 * A position move seen against a prior window too small to call it a change.
 *
 * The strict lanes require both windows at the 100-impression floor because an
 * impression-weighted average position over a handful of impressions is not a
 * stable quantity. Dropping that floor would reopen the low-sample door this
 * tool closed on purpose. Reporting the move as an observation - never as a
 * change, never as an action - is the honest middle.
 */
export type DailyBriefingProvisionalMoveKind =
  | "provisional_page_one_band_entry"
  | "provisional_actionable_position_decline";

export interface DailyBriefingProvisionalMove {
  readonly kind: DailyBriefingProvisionalMoveKind;
  readonly evidence: "observed";
  readonly query: string;
  readonly page: string | null;
  readonly pageEvidence: "observed" | "unavailable";
  readonly current: GscQueryRow;
  readonly previous: GscQueryRow;
  readonly positionDelta: number;
}

export interface DailyBriefingProvisionalMoves {
  readonly evidence: "observed" | "partial" | "unavailable";
  readonly items: readonly DailyBriefingProvisionalMove[];
  /** Provisional moves found before the display budget was applied. */
  readonly candidates: number | null;
  /** The prior-window impression range that makes these provisional. */
  readonly priorWindowImpressionRange: readonly [number, number];
}

export type DailyBriefingLimitationCode =
  | "daily_data_incomplete"
  | "daily_rows_omitted"
  | "query_evidence_unavailable"
  | "property_totals_unavailable"
  | "query_evidence_partial"
  | "query_page_coverage_below_floor"
  | "aggregation_basis_mismatch"
  | "anonymization_gap_uncomputable"
  | "brand_terms_not_confirmed"
  | "property_change_inside_noise_floor";

export interface DailyBriefingResult {
  readonly windows: DailyBriefingWindows;
  readonly day: DailyBriefingKpiComparison;
  readonly weekly: DailyBriefingKpiComparison;
  readonly mode: DailyBriefingMode;
  readonly cadence: DailyBriefingCadence;
  readonly laneCapability: DailyBriefingLaneCapability;
  readonly changes: readonly DailyBriefingChange[];
  readonly actions: readonly DailyBriefingAction[];
  /** Always evaluated; never suppressed by query-level signals. */
  readonly propertyTrend: DailyBriefingPropertyTrend;
  readonly signalFunnel: DailyBriefingSignalFunnel;
  readonly queryWatchlist: DailyBriefingQueryWatchlist;
  /** Position moves reported as observations, never as changes or actions. */
  readonly provisionalMoves: DailyBriefingProvisionalMoves;
  readonly rowAccounting: DailyBriefingRowAccounting;
  readonly coverage: DailyBriefingCoverage;
  readonly anonymization: DailyBriefingAnonymizationWindows;
  readonly limitations: readonly DailyBriefingLimitationCode[];
}

export type DailyBriefingEnvelope = PublicToolResultEnvelope<
  DailyBriefingResult,
  "daily_search_briefing",
  "property"
>;

export interface BuildDailyBriefingInput {
  readonly now: Date;
  readonly dateRows: readonly DailyBriefingDateRow[];
  readonly currentQueryEvidence?: DailyBriefingQueryEvidence | null;
  readonly previousQueryEvidence?: DailyBriefingQueryEvidence | null;
  readonly brandTerms: readonly string[];
  readonly brandTermsConfirmed: boolean;
}
