// @input  -- the draft-side closed code unions of @sf/public-tools/content-brief/contract
// @output -- the same unions as complete runtime arrays, so copy tables and
//            client allow-lists can walk every member
// @pos    -- the one place the draft's closed codes exist as values; the
//            messages test and the tool's error allow-list both read from here

import type {
  ClaimState,
  ContentDraftErrorCode,
  CoverageItem,
  DraftResult,
  SectionFailReason,
  VerifyItem,
} from "@sf/public-tools/content-brief/contract";

export { RUN_MODES, UNAVAILABLE_REASONS } from "./content-brief-codes";

/**
 * Same device as content-brief-codes.ts: `satisfies` proves membership, the
 * `Complete<...>` assertion proves nothing is missing, and the failure names
 * the member the array forgot.
 */
type Complete<Union extends string, Listed extends string> = [
  Exclude<Union, Listed>,
] extends [never]
  ? true
  : Exclude<Union, Listed>;

export const CONTENT_DRAFT_ERROR_CODES = [
  "invalid_request",
  "payload_too_large",
  "unsupported_media_type",
  "auth_required",
  "auth_unavailable",
  "rate_limited",
  "quota_unavailable",
  "run_in_progress",
  "brief_schema_mismatch",
  "brief_fingerprint_mismatch",
  "brief_reference_invalid",
  "question_needs_review",
  "section_not_writable",
  "previous_draft_invalid",
  "draft_unavailable",
] as const satisfies readonly ContentDraftErrorCode[];
const ERROR_CODES_COMPLETE: Complete<
  ContentDraftErrorCode,
  (typeof CONTENT_DRAFT_ERROR_CODES)[number]
> = true;
void ERROR_CODES_COMPLETE;

/** The refusals that carry a Retry-After header the page can print. */
export const RETRY_AFTER_ERROR_CODES = [
  "run_in_progress",
  "rate_limited",
] as const satisfies readonly ContentDraftErrorCode[];

export function isContentDraftErrorCode(
  code: string,
): code is ContentDraftErrorCode {
  return (CONTENT_DRAFT_ERROR_CODES as readonly string[]).includes(code);
}

export const SECTION_FAIL_REASONS = [
  "timeout",
  "provider_error",
  "not_configured",
  "validation_failed",
] as const satisfies readonly SectionFailReason[];
const SECTION_FAIL_COMPLETE: Complete<
  SectionFailReason,
  (typeof SECTION_FAIL_REASONS)[number]
> = true;
void SECTION_FAIL_COMPLETE;

type CoverageCause = NonNullable<CoverageItem["cause"]>;
export const COVERAGE_CAUSES = [
  "content",
  "section_failed",
  "section_skipped",
] as const satisfies readonly CoverageCause[];
const COVERAGE_CAUSES_COMPLETE: Complete<
  CoverageCause,
  (typeof COVERAGE_CAUSES)[number]
> = true;
void COVERAGE_CAUSES_COMPLETE;

type CoverageStatus = CoverageItem["status"];
export const COVERAGE_STATUSES = [
  "covered",
  "partial",
  "none",
] as const satisfies readonly CoverageStatus[];
const COVERAGE_STATUSES_COMPLETE: Complete<
  CoverageStatus,
  (typeof COVERAGE_STATUSES)[number]
> = true;
void COVERAGE_STATUSES_COMPLETE;

type VerifyKind = VerifyItem["kind"];
export const VERIFY_KINDS = [
  "single_source",
  "profile_only",
  "gap",
  "stance",
] as const satisfies readonly VerifyKind[];
const VERIFY_KINDS_COMPLETE: Complete<
  VerifyKind,
  (typeof VERIFY_KINDS)[number]
> = true;
void VERIFY_KINDS_COMPLETE;

export const CLAIM_STATES = [
  "bound",
  "gap",
  "no_claim",
  "stance",
] as const satisfies readonly ClaimState[];
const CLAIM_STATES_COMPLETE: Complete<
  ClaimState,
  (typeof CLAIM_STATES)[number]
> = true;
void CLAIM_STATES_COMPLETE;

type Tone = DraftResult["settings"]["tone"];
export const TONES = [
  "explanatory",
  "conversational",
  "technical",
] as const satisfies readonly Tone[];
const TONES_COMPLETE: Complete<Tone, (typeof TONES)[number]> = true;
void TONES_COMPLETE;

type Person = DraftResult["settings"]["person"];
export const PERSONS = ["second", "third"] as const satisfies readonly Person[];
const PERSONS_COMPLETE: Complete<Person, (typeof PERSONS)[number]> = true;
void PERSONS_COMPLETE;

type ProductMention = DraftResult["settings"]["product_mention"];
export const PRODUCT_MENTIONS = [
  "none",
  "gap_only",
  "throughout",
] as const satisfies readonly ProductMention[];
const PRODUCT_MENTIONS_COMPLETE: Complete<
  ProductMention,
  (typeof PRODUCT_MENTIONS)[number]
> = true;
void PRODUCT_MENTIONS_COMPLETE;
