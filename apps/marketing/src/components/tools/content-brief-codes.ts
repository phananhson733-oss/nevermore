// @input  -- the closed code unions of @sf/public-tools/content-brief/contract
// @output -- the same unions as complete runtime arrays, so copy tables and
//            client allow-lists can walk every member
// @pos    -- the one place the brief's closed codes exist as values; the
//            messages test and the tool's error allow-list both read from here

import type {
  ContentBriefErrorCode,
  CrawlFailure,
  CrawlSkipped,
  FormatField,
  GapKind,
  GscReadMeta,
  IntentField,
  Origin,
  RunMode,
  SerpFormat,
  UnavailableReason,
  Verdict,
} from "@sf/public-tools/content-brief/contract";

/**
 * Every array below is checked for completeness at the type level.
 *
 * `satisfies readonly T[]` proves each entry is a member; it does not prove
 * the list holds all of them. The `Complete<...>` assertion fails compilation
 * with the missing member's name when the contract grows and the array does
 * not, which is the failure mode a hand-kept list otherwise hides: the new
 * code type-checks everywhere and renders a raw key path in front of a visitor.
 */
type Complete<Union extends string, Listed extends string> = [
  Exclude<Union, Listed>,
] extends [never]
  ? true
  : Exclude<Union, Listed>;

export const UNAVAILABLE_REASONS = [
  "not_requested",
  "not_connected",
  "not_configured",
  "timeout",
  "provider_error",
  "quota_exhausted",
  "insufficient_evidence",
  "unsupported_language",
  "validation_failed",
] as const satisfies readonly UnavailableReason[];
const UNAVAILABLE_REASONS_COMPLETE: Complete<
  UnavailableReason,
  (typeof UNAVAILABLE_REASONS)[number]
> = true;
void UNAVAILABLE_REASONS_COMPLETE;

export const RUN_MODES = [
  "complete",
  "partial",
  "degraded",
  "unavailable",
] as const satisfies readonly RunMode[];
const RUN_MODES_COMPLETE: Complete<RunMode, (typeof RUN_MODES)[number]> = true;
void RUN_MODES_COMPLETE;

export const SERP_FORMATS = [
  "guide",
  "listicle",
  "comparison",
  "product_page",
  "tool",
  "forum",
  "video",
  "news",
  "unknown",
] as const satisfies readonly SerpFormat[];
const SERP_FORMATS_COMPLETE: Complete<
  SerpFormat,
  (typeof SERP_FORMATS)[number]
> = true;
void SERP_FORMATS_COMPLETE;

type IntentValue = Extract<IntentField, { status: "available" }>["value"];
export const INTENT_VALUES = [
  "informational",
  "commercial",
  "transactional",
  "navigational",
] as const satisfies readonly IntentValue[];
const INTENT_VALUES_COMPLETE: Complete<
  IntentValue,
  (typeof INTENT_VALUES)[number]
> = true;
void INTENT_VALUES_COMPLETE;

export const GAP_KINDS = [
  "no_product_profile",
  "no_gsc",
  "no_outline",
  "llm_unavailable",
] as const satisfies readonly GapKind[];
const GAP_KINDS_COMPLETE: Complete<GapKind, (typeof GAP_KINDS)[number]> = true;
void GAP_KINDS_COMPLETE;

export const CONTENT_BRIEF_ERROR_CODES = [
  "invalid_request",
  "payload_too_large",
  "unsupported_media_type",
  "auth_required",
  "auth_unavailable",
  "gsc_auth_required",
  "property_not_granted",
  "rate_limited",
  "quota_unavailable",
  "scan_in_progress",
  "unsupported_market",
  "unsupported_language",
  "too_many_supporting_keywords",
  "brief_unavailable",
  "gsc_revoked",
  "gsc_temporarily_unavailable",
] as const satisfies readonly ContentBriefErrorCode[];
const ERROR_CODES_COMPLETE: Complete<
  ContentBriefErrorCode,
  (typeof CONTENT_BRIEF_ERROR_CODES)[number]
