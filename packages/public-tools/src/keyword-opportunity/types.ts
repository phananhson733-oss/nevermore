// @input  -- none; the frozen result contract for the Keyword Opportunity Map
// @output -- shapes every stage of the pipeline reads and writes
// @pos    -- the evidence contract: each field says what was observed, never what is true
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { PublicToolResultEnvelope } from "../contract.ts";

export const KEYWORD_OPPORTUNITY_SCHEMA_VERSION = "keyword_opportunity_map.v3";

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

/** Intent returned by the keyword-data provider, never inferred locally. */
export type KeywordOpportunityProviderIntent =
  | "informational"
  | "navigational"
  | "commercial"
  | "transactional";

/** A separately-provenanced interpretation of the sampled organic SERP. */
export type KeywordOpportunitySerpIntent =
  | KeywordOpportunityProviderIntent
  | "mixed";

export interface KeywordOpportunitySerpIntentEvidence {
  readonly intent: KeywordOpportunitySerpIntent;
  readonly source: "serp_top_ten_interpretation";
  readonly observedAt: string;
  readonly modelId: string | null;
  readonly promptVersion: string | null;
}

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

export type KeywordOpportunitySerpStatus = "complete" | "unavailable";

export type KeywordOpportunitySerpFailureReason =
  | "provider_unavailable"
  | "provider_no_data"
  | "transport_outcome_unknown"
  /**
   * The run's time budget ended before this term was ever sent.
   *
   * Distinct from `provider_unavailable`, which claims the provider was asked
   * and could not answer. Nobody asked. Reporting this one as a provider
   * failure points the reader at the provider's status page for a term the
   * run simply never reached, and it is the only one of these a plain re-run
   * is likely to resolve.
   */
  | "budget_exhausted";

/**
 * Bounded SERP failure categories safe to expose in a run summary.
 *
 * `unreported` exists only in the aggregate. It records that v3 evidence was
 * unavailable without a typed reason; it must never be copied back onto a row
 * as though a provider returned it.
 */
export type KeywordOpportunityProcessSerpFailureReason =
  | KeywordOpportunitySerpFailureReason
  | "unreported";

export interface KeywordOpportunityOrganicResult {
  readonly position: number;
  readonly domain: string;
  readonly url: string | null;
  readonly title: string | null;
}

/**
 * What positive Search Console evidence, L2 page text, and the bounded sitemap
 * inventory say about the site already serving this query.
 *
 * `not_observed_in_gsc_query_sample` is deliberately long: Search Console
 * anonymises a large share of queries, so absence from the sample is not
 * evidence of absence from the index.
 *
 * `gsc_query_sample_not_read` is the state that separates that from the case
 * where nobody looked — the read failed, or the visitor's grant covers no
 * property for this site. The first live run shipped without it and reported
 * "not observed in the sample" on every row of a run whose sample was never
 * fetched, which is the same quiet dishonesty the withheld reasons below are
 * split to avoid: a reader acts on the first and re-runs on the second.
 *
 * The inventory states are additive. They never turn a sitemap miss into
 * site-wide absence: even a complete value describes only the bounded sitemap
 * documents this run was able and willing to read.
 */
export type KeywordOpportunityCoverage =
  | "observed_exact_strong"
  | "observed_exact_weak"
  | "related_coverage_unverified"
  | "not_observed_in_gsc_query_sample"
  | "gsc_query_sample_not_read"
  /** A sitemap URL pathname lexically resembles the candidate. */
  | "possible_existing_page"
  /** No lexical match appeared in the complete bounded sitemap inventory. */
  | "not_observed_in_bounded_inventory"
  /** No sitemap inventory was fetched or carried into this run. */
  | "inventory_unavailable"
  /** The available inventory has a known omission or malformed URL. */
  | "inventory_truncated";

/** A check the reader should run before acting on a row. Never a verdict. */
export type KeywordOpportunityCheck =
  | "read_page_one_intent"
  | "confirm_result_page_type"
  | "verify_weak_site_breakthrough"
  | "check_existing_page_overlap"
  | "judge_commercial_fit"
  | "decide_whether_to_bet_early";

export type KeywordOpportunitySignal =
  | "young_domain"
  | "low_organic_traffic_domain"
  | "community_result";

