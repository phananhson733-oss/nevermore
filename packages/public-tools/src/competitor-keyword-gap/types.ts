// @input  -- normalized request fields plus sanitized DFS and optional GSC observations
// @output -- the versioned, provider-safe competitor keyword gap result contract
// @pos    -- shared evidence boundary for the authenticated Marketing tool

import type {
  PublicToolErrorEnvelope,
  PublicToolRun,
} from "../contract.ts";

export const COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION =
  "competitor_keyword_gap.v2";
export const COMPETITOR_KEYWORD_GAP_TOOL = "competitor_keyword_gap";
export const COMPETITOR_KEYWORD_GAP_PROVIDER_LIMIT = 100;

export interface CompetitorKeywordGapRequestV1 {
  readonly property?: string;
  readonly siteDomain: string;
  readonly competitorDomains: readonly string[];
  readonly marketCode: string;
  readonly languageCode: string;
}

export type CompetitorKeywordGapErrorCode =
  | "invalid_input"
  | "invalid_request"
  | "payload_too_large"
  | "unsupported_media_type"
  | "auth_required"
  | "auth_unavailable"
  | "search_in_progress"
  | "keyword_source_unavailable";

/** Every public code the Marketing surface must have localized copy for. */
export const COMPETITOR_KEYWORD_GAP_ERROR_CODES = [
  "invalid_input",
  "invalid_request",
  "payload_too_large",
  "unsupported_media_type",
  "auth_required",
  "auth_unavailable",
  "search_in_progress",
  "keyword_source_unavailable",
] as const satisfies readonly CompetitorKeywordGapErrorCode[];

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

export interface CompetitorKeywordGapRow {
  readonly keyword: string;
  readonly competitorRanks: Readonly<Record<string, number>>;
  readonly competitorCount: number;
  readonly bestCompetitorRank: number;
  readonly ownState: "not_observed_in_provider_rankings";
  readonly searchVolume: CompetitorKeywordGapMetric;
  readonly cpc: CompetitorKeywordGapMetric;
  readonly keywordDifficulty: CompetitorKeywordGapMetric;
  readonly providerIntent: string | null;
  readonly gsc: CompetitorKeywordGapGscEvidence;
}

export interface CompetitorKeywordGapResultV2 {
  readonly capturedAt: string;
  readonly siteDomain: string;
  readonly competitorDomains: readonly string[];
  readonly marketCode: string;
  readonly languageCode: string;
  readonly requestedCompetitors: number;
  readonly completedCompetitors: number;
  readonly unavailableCompetitors: number;
  readonly competitors: readonly CompetitorKeywordGapCompetitorCoverage[];
  readonly rows: readonly CompetitorKeywordGapRow[];
  readonly resultTruncated: boolean;
  readonly overlayStatus: CompetitorKeywordGapGscOverlayStatus;
  readonly gscQueryTruncated: boolean;
  readonly gscQueryPageTruncated: boolean;
}

export interface CompetitorKeywordGapRun
  extends PublicToolRun<typeof COMPETITOR_KEYWORD_GAP_TOOL, "site"> {
  readonly schemaVersion: typeof COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION;
  readonly status: CompetitorKeywordGapRunStatus;
}

export interface CompetitorKeywordGapEnvelope {
  readonly run: CompetitorKeywordGapRun;
  readonly result: CompetitorKeywordGapResultV2;
}
