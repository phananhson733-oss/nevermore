// @input  -- none; the frozen result contract for the Keyword Opportunity Map
// @output -- shapes every stage of the pipeline reads and writes
// @pos    -- the evidence contract: each field says what was observed, never what is true
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { PublicToolResultEnvelope } from "../contract.ts";

export const KEYWORD_OPPORTUNITY_SCHEMA_VERSION = "keyword_opportunity_map.v1";

/**
 * Where a candidate came from.
 *
 * The 2026-08-10 Tranche 2 spike measured these separately and they behave
 * nothing alike: `traditional_expansion` cleared the volume check 37% of the
 * time, `site_proposition` only 3.2%. Mixing them into one table buries the
 * few high-value proposition angles under a pile of category terms, so the
 * basis travels with every row and the surface has to group by it.
 */
export type KeywordOpportunityBasis =
  | "site_proposition"
  | "traditional_expansion";

/**
 * Which evidence chain a candidate is judged by.
 *
 * The SEO lane requires measured demand. The GEO lane cannot: question-form
 * phrasings cleared the volume check only 13.2% of the time, so gating them on
 * volume deletes the very output the GEO positioning is about. GEO rows carry
 * local evidence (question form plus the crawled page that answers it) and say
 * plainly that no demand data backs them.
 */
export type KeywordOpportunityLane = "seo" | "geo";

/**
 * Three distinct provider facts that must never collapse into each other.
 *
 * `provider_no_data` is the provider staying silent about a term. In Tranche 2
 * that was 74.9% of all candidates — treating it as zero demand would throw
 * away three quarters of the funnel while claiming the terms were measured.
 */
export type KeywordOpportunityVolumeAvailability =
  | "available"
  | "explicit_zero"
  | "provider_no_data";

/**
 * Whether page one shows a weak site has already broken through.
 *
 * A difficulty score models how hard a term looks; it does not say who holds
 * page one. Sampling the real SERP and resolving each domain's rank makes
 * `winnable_evidence` an observation. Without that sample the verdict is
 * `no_serp_evidence` and no surface may call the term winnable.
 */
export type KeywordOpportunityWinnability =
  | "winnable_evidence"
  | "contested_evidence"
  | "no_serp_evidence";

/**
 * What Search Console says about the site already serving this query.
 *
 * `not_observed_in_gsc_query_sample` is deliberately long: Search Console
 * anonymises a large share of queries, so absence from the sample is not
 * evidence of absence from the index.
 */
export type KeywordOpportunityCoverage =
  | "observed_exact_strong"
  | "observed_exact_weak"
  | "related_coverage_unverified"
  | "not_observed_in_gsc_query_sample";

/** A check the reader should run before acting on a row. Never a verdict. */
export type KeywordOpportunityCheck =
  | "read_page_one_intent"
  | "confirm_result_page_type"
  | "verify_weak_site_breakthrough"
  | "check_existing_page_overlap"
  | "judge_commercial_fit"
  | "decide_whether_to_bet_early";

/**
 * Why a candidate never reached the reader.
 *
 * Each member is a distinct observation, and mixing them up is the kind of
 * quiet dishonesty this contract exists to prevent: `page_one_contested` means
 * the sample ran and strong sites hold the page, while
 * `serp_sample_budget_exhausted` means nobody looked. Telling a reader the
 * first when the second happened invites a re-run that changes nothing.
 */
export type KeywordOpportunityWithheldReason =
  | "no_measured_demand"
  | "already_covered"
  | "page_one_contested"
  | "serp_sample_budget_exhausted"
  /** GEO lane only: nothing on the crawled site answers the question. */
  | "no_supporting_page";

export type KeywordOpportunityAvailability =
  | "available"
  | "partial"
  | "insufficient_evidence"
  | "unavailable";

/**
 * Every union, as a value.
 *
 * A union type cannot be iterated, so a surface that renders one label per
 * member breaks at runtime on whichever member nobody wrote copy for — and
 * only for the visitors whose data happens to produce it. These lists let a
 * copy-completeness test find the hole first.
 */