> = true;
void ERROR_CODES_COMPLETE;

export function isContentBriefErrorCode(
  code: string,
): code is ContentBriefErrorCode {
  return (CONTENT_BRIEF_ERROR_CODES as readonly string[]).includes(code);
}

type CrawlSkippedReason = CrawlSkipped["reason"];
export const CRAWL_SKIPPED_REASONS = [
  "same_host",
  "no_url",
] as const satisfies readonly CrawlSkippedReason[];
const CRAWL_SKIPPED_COMPLETE: Complete<
  CrawlSkippedReason,
  (typeof CRAWL_SKIPPED_REASONS)[number]
> = true;
void CRAWL_SKIPPED_COMPLETE;

type CrawlFailureReason = CrawlFailure["reason"];
export const CRAWL_FAILURE_REASONS = [
  "timeout",
  "provider_error",
  "validation_failed",
] as const satisfies readonly CrawlFailureReason[];
const CRAWL_FAILURE_COMPLETE: Complete<
  CrawlFailureReason,
  (typeof CRAWL_FAILURE_REASONS)[number]
> = true;
void CRAWL_FAILURE_COMPLETE;

type PrimaryCoverageReason = Extract<
  Extract<GscReadMeta, { status: "complete" | "partial" }>["primary_coverage"],
  { ratio: null }
>["reason"];
export const PRIMARY_COVERAGE_REASONS = [
  "no_query_impressions",
  "split_exceeds_total",
  "query_not_in_sample",
] as const satisfies readonly PrimaryCoverageReason[];
const PRIMARY_COVERAGE_COMPLETE: Complete<
  PrimaryCoverageReason,
  (typeof PRIMARY_COVERAGE_REASONS)[number]
> = true;
void PRIMARY_COVERAGE_COMPLETE;

/**
 * Verdict copy is keyed `verdict.<action>.<reason>`; the pairs are listed
 * here so the messages test can walk every legal combination rather than the
 * cross product (which would demand copy for `update.not_observed`).
 */
type VerdictKey = `${Verdict["action"]}.${Verdict["reason"]}`;
type LegalVerdictKey = Verdict extends infer V
  ? V extends { action: infer A extends string; reason: infer R extends string }
    ? `${A}.${R}`
    : never
  : never;
export const VERDICT_KEYS = [
  "undecidable.no_gsc_property",
  "undecidable.gsc_unavailable",
  "undecidable.gsc_partial",
  "undecidable.gsc_inconsistent",
  "undecidable.position_unavailable",
  "create.not_observed",
  "create.below_impression_floor",
  "create.beyond_position_cap",
  "update.self_compete",
] as const satisfies readonly LegalVerdictKey[];
const VERDICT_KEYS_COMPLETE: Complete<
  LegalVerdictKey,
  (typeof VERDICT_KEYS)[number]
> = true;
void VERDICT_KEYS_COMPLETE;
// The cross product is wider than the legal set; this only documents that the
// listed keys are all drawn from it.
const VERDICT_KEYS_ARE_PAIRS: (typeof VERDICT_KEYS)[number] extends VerdictKey
  ? true
  : never = true;
void VERDICT_KEYS_ARE_PAIRS;

export const ORIGINS = [
  "gsc",
  "dataforseo_serp",
  "crawl",
  "product_profile",
  "user_input",
] as const satisfies readonly Origin[];
const ORIGINS_COMPLETE: Complete<Origin, (typeof ORIGINS)[number]> = true;
void ORIGINS_COMPLETE;

type FormatValue = Extract<FormatField, { status: "available" }>["values"][number];
/** The formats a distribution is keyed by: every SerpFormat except `unknown`. */
export const CLASSIFIED_FORMATS = SERP_FORMATS.filter(
  (format): format is FormatValue => format !== "unknown",
);