export type KeywordOpportunitySignalState =
  | "observed"
  | "not_observed"
  | "unavailable";

/**
 * A signal is positive, negative, or unknown; unknown is never represented as
 * `false`. The discriminant prevents an unavailable provider read from
 * carrying a fabricated negative observation.
 */
export type KeywordOpportunitySignalEvidence<Observation> =
  | {
      readonly state: "observed";
      readonly observation: Observation;
    }
  | {
      readonly state: "not_observed";
      readonly observation: null;
    }
  | {
      readonly state: "unavailable";
      readonly observation: null;
      readonly reason: string;
    };

export interface KeywordOpportunityYoungDomainObservation {
  readonly domain: string;
  readonly registrationDate: string;
  readonly observedAt: string;
  readonly ageMonths: number;
}

export interface KeywordOpportunityLowOrganicTrafficObservation {
  readonly domain: string;
  readonly organicEtv: number;
  readonly threshold: number;
  readonly marketCode: string;
  readonly languageCode: string;
  readonly observedAt: string;
}

export type KeywordOpportunityCommunitySource =
  | "provider_item_type"
  | "domain_fallback";

export interface KeywordOpportunityCommunityObservation {
  readonly domain: string;
  readonly url: string;
  readonly position: number;
  readonly source: KeywordOpportunityCommunitySource;
}

export interface KeywordOpportunitySignals {
  readonly youngDomain: KeywordOpportunitySignalEvidence<KeywordOpportunityYoungDomainObservation>;
  readonly lowOrganicTrafficDomain: KeywordOpportunitySignalEvidence<KeywordOpportunityLowOrganicTrafficObservation>;
  readonly communityResult: KeywordOpportunitySignalEvidence<KeywordOpportunityCommunityObservation>;
}

export type KeywordOpportunityDisposition =
  | "eligible"
  | "excluded"
  | "incomplete";

export type KeywordOpportunityDecisionBasis =
  | "positive_signal_observed"
  | "volume_priced_at_zero"
  | "existing_page_observed"
  | "all_signals_not_observed"
  | "serp_evidence_unavailable"
  | "signal_evidence_unavailable";

export type KeywordOpportunityDecisionDiscount = "ai_overview_answer_discount";

export type KeywordOpportunityIncompleteReason =
  | "serp_evidence_unavailable"
  | "young_domain_signal_unavailable"
  | "low_organic_traffic_signal_unavailable"
  | "community_result_signal_unavailable";

export type KeywordOpportunitySignalDecision =
  | {
      readonly disposition: "eligible";
      readonly basis: "positive_signal_observed";
      readonly positiveSignals: readonly KeywordOpportunitySignal[];
      readonly incompleteReason: null;
    }
  | {
      readonly disposition: "excluded";
      readonly basis: "all_signals_not_observed";
      readonly positiveSignals: readonly [];
      readonly incompleteReason: null;
    }
  | {
      readonly disposition: "incomplete";
      readonly basis: "signal_evidence_unavailable";
      readonly positiveSignals: readonly KeywordOpportunitySignal[];
      readonly incompleteReason: KeywordOpportunityIncompleteReason;
    };

export interface KeywordOpportunityDecision {
  readonly disposition: KeywordOpportunityDisposition;
  readonly basis: KeywordOpportunityDecisionBasis;
  readonly positiveSignals: readonly KeywordOpportunitySignal[];
  readonly discounts: readonly KeywordOpportunityDecisionDiscount[];
}

export type KeywordOpportunityAiOverviewAvailability =
  | "observed"
  | "not_observed"
  | "unavailable";

export type KeywordOpportunityAiOverviewAssessment =
  | "complete"
  | "partial"
  | "not_answered"
  | "unavailable";

/** Public AI Overview metadata; raw provider answer text is intentionally absent. */
export interface KeywordOpportunityAiOverviewEvidence {
  readonly availability: KeywordOpportunityAiOverviewAvailability;
  readonly loadedAsync: boolean | null;
  readonly answerAssessment: KeywordOpportunityAiOverviewAssessment;
  readonly reason: string | null;
  readonly modelId: string | null;
  readonly promptVersion: string | null;
}

