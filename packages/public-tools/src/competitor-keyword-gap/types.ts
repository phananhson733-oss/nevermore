// @input  -- normalized request fields plus sanitized DFS and optional GSC observations
// @output -- the versioned, provider-safe competitor keyword gap result contract
// @pos    -- shared evidence boundary for the authenticated Marketing tool

import type { PublicToolErrorEnvelope, PublicToolRun } from "../contract.ts";

export const COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION =
  "competitor_keyword_gap.v3";
export const COMPETITOR_KEYWORD_GAP_TOOL = "competitor_keyword_gap";
/** Server-owned per-competitor cap; billing is per returned row so the rank filter keeps runs cheap. */
export const COMPETITOR_KEYWORD_GAP_PROVIDER_LIMIT = 300;
export const COMPETITOR_KEYWORD_GAP_MAX_COMPETITOR_RANK = 20;
/** Pre-screen thresholds. KD is a band input only; it is never a filter and never called winnability. */
export const COMPETITOR_KEYWORD_GAP_KD_LOW_MAX = 30;
export const COMPETITOR_KEYWORD_GAP_KD_HEAD_MIN = 61;
export const COMPETITOR_KEYWORD_GAP_PAGE_ONE_RANK_MAX = 10;

export interface CompetitorKeywordGapRequestV1 {
  readonly property?: string;
  readonly siteDomain: string;
  readonly competitorDomains: readonly string[];
  readonly marketCode: string;
  readonly languageCode: string;
  /**
   * The result contract version the CLIENT was built against
   * (`COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION` in its bundle). Optional because
   * older clients do not send it; when present and different from the
   * server's version, the request is refused (`client_out_of_date`) before
   * any paid provider call, so a stale tab never pays for a result its
   * bundle cannot read.
   */
  readonly acceptSchemaVersion?: string;
}

/**
 * Every public code the Marketing surface must have localized copy for.
 *
 * The union below is derived FROM this array -- like the pre-screen bands --
 * so a code cannot exist without a place in the surface's copy. A `satisfies`
 * clause would only prove the listed entries are valid, never that the list
 * is complete.
 */
export const COMPETITOR_KEYWORD_GAP_ERROR_CODES = [
  "invalid_input",
  "invalid_request",
  "payload_too_large",
  "unsupported_media_type",
  "auth_required",
  "auth_unavailable",
  "search_in_progress",
  "keyword_source_unavailable",
  "client_out_of_date",
  // Search Console preflight refusals. They exist because a request that
  // names a property is asking for BOTH halves; when the first-party half
  // cannot happen, the run is refused before the paid provider calls rather
  // than charged for and delivered with a silently missing overlay.
  "gsc_property_not_granted",
  "gsc_property_site_mismatch",
  "gsc_revoked",
  "gsc_temporarily_unavailable",
  "rate_limited",
  "quota_unavailable",
  "scan_in_progress",
] as const;

export type CompetitorKeywordGapErrorCode =
  (typeof COMPETITOR_KEYWORD_GAP_ERROR_CODES)[number];

export type CompetitorKeywordGapErrorEnvelope =
  PublicToolErrorEnvelope<CompetitorKeywordGapErrorCode>;

export type CompetitorKeywordGapRunStatus =
  | "complete"
  | "partial"
  | "unavailable";

export type CompetitorKeywordGapMetricAvailability =
  | "available"
  | "explicit_zero"
  | "provider_no_data";

export interface CompetitorKeywordGapMetric {
  readonly availability: CompetitorKeywordGapMetricAvailability;
  readonly value: number | null;
}

export type CompetitorKeywordGapGscOverlayStatus =
  | "not_requested"
  | "available"
  | "partial"
  | "unavailable";

export type CompetitorKeywordGapGscQueryStatus =
  | "observed_strong"
  | "observed_weak"
  | "not_observed_in_gsc_query_sample"
  | "gsc_query_sample_not_read";

export type CompetitorKeywordGapGscEvidenceBasis =
  | "query"
  | "query_page"
  | null;

export type CompetitorKeywordGapGscPageStatus =
  | "observed_sufficient"
  | "observed_partial"
  | "not_observed_in_gsc_query_page_sample"
  | "gsc_query_page_sample_not_read";

export type CompetitorKeywordGapNextStep =
  | "optimize_existing"
  | "review_existing_query"
  | "review_content_gap"
  | "verify_own_coverage";

export interface CompetitorKeywordGapGscEvidence {
  readonly queryStatus: CompetitorKeywordGapGscQueryStatus;
  readonly evidenceBasis: CompetitorKeywordGapGscEvidenceBasis;
  readonly queryImpressions: number | null;
  readonly queryPosition: number | null;
  readonly pageStatus: CompetitorKeywordGapGscPageStatus;
  readonly pageUrl: string | null;
  readonly pageImpressions: number | null;
  readonly pagePosition: number | null;
  readonly queryPageCoverage: number | null;
  readonly nextStep: CompetitorKeywordGapNextStep;
}

export type CompetitorKeywordGapCompetitorFailureCode =
  "keyword_source_unavailable";

export interface CompetitorKeywordGapCompetitorCoverage {
  readonly domain: string;
  readonly status: "complete" | "unavailable";
  readonly returnedRows: number;
  readonly totalCount: number | null;
  readonly truncated: boolean;
  readonly failureCode: CompetitorKeywordGapCompetitorFailureCode | null;
}

export interface CompetitorKeywordGapSampleRule {
  readonly maxCompetitorRank: number;
  readonly perCompetitorLimit: number;
  readonly serpSnapshotRequested: boolean;
}