export const KEYWORD_OPPORTUNITY_BASES = [
  "site_proposition",
  "traditional_expansion",
] as const satisfies readonly KeywordOpportunityBasis[];

export const KEYWORD_OPPORTUNITY_LANES = [
  "seo",
  "geo",
] as const satisfies readonly KeywordOpportunityLane[];

export const KEYWORD_OPPORTUNITY_VOLUME_STATES = [
  "available",
  "explicit_zero",
  "provider_no_data",
] as const satisfies readonly KeywordOpportunityVolumeAvailability[];

export const KEYWORD_OPPORTUNITY_WINNABILITY_STATES = [
  "winnable_evidence",
  "contested_evidence",
  "no_serp_evidence",
] as const satisfies readonly KeywordOpportunityWinnability[];

export const KEYWORD_OPPORTUNITY_COVERAGE_STATES = [
  "observed_exact_strong",
  "observed_exact_weak",
  "related_coverage_unverified",
  "not_observed_in_gsc_query_sample",
] as const satisfies readonly KeywordOpportunityCoverage[];

export const KEYWORD_OPPORTUNITY_WITHHELD_REASONS = [
  "no_measured_demand",
  "already_covered",
  "page_one_contested",
  "serp_sample_budget_exhausted",
  "no_supporting_page",
] as const satisfies readonly KeywordOpportunityWithheldReason[];

export const KEYWORD_OPPORTUNITY_AVAILABILITY_STATES = [
  "available",
  "partial",
  "insufficient_evidence",
  "unavailable",
] as const satisfies readonly KeywordOpportunityAvailability[];

/** A selling point read off the site, with the crawled URL that shows it. */
export interface KeywordOpportunityProposition {
  readonly statement: string;
  /**
   * Must be a URL the crawler actually requested and the URL guard cleared.
   * Never a string the model lifted out of page text: rendering an unchecked
   * value into an anchor is a self-XSS vector.
   */
  readonly sourceUrl: string;
}

/** Everything read off the site before any keyword work happens. */
export interface KeywordOpportunityContext {
  readonly siteUrl: string;
  readonly pagesFetched: number;
  readonly productPagesFetched: number;
  readonly propositions: readonly KeywordOpportunityProposition[];
  /** False when the crawl returned too little to reason about positioning. */
  readonly contextSufficient: boolean;
  readonly stopReason: string;
}

/** The measured demand facts for one term, in one market. */
export interface KeywordOpportunityValidation {
  readonly availability: KeywordOpportunityVolumeAvailability;
  /** Null whenever availability is not `available`. Never 0 as a stand-in. */
  readonly volume: number | null;
  readonly difficulty: number | null;
  readonly intent: string | null;
  readonly serpFeatures: readonly string[];
}

/** One sampled page one, reduced to the fact that decides winnability. */
export interface KeywordOpportunitySerpEvidence {
  readonly verdict: KeywordOpportunityWinnability;
  /** Lowest provider domain rank seen in the top ten; null when unsampled. */
  readonly weakestTopTenDomainRank: number | null;
  readonly topTenDomains: readonly string[];
  /**
   * True when the verdict came from a fallback model rather than a sampled
   * page one. Surfaces must label estimates; they may not present them as
   * observed.
   */
  readonly isEstimate: boolean;
}

export interface KeywordOpportunityRow {
  readonly keyword: string;
  readonly lane: KeywordOpportunityLane;
  readonly discoveryBasis: KeywordOpportunityBasis;
  readonly questionForm: boolean;
  /** Index into the run's propositions; null for expansion candidates. */
  readonly propositionIndex: number | null;
  readonly validation: KeywordOpportunityValidation;
  readonly serp: KeywordOpportunitySerpEvidence;
  readonly coverage: KeywordOpportunityCoverage;
  /** The crawled page that already answers this, when one does. */
  readonly supportingPageUrl: string | null;
  readonly nextChecks: readonly KeywordOpportunityCheck[];
  readonly clusterId: string | null;
}