/**
 * Server-side AI Overview observation used while interpreting and deciding.
 *
 * The bounded provider markdown is prompt input and discount evidence, not a
 * public result field. Report projection must explicitly narrow this shape to
 * `KeywordOpportunityAiOverviewEvidence` before an envelope crosses the
 * public-tool boundary.
 */
export interface KeywordOpportunityAiOverviewObservation extends KeywordOpportunityAiOverviewEvidence {
  readonly markdown: string | null;
}

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
  /**
   * The provider priced the term and the answer was zero.
   *
   * Split from `volume_not_returned` for the same reason the volume states
   * themselves are split: a term nobody searches is finished, and a term the
   * provider has never heard of is still open. The aggregate funnel kept the
   * two apart while this list, which is where a reader decides about one
   * specific term, folded them into "no measured demand".
   */
  | "volume_priced_at_zero"
  /** The provider returned nothing for the term. Not a measurement of zero. */
  | "volume_not_returned"
  | "already_covered"
  | "page_one_contested"
  /**
   * The page WAS opened but no domain on it resolved an authority rank.
   *
   * A provider gap, not a budget miss — and the distinction pays for itself
   * at the re-run button: a term the budget never reached is worth a seeded
   * re-run, while re-running this one spends another sample to hit the same
   * gap. Before this member existed both cases said "budget", which is
   * exactly the quiet dishonesty this union documents itself against.
   */
  | "page_one_ranks_unresolved"
  /** The run's sample budget ran out before reaching this term. */
  | "serp_sample_budget_exhausted"
  /**
   * The sampling stage itself did not run.
   *
   * Distinct from the budget above for the reason this whole union is split:
   * a term the budget never reached is worth a narrower re-run, while a stage
   * that failed is worth retrying unchanged. Both used to say "budget".
   */
  | "serp_sample_unavailable"
  /** GEO lane only: nothing on the crawled site answers the question. */
  | "no_supporting_page"
  /** All three decision signals completed and each was negative. */
  | "all_signals_not_observed";

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
 *
 * `as const satisfies readonly Union[]` on each list proves every ENTRY is a
 * member. It does not prove the list is COMPLETE — a union member nobody added
 * here type-checks fine and silently shrinks every test that iterates the
 * list. `AssertComplete` below closes that direction.
 */

/**
 * Fails to compile when `Values` misses a member of `Union`.
 *
 * `Exclude` leaves exactly the members that are not in the list; when that is
 * empty the conditional resolves to `true` and the assignment holds. When it
 * is not, the type is the missing member itself and `true` is not assignable
 * to it — so the error names what was forgotten.
 */
type AssertComplete<Union extends string, Values extends readonly string[]> =
  Exclude<Union, Values[number]> extends never
    ? true
    : Exclude<Union, Values[number]>;

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

export const KEYWORD_OPPORTUNITY_SERP_FAILURE_REASONS = [
  "provider_unavailable",
  "provider_no_data",
  "transport_outcome_unknown",
  "budget_exhausted",
] as const satisfies readonly KeywordOpportunitySerpFailureReason[];

export const KEYWORD_OPPORTUNITY_PROCESS_SERP_FAILURE_REASONS = [
  ...KEYWORD_OPPORTUNITY_SERP_FAILURE_REASONS,
  "unreported",
] as const satisfies readonly KeywordOpportunityProcessSerpFailureReason[];

export const KEYWORD_OPPORTUNITY_COVERAGE_STATES = [
  "observed_exact_strong",
  "observed_exact_weak",
  "related_coverage_unverified",
  "not_observed_in_gsc_query_sample",
  "gsc_query_sample_not_read",
  "possible_existing_page",
  "not_observed_in_bounded_inventory",
  "inventory_unavailable",
  "inventory_truncated",
] as const satisfies readonly KeywordOpportunityCoverage[];

export const KEYWORD_OPPORTUNITY_SIGNALS = [
  "young_domain",
  "low_organic_traffic_domain",
  "community_result",
] as const satisfies readonly KeywordOpportunitySignal[];

export const KEYWORD_OPPORTUNITY_SIGNAL_STATES = [
  "observed",
  "not_observed",
  "unavailable",
] as const satisfies readonly KeywordOpportunitySignalState[];

