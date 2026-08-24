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

export type DailyBriefingEvidenceState =
  | "observed"
  | "not_observed"
  | "partial"
  | "unavailable";

export type DailyBriefingChangeKind =
  | "click_opportunity"
  | "stable_position_click_decline"
  | "first_observed";

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
  readonly page: string;
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

export type DailyBriefingLimitationCode =
  | "daily_data_incomplete"
  | "daily_rows_omitted"
  | "query_evidence_unavailable"
  | "property_totals_unavailable"
  | "query_evidence_partial"
  | "query_page_coverage_below_floor"
  | "aggregation_basis_mismatch"
  | "anonymization_gap_uncomputable"
  | "brand_terms_not_confirmed";

export interface DailyBriefingResult {
  readonly windows: DailyBriefingWindows;
  readonly day: DailyBriefingKpiComparison;
  readonly weekly: DailyBriefingKpiComparison;
  readonly cadence: DailyBriefingCadence;
  readonly changes: readonly DailyBriefingChange[];
  readonly actions: readonly DailyBriefingAction[];
  /** Rows in the observed query read that did not clear any signal threshold. */
  readonly filteredObservedRows: number;
  /** False when the count describes only a prefix or no query read happened. */
  readonly countComplete: boolean;
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