/** A candidate that was dropped, kept visible so the funnel stays honest. */
export interface KeywordOpportunityWithheld {
  readonly keyword: string;
  readonly discoveryBasis: KeywordOpportunityBasis;
  readonly reason: KeywordOpportunityWithheldReason;
}

/**
 * Terms that belong on one page.
 *
 * Grouping is lexical, so it is a suggestion. Proving two terms share a page
 * needs page-one overlap the tool does not fetch, which is why nothing here is
 * called a site structure.
 */
export interface KeywordOpportunityCluster {
  readonly id: string;
  readonly label: string;
  readonly keywords: readonly string[];
}

/**
 * Counted at every stage, with zero and no-data kept apart.
 *
 * The counts are the honesty mechanism: a run that shows two rows out of two
 * hundred candidates has to show where the other 198 went.
 */
export interface KeywordOpportunityFunnel {
  readonly generated: number;
  readonly deduplicated: number;
  readonly providerReturned: number;
  readonly volumePositive: number;
  readonly explicitZero: number;
  readonly providerNoData: number;
  readonly alreadyCovered: number;
  readonly serpSampled: number;
  readonly winnableEvidence: number;
  readonly shown: number;
}

export interface KeywordOpportunityResult {
  readonly availability: KeywordOpportunityAvailability;
  readonly marketCode: string;
  readonly languageCode: string;
  readonly context: KeywordOpportunityContext;
  readonly rows: readonly KeywordOpportunityRow[];
  readonly withheld: readonly KeywordOpportunityWithheld[];
  readonly clusters: readonly KeywordOpportunityCluster[];
  readonly funnel: KeywordOpportunityFunnel;
  /**
   * Which parts of the run could not be completed, by name.
   *
   * A lane that failed is reported here and its rows are absent; the run still
   * returns 200 so the other lane's honest answer reaches the reader.
   */
  readonly unavailableStages: readonly string[];
  readonly nextStepSuggestions: readonly string[];
}

export type KeywordOpportunityEnvelope = PublicToolResultEnvelope<
  KeywordOpportunityResult,
  "keyword_opportunity_map",
  "site"
>;

/**
 * Every code the two endpoints can emit.
 *
 * Exhaustive on purpose: a surface written as a switch over this union renders
 * an unknown state for anything missing, so a code that escapes the list is a
 * blank error message for a real visitor. The request-shape codes come from
 * the shared body reader and belong here even though this module never raises
 * them itself.
 */
export type KeywordOpportunityErrorCode =
  | "invalid_input"
  | "invalid_request"
  | "payload_too_large"
  | "unsupported_media_type"
  | "authentication_required"
  | "property_not_verified"
  | "rate_limited"
  | "context_token_invalid"
  | "keyword_source_unavailable"
  | "site_unreachable"
  | "bot_protection_blocked"
  | "rate_limited_by_target"
  | "protocol_downgrade_rejected"
  | "too_few_pages";

export const KEYWORD_OPPORTUNITY_ERROR_CODES = [
  "invalid_input",
  "invalid_request",
  "payload_too_large",
  "unsupported_media_type",
  "authentication_required",
  "property_not_verified",
  "rate_limited",
  "context_token_invalid",
  "keyword_source_unavailable",
  "site_unreachable",
  "bot_protection_blocked",
  "rate_limited_by_target",
  "protocol_downgrade_rejected",
  "too_few_pages",
] as const satisfies readonly KeywordOpportunityErrorCode[];

/**
 * Narrow an arbitrary thrown code to one the surface has copy for.
 *
 * The crawl layer's error codes travel as plain strings, so without this an
 * unrecognised one reaches the client and renders as a blank state. Anything
 * unknown becomes `site_unreachable`, which is the weakest true statement:
 * the run did not get the pages.
 */
export function toKeywordOpportunityErrorCode(
  code: unknown,
): KeywordOpportunityErrorCode {
  return (KEYWORD_OPPORTUNITY_ERROR_CODES as readonly string[]).includes(
    String(code),
  )
    ? (code as KeywordOpportunityErrorCode)
    : "site_unreachable";
}