export const KEYWORD_OPPORTUNITY_SUPPORTING_PAGE_SOURCES = [
  "gsc_observed_query_page",
  "lexical_page_match",
  "inventory_url_match",
  "llm_proposition_source",
] as const satisfies readonly KeywordOpportunitySupportingPageSource[];

export const KEYWORD_OPPORTUNITY_DISPOSITIONS = [
  "eligible",
  "excluded",
  "incomplete",
] as const satisfies readonly KeywordOpportunityDisposition[];

export const KEYWORD_OPPORTUNITY_INCOMPLETE_REASONS = [
  "serp_evidence_unavailable",
  "young_domain_signal_unavailable",
  "low_organic_traffic_signal_unavailable",
  "community_result_signal_unavailable",
] as const satisfies readonly KeywordOpportunityIncompleteReason[];

export const KEYWORD_OPPORTUNITY_WITHHELD_REASONS = [
  "volume_priced_at_zero",
  "volume_not_returned",
  "already_covered",
  "page_one_contested",
  "page_one_ranks_unresolved",
  "serp_sample_budget_exhausted",
  "serp_sample_unavailable",
  "no_supporting_page",
  "all_signals_not_observed",
] as const satisfies readonly KeywordOpportunityWithheldReason[];

export const KEYWORD_OPPORTUNITY_AVAILABILITY_STATES = [
  "available",
  "partial",
  "insufficient_evidence",
  "unavailable",
] as const satisfies readonly KeywordOpportunityAvailability[];

/**
 * Compile-time proof that each list above covers its whole union.
 *
 * Add a union member without adding it here and this file stops compiling,
 * naming the member you forgot. Without it, the omission is invisible: every
 * test that iterates a list keeps passing, having silently stopped covering
 * the new case.
 */
const UNION_LISTS_ARE_COMPLETE: readonly [
  AssertComplete<KeywordOpportunityBasis, typeof KEYWORD_OPPORTUNITY_BASES>,
  AssertComplete<KeywordOpportunityLane, typeof KEYWORD_OPPORTUNITY_LANES>,
  AssertComplete<
    KeywordOpportunityVolumeAvailability,
    typeof KEYWORD_OPPORTUNITY_VOLUME_STATES
  >,
  AssertComplete<
    KeywordOpportunityWinnability,
    typeof KEYWORD_OPPORTUNITY_WINNABILITY_STATES
  >,
  AssertComplete<
    KeywordOpportunitySerpFailureReason,
    typeof KEYWORD_OPPORTUNITY_SERP_FAILURE_REASONS
  >,
  AssertComplete<
    KeywordOpportunityProcessSerpFailureReason,
    typeof KEYWORD_OPPORTUNITY_PROCESS_SERP_FAILURE_REASONS
  >,
  AssertComplete<
    KeywordOpportunityCoverage,
    typeof KEYWORD_OPPORTUNITY_COVERAGE_STATES
  >,
  AssertComplete<KeywordOpportunitySignal, typeof KEYWORD_OPPORTUNITY_SIGNALS>,
  AssertComplete<
    KeywordOpportunitySignalState,
    typeof KEYWORD_OPPORTUNITY_SIGNAL_STATES
  >,
  AssertComplete<
    KeywordOpportunitySupportingPageSource,
    typeof KEYWORD_OPPORTUNITY_SUPPORTING_PAGE_SOURCES
  >,
  AssertComplete<
    KeywordOpportunityDisposition,
    typeof KEYWORD_OPPORTUNITY_DISPOSITIONS
  >,
  AssertComplete<
    KeywordOpportunityIncompleteReason,
    typeof KEYWORD_OPPORTUNITY_INCOMPLETE_REASONS
  >,
  AssertComplete<
    KeywordOpportunityWithheldReason,
    typeof KEYWORD_OPPORTUNITY_WITHHELD_REASONS
  >,
  AssertComplete<
    KeywordOpportunityAvailability,
    typeof KEYWORD_OPPORTUNITY_AVAILABILITY_STATES
  >,
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];
void UNION_LISTS_ARE_COMPLETE;

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
export interface KeywordOpportunityContextSelection {
  readonly eligibleCandidates: number;
  readonly excludedCandidates: number;
  readonly attemptedCandidates: number;
  readonly truncatedCandidates: number;
}