export interface CompetitorKeywordGapCompetitorPage {
  /** http(s) only, no userinfo, bounded length; null when the provider gave none. */
  readonly url: string | null;
  readonly title: string | null;
  /** Provider estimated monthly traffic to the ranking page. */
  readonly etv: number | null;
}

export interface CompetitorKeywordGapSearchVolumeTrend {
  readonly monthly: number | null;
  readonly quarterly: number | null;
  readonly yearly: number | null;
}

/** A dated provider snapshot of the SERP, never an observation made by this tool. */
export interface CompetitorKeywordGapSerpSnapshot {
  readonly itemTypes: readonly string[];
  readonly updatedAt: string | null;
}

/**
 * Display order inside a GSC lane: prioritize, stretch, unbanded, head, brand.
 * The union is derived from this array so a band cannot exist without a place
 * in the order.
 */
export const COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS = [
  "prioritize_serp_check",
  "stretch",
  "unbanded",
  "defer_head_term",
  "defer_brand_navigational",
] as const;

export type CompetitorKeywordGapPreScreenBand =
  (typeof COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS)[number];

/**
 * Where a pre-screen reason comes from. KD/volume/rank/intent reasons are
 * provider estimates; the brand-token, hostname-shape and domain-profile-page
 * reasons are this tool's own text/URL heuristics and must be labelled as such.
 */
export type CompetitorKeywordGapPreScreenBasis =
  | "dfs_estimate"
  | "tool_heuristic";

export const COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BASES = [
  "dfs_estimate",
  "tool_heuristic",
] as const satisfies readonly CompetitorKeywordGapPreScreenBasis[];

/**
 * The single check that decided the band. `kd_mid_rank_top20` is the fallthrough for
 * every row that is not both low-KD and page-one (KD 31-60 on page one, KD <= 30 on
 * page two, KD 31-60 on page two); it must not be rendered as "mid KD". The "top20"
 * half is the sample rule (`COMPETITOR_KEYWORD_GAP_MAX_COMPETITOR_RANK`), which the
 * policy does not re-check.
 *
 * The union is derived from this array, like the bands, so a reason cannot exist
 * without a place in the surface's copy.
 */
export const COMPETITOR_KEYWORD_GAP_PRE_SCREEN_REASONS = [
  "kd_low_rank_top10",
  "kd_mid_rank_top20",
  "kd_high",
  "dfs_metric_missing",
  "competitor_brand_token",
  "competitor_domain_profile_page",
  "domain_like_keyword",
  "provider_navigational_intent",
] as const;

export type CompetitorKeywordGapPreScreenReason =
  (typeof COMPETITOR_KEYWORD_GAP_PRE_SCREEN_REASONS)[number];

/** Second, orthogonal axis next to `nextStep`; an estimate or a heuristic, never winnability. */
export interface CompetitorKeywordGapPreScreen {
  readonly band: CompetitorKeywordGapPreScreenBand;
  readonly basis: CompetitorKeywordGapPreScreenBasis;
  readonly reason: CompetitorKeywordGapPreScreenReason;
}

export interface CompetitorKeywordGapRow {
  readonly keyword: string;
  readonly competitorRanks: Readonly<Record<string, number>>;
  readonly competitorPages: Readonly<
    Record<string, CompetitorKeywordGapCompetitorPage>
  >;
  readonly competitorCount: number;
  readonly bestCompetitorRank: number;
  readonly ownState: "not_observed_in_provider_rankings";
  readonly searchVolume: CompetitorKeywordGapMetric;
  readonly cpc: CompetitorKeywordGapMetric;
  readonly keywordDifficulty: CompetitorKeywordGapMetric;
  readonly providerIntent: string | null;
  /** DFS-reported `keyword_properties.core_keyword`; null when the provider gave none. */
  readonly coreKeyword: string | null;
  /** DFS-reported `keyword_info.search_volume_trend` percentages; null when the provider gave none. */
  readonly searchVolumeTrend: CompetitorKeywordGapSearchVolumeTrend | null;
  /** null when the snapshot was not requested or the provider reported none. */
  readonly serpSnapshot: CompetitorKeywordGapSerpSnapshot | null;
  readonly preScreen: CompetitorKeywordGapPreScreen;
  readonly gsc: CompetitorKeywordGapGscEvidence;
}

export interface CompetitorKeywordGapResultV3 {
  readonly capturedAt: string;
  readonly siteDomain: string;
  readonly competitorDomains: readonly string[];
  readonly marketCode: string;
  readonly languageCode: string;
  readonly sampleRule: CompetitorKeywordGapSampleRule;
  readonly requestedCompetitors: number;
  readonly completedCompetitors: number;
  readonly unavailableCompetitors: number;
  readonly competitors: readonly CompetitorKeywordGapCompetitorCoverage[];
  readonly rows: readonly CompetitorKeywordGapRow[];
  readonly resultTruncated: boolean;
  readonly overlayStatus: CompetitorKeywordGapGscOverlayStatus;
  readonly gscQueryTruncated: boolean;
  readonly gscQueryPageTruncated: boolean;
  /** Raw GSC row counts so "available with 0 observed" differs from "GSC returned nothing". */
  readonly gscQueryRowCount: number | null;
  readonly gscQueryPageRowCount: number | null;
}

export interface CompetitorKeywordGapRun extends PublicToolRun<
  typeof COMPETITOR_KEYWORD_GAP_TOOL,
  "site"
> {
  readonly schemaVersion: typeof COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION;
  readonly status: CompetitorKeywordGapRunStatus;
}

export interface CompetitorKeywordGapEnvelope {
  readonly run: CompetitorKeywordGapRun;
  readonly result: CompetitorKeywordGapResultV3;
}