export interface KeywordOpportunityContext {
  readonly siteUrl: string;
  readonly pagesFetched: number;
  readonly productPagesFetched: number;
  /** Optional only for results minted before the L2 selection contract. */
  readonly selection?: KeywordOpportunityContextSelection;
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
  /**
   * Explicit provider provenance. Optional only for old-bundle tolerance;
   * new report rows carry it independently from any SERP interpretation.
   */
  readonly providerIntent?: KeywordOpportunityProviderIntent | null;
  /** @deprecated Read `providerIntent`; retained for v1 callers. */
  readonly intent: string | null;
  readonly serpFeatures: readonly string[];
}

/** One sampled page one, reduced to the facts that decide winnability. */
export interface KeywordOpportunitySerpEvidence {
  /**
   * Optional only for signal-less legacy observations. When structured
   * signals are present, a missing status is fail-closed as incomplete, never
   * inferred as complete.
   */
  readonly status?: KeywordOpportunitySerpStatus;
  readonly failureReason?: KeywordOpportunitySerpFailureReason | null;
  readonly observedAt?: string | null;
  readonly organicResults?: readonly KeywordOpportunityOrganicResult[];
  readonly verdict: KeywordOpportunityWinnability;
  /** Lowest provider domain rank seen in the top ten; null when unsampled. */
  readonly weakestTopTenDomainRank: number | null;
  /**
   * The domain holding that weakest rank, and the position a reader sees it
   * at. The rank alone proved misleading in the 2026-08-14 live review: a
   * weak domain at position 10 and one at position 2 are different facts, and
   * without the identity the reader cannot open the page and check. Null
   * whenever the rank is null.
   */
  readonly weakestTopTenDomain: string | null;
  readonly weakestTopTenPosition: number | null;
  readonly topTenDomains: readonly string[];
  /**
   * Provider domain rank per entry of `topTenDomains`, in the same order.
   * `null` marks a domain the rank lookup did not resolve — never 0, which
   * the provider reserves for its own "no backlink data" conflation.
   */
  readonly topTenDomainRanks: readonly (number | null)[];
  /**
   * SERP element types the provider observed on the sampled page, e.g.
   * `ai_overview`. `null` means the provider reported none or the page was
   * never sampled — a reader must not read absence as "no AI Overview".
   */
  readonly pageOneItemTypes: readonly string[] | null;
  /**
   * True when the verdict came from a fallback model rather than a sampled
   * page one. Surfaces must label estimates; they may not present them as
   * observed.
   */
  readonly isEstimate: boolean;
}

/** The evidence source that identified a page related to one candidate. */
export type KeywordOpportunitySupportingPageSource =
  | "gsc_observed_query_page"
  | "lexical_page_match"
  | "inventory_url_match"
  | "llm_proposition_source";

/**
 * A page reference with its provenance kept explicit.
 *
 * `llm_proposition_source` records where the proposition came from. It is not
 * measured coverage and must never be renamed to an observed source.
 */
export type KeywordOpportunitySupportingPage =
  | {
      readonly availability: "available";
      readonly source: KeywordOpportunitySupportingPageSource;
      readonly url: string;
    }
  | {
      readonly availability: "unavailable";
      readonly source: null;
      readonly url: null;
    };

export interface KeywordOpportunityRow {
  readonly keyword: string;
  readonly lane: KeywordOpportunityLane;
  readonly discoveryBasis: KeywordOpportunityBasis;
  readonly questionForm: boolean;
  /** Index into the run's propositions; null for expansion candidates. */
  readonly propositionIndex: number | null;
  readonly validation: KeywordOpportunityValidation;
  readonly serp: KeywordOpportunitySerpEvidence;
  readonly serpIntent?: KeywordOpportunitySerpIntentEvidence | null;
  readonly signals?: KeywordOpportunitySignals;
  readonly aiOverview?: KeywordOpportunityAiOverviewEvidence | null;
  readonly decision?: KeywordOpportunityDecision;
  readonly coverage: KeywordOpportunityCoverage;
  /** Optional only while a cached v2 row is still being read. */
  readonly supportingPage?: KeywordOpportunitySupportingPage;
  /** @deprecated Read `supportingPage`; retained for current UI compatibility. */
  readonly supportingPageUrl: string | null;
  readonly nextChecks: readonly KeywordOpportunityCheck[];
  readonly clusterId: string | null;
}

/** A row emitted by the v3 producer. */
export interface KeywordOpportunityRowV3 extends KeywordOpportunityRow {
  readonly supportingPage: KeywordOpportunitySupportingPage;
}

/** A candidate that was dropped, kept visible so the funnel stays honest. */
export interface KeywordOpportunityWithheld {
  readonly keyword: string;
  readonly discoveryBasis: KeywordOpportunityBasis;
  readonly reason: KeywordOpportunityWithheldReason;
  readonly decision?: KeywordOpportunityDecision;
}

/** A v3 candidate whose required decision evidence did not complete. */
export interface KeywordOpportunityIncomplete {
  readonly keyword: string;
  readonly lane: KeywordOpportunityLane;
  readonly discoveryBasis: KeywordOpportunityBasis;
  readonly validation: KeywordOpportunityValidation;
  readonly coverage: KeywordOpportunityCoverage;
  readonly serp: KeywordOpportunitySerpEvidence;
  readonly serpIntent: KeywordOpportunitySerpIntentEvidence | null;
  readonly signals: KeywordOpportunitySignals;
  readonly aiOverview: KeywordOpportunityAiOverviewEvidence | null;
  readonly reason: KeywordOpportunityIncompleteReason;
  readonly decision: KeywordOpportunityDecision;
  /** Optional only while a cached v2 incomplete row is still being read. */
  readonly supportingPage?: KeywordOpportunitySupportingPage;
  /** @deprecated Read `supportingPage`; retained for v2 deployment skew. */
  readonly supportingPageUrl?: string | null;
}

/** An incomplete row emitted by the v3 producer. */
export interface KeywordOpportunityIncompleteV3
  extends KeywordOpportunityIncomplete {
  readonly supportingPage: KeywordOpportunitySupportingPage;
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
/**
 * The stage name the Search Console read reports itself under.
 *
 * Named here rather than spelled at each site because two modules have to
 * agree on it: the handler writes it into `unavailableStages`, and the report
 * reads it to decide whether the covered count means anything.
 */
export const KEYWORD_STAGE_GSC_COVERAGE = "gsc_coverage";

/** A successful GSC coverage read whose bounded paging omitted later rows. */
export const KEYWORD_STAGE_GSC_COVERAGE_TRUNCATED = "gsc_coverage_truncated";

/** Paging facts for one bounded Search Console coverage read. */
export interface KeywordCoveragePaging {
  readonly pagesFetched: number;
  readonly truncated: boolean;
}

/** Both positive-evidence reads for one identical finalised GSC window. */
export interface KeywordCoverageRead {
  readonly queryRows: readonly {
    readonly query: string;
    readonly impressions: number;
    readonly position: number;
  }[];
  readonly queryPageRows: readonly {
    readonly query: string;
    readonly page: string;
    readonly impressions: number;
    readonly position: number;
  }[];
  readonly queryPaging: KeywordCoveragePaging;
  readonly queryPagePaging: KeywordCoveragePaging;
}

/** The stage name page-one sampling reports itself under when it fails. */
export const KEYWORD_STAGE_SERP_SAMPLE = "serp_sample";

/** Some planned page-one reads completed while others remained unavailable. */
export const KEYWORD_STAGE_SERP_SAMPLE_PARTIAL = "serp_sample_partial";

export interface KeywordOpportunityFunnel {
  readonly generated: number;
  readonly deduplicated: number;
  readonly providerReturned: number;
  readonly volumePositive: number;
  readonly explicitZero: number;
  readonly providerNoData: number;
  /**
   * Candidates the site was measured to already serve.
   *
   * Null — not zero — when the Search Console sample was never read. A funnel
   * is read as a pipeline and each number as a count of things that happened,
   * so a zero here says "none of your candidates are covered" about a question
   * nobody asked. The rest of the payload carries the same fact twice
   * (`unavailableStages` and every row's coverage state); a number that
   * contradicts them in the one place readers skim is worse than an absence.
   */
  readonly alreadyCovered: number | null;
  readonly serpSampled: number;
  readonly winnableEvidence: number;
  readonly shown: number;
}

/** Versioned local policy whose provisional thresholds produced this run. */
export const KEYWORD_OPPORTUNITY_THRESHOLD_POLICY_VERSION =
  "keyword_opportunity_thresholds.v1";

export type KeywordOpportunityThresholdPolicyVersion =
  typeof KEYWORD_OPPORTUNITY_THRESHOLD_POLICY_VERSION;

/** Requesting-site rank band used to select the organic-traffic threshold. */
export type KeywordOpportunitySiteRankTier =
  | "rank_1_200"
  | "rank_201_500"
  | "rank_501_1000";

/**
 * Threshold facts supplied by the producer.
 *
 * Null means the caller did not measure or could not select that fact. A
 * report builder must not substitute the current code constant for a missing
 * run-time observation because cached results can outlive policy changes.
 */
export interface KeywordOpportunityProcessThresholds {
  readonly policyVersion: KeywordOpportunityThresholdPolicyVersion | null;
  readonly youngDomainMonths: number | null;
  readonly siteDomainRank: number | null;
  readonly siteRankTier: KeywordOpportunitySiteRankTier | null;
  readonly lowOrganicTrafficThreshold: number | null;
}

/** Milliseconds measured at real pipeline boundaries; null means not measured. */
export interface KeywordOpportunityProcessDurationsMs {
  readonly total: number | null;
  readonly validation: number | null;
  readonly coverage: number | null;
  readonly serpSampling: number | null;
  readonly serpInterpretation: number | null;
  readonly domainEnrichment: number | null;
  readonly report: number | null;
}

/** Caller-owned counts that cannot be reconstructed from projected rows. */
export interface KeywordOpportunityProcessInput {
  readonly validation?: {
    readonly requested: number;
  };
  readonly serp?: {
    readonly planned: number;
    readonly dispatched: number;
  };
  readonly thresholds?: KeywordOpportunityProcessThresholds;
  readonly durationsMs?: KeywordOpportunityProcessDurationsMs;
}

export interface KeywordOpportunityProcessValidation {
  /** Null when the producer did not report a valid requested count. */
  readonly requested: number | null;
  readonly available: number;
  readonly explicitZero: number;
  readonly providerNoData: number;
  readonly accounted: boolean;
}

export interface KeywordOpportunityProcessSerp {
  /** Null when the producer did not report a valid plan count. */
  readonly planned: number | null;
  /** Null when the producer did not report a valid dispatch count. */
  readonly dispatched: number | null;
  readonly completed: number;
  readonly failed: number;
  /** Legacy observations that never carried a transport status. Not failures. */
  readonly legacyStatusUnreported: number;
  readonly failureReasons: Readonly<
    Record<KeywordOpportunityProcessSerpFailureReason, number>
  >;
  readonly accounted: boolean;
}

export interface KeywordOpportunityProcessDecisions {
  readonly eligible: number;
  readonly withheld: number;
  readonly incomplete: number;
  /** Eligible rows with at least one positive and one unavailable signal. */
  readonly positiveWithUnavailableSignals: number;
  readonly withheldReasons: Readonly<
    Record<KeywordOpportunityWithheldReason, number>
  >;
  readonly incompleteReasons: Readonly<
    Record<KeywordOpportunityIncompleteReason, number>
  >;
  readonly accounted: boolean;
}

export interface KeywordOpportunityProcessSupportingPages {
  readonly sources: Readonly<
    Record<KeywordOpportunitySupportingPageSource, number>
  >;
  /** A valid legacy URL was present but no structured source travelled with it. */
  readonly sourceUnreported: number;
  /** No usable supporting-page reference was available. */
  readonly unavailable: number;
  readonly accounted: boolean;
}

/** One privacy-safe aggregate; no keyword, URL, domain, or provider text. */
export interface KeywordOpportunityProcessSignalStateCount {
  readonly youngDomain: KeywordOpportunitySignalState;
  readonly lowOrganicTrafficDomain: KeywordOpportunitySignalState;
  readonly communityResult: KeywordOpportunitySignalState;
  readonly count: number;
}

/** Complete public reconciliation for one v3 run. */
export interface KeywordOpportunityProcess {
  readonly validation: KeywordOpportunityProcessValidation;
  readonly serp: KeywordOpportunityProcessSerp;
  readonly decisions: KeywordOpportunityProcessDecisions;
  readonly supportingPages: KeywordOpportunityProcessSupportingPages;
  readonly signalStates: readonly KeywordOpportunityProcessSignalStateCount[];
  /** Observations from a v2 producer that carried no structured signals. */
  readonly legacyWithoutSignals: number;
  readonly thresholds: KeywordOpportunityProcessThresholds;
  readonly durationsMs: KeywordOpportunityProcessDurationsMs;
}

export interface KeywordOpportunityResult {
  readonly availability: KeywordOpportunityAvailability;
  readonly marketCode: string;
  readonly languageCode: string;
  readonly context: KeywordOpportunityContext;
  readonly rows: readonly KeywordOpportunityRow[];
  readonly withheld: readonly KeywordOpportunityWithheld[];
  /** Optional only so an older cached v2 bundle remains readable. */
  readonly incomplete?: readonly KeywordOpportunityIncomplete[];
  readonly clusters: readonly KeywordOpportunityCluster[];
  readonly funnel: KeywordOpportunityFunnel;
  /** Run-scoped ledger that reconciles the whole candidate set. */
  readonly process?: KeywordOpportunityProcess;
  /**
   * Which parts of the run could not be completed, by name.
   *
   * A lane that failed is reported here and its rows are absent; the run still
   * returns 200 so the other lane's honest answer reaches the reader.
   */
  readonly unavailableStages: readonly string[];
  readonly nextStepSuggestions: readonly string[];
}

/**
 * The v3 producer result; structured provenance and reconciliation are
 * required even when thresholds or durations were not measured.
 */
export type KeywordOpportunityResultV3 = Omit<
  KeywordOpportunityResult,
  "rows" | "incomplete" | "process"
> & {
  readonly rows: readonly KeywordOpportunityRowV3[];
  readonly incomplete: readonly KeywordOpportunityIncompleteV3[];
  readonly process: KeywordOpportunityProcess;
};

/** @deprecated The current producer emits `KeywordOpportunityResultV3`. */
export type KeywordOpportunityResultV2 = KeywordOpportunityResult & {
  readonly incomplete: readonly KeywordOpportunityIncomplete[];
};

export type KeywordOpportunityEnvelope = PublicToolResultEnvelope<
  KeywordOpportunityResultV3,
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
  | "invalid_url"
  | "payload_too_large"
  | "unsupported_media_type"
  | "authentication_required"
  | "property_not_verified"
  | "rate_limited"
  | "context_token_invalid"
  | "keyword_generation_unavailable"
  | "keyword_source_unavailable"
  | "site_unreachable"
  | "bot_protection_blocked"
  | "rate_limited_by_target"
  | "protocol_downgrade_rejected"
  | "too_few_pages"
  /**
   * The four admission-gate codes and the two grant codes below used to be
   * missing from this union even though both gates emit them on every refusal
   * path. The surface maps unknown codes to a generic "something went wrong on
   * our side", so a visitor whose Google authorization had lapsed
   * (`gsc_revoked`, a 401) was told the tool was broken — with no way back to
   * the consent screen, because the reconnect link only rendered for
   * `authentication_required`. Every code an endpoint can answer with belongs
   * here, which is what the comment above has promised all along.
   */
  | "scan_in_progress"
  | "target_busy"
  | "quota_unavailable"
  | "gsc_revoked"
  | "gsc_temporarily_unavailable"
  | "keyword_run_unavailable"
  | "keyword_run_cancelled";

export const KEYWORD_OPPORTUNITY_ERROR_CODES = [
  "invalid_input",
  "invalid_request",
  "invalid_url",
  "payload_too_large",
  "unsupported_media_type",
  "authentication_required",
  "property_not_verified",
  "rate_limited",
  "context_token_invalid",
  "keyword_generation_unavailable",
  "keyword_source_unavailable",
  "site_unreachable",
  "bot_protection_blocked",
  "rate_limited_by_target",
  "protocol_downgrade_rejected",
  "too_few_pages",
  "scan_in_progress",
  "target_busy",
  "quota_unavailable",
  "gsc_revoked",
  "gsc_temporarily_unavailable",
  "keyword_run_unavailable",
  "keyword_run_cancelled",
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
