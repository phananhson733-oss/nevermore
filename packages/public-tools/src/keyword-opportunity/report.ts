// @input  -- the site context plus every per-candidate observation the pipeline gathered
// @output -- the finished result, its funnel, and an availability the surface must obey
// @pos    -- projects observations through the v3 decision contract into three result lists
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createPublicToolResult } from "../contract.ts";
import { clusterKeywords, keywordClusterIndex } from "./cluster.ts";
import { isKeywordAlreadyCovered } from "./coverage.ts";
import { keywordNextChecks } from "./next-checks.ts";
import {
  classifyKeywordOpportunitySignals,
  keywordOpportunityDecisionDiscounts,
} from "./signals.ts";
import {
  KEYWORD_OPPORTUNITY_INCOMPLETE_REASONS,
  KEYWORD_OPPORTUNITY_PROCESS_SERP_FAILURE_REASONS,
  KEYWORD_OPPORTUNITY_SCHEMA_VERSION,
  KEYWORD_OPPORTUNITY_SIGNAL_STATES,
  KEYWORD_OPPORTUNITY_SUPPORTING_PAGE_SOURCES,
  KEYWORD_OPPORTUNITY_WITHHELD_REASONS,
  KEYWORD_STAGE_GSC_COVERAGE,
  KEYWORD_STAGE_GSC_COVERAGE_TRUNCATED,
  KEYWORD_STAGE_SERP_SAMPLE,
} from "./types.ts";
import { isKeywordWinnable } from "./winnability.ts";
import type {
  KeywordOpportunityAiOverviewEvidence,
  KeywordOpportunityAiOverviewObservation,
  KeywordOpportunityAvailability,
  KeywordOpportunityBasis,
  KeywordOpportunityContext,
  KeywordOpportunityCoverage,
  KeywordOpportunityDecision,
  KeywordOpportunityDecisionSummary,
  KeywordOpportunityDurationSummary,
  KeywordOpportunityEnvelope,
  KeywordOpportunityFunnel,
  KeywordOpportunityIncompleteV3,
  KeywordOpportunityIncompleteReason,
  KeywordOpportunityLane,
  KeywordOpportunityProcess,
  KeywordOpportunityProcessDurationsMs,
  KeywordOpportunityProcessInput,
  KeywordOpportunityProcessSerpFailureReason,
  KeywordOpportunityProcessSignalStateCount,
  KeywordOpportunityProcessThresholds,
  KeywordOpportunityResultV3,
  KeywordOpportunityRowV3,
  KeywordOpportunitySerpIntentEvidence,
  KeywordOpportunitySerpEvidence,
  KeywordOpportunitySupportingPage,
  KeywordOpportunitySupportingPageSummary,
  KeywordOpportunitySignals,
  KeywordOpportunitySupportingPage,
  KeywordOpportunityValidation,
  KeywordOpportunityWithheld,
  KeywordOpportunityWithheldReason,
} from "./types.ts";

/**
 * Rows below which a run reports insufficient evidence instead of a list.
 *
 * Five. The Tranche 2 spike put eleven of fifteen sites over this line and the
 * four that missed were all developer-tooling businesses, so the threshold is
 * doing real work: for those categories the honest answer is that the public
 * data does not support a keyword plan, and padding the table to look
 * productive is exactly the failure the tool exists to avoid.
 */
export const KEYWORD_OPPORTUNITY_MIN_ROWS = 5;

/** One candidate with every observation the pipeline collected for it. */
export interface KeywordOpportunityObservation {
  readonly keyword: string;
  readonly lane: KeywordOpportunityLane;
  readonly discoveryBasis: KeywordOpportunityBasis;
  readonly questionForm: boolean;
  readonly propositionIndex: number | null;
  readonly validation: KeywordOpportunityValidation;
  readonly serp: KeywordOpportunitySerpEvidence;
  /** Present on v3 observations; absent only on the legacy signal-less path. */
  readonly serpIntent?: KeywordOpportunitySerpIntentEvidence | null;
  readonly signals?: KeywordOpportunitySignals;
  readonly aiOverview?: KeywordOpportunityAiOverviewObservation | null;
  readonly coverage: KeywordOpportunityCoverage;
  /** Optional only for a legacy observation admitted during deployment skew. */
  readonly supportingPage?: KeywordOpportunitySupportingPage;
  /** @deprecated A legacy observation may carry only this unproven URL. */
  readonly supportingPageUrl?: string | null;
}

/** The observation shape required from the v3 handler. */
export interface KeywordOpportunityObservationV3
  extends KeywordOpportunityObservation {
  readonly supportingPage: KeywordOpportunitySupportingPage;
}

/**
 * Cross the public result boundary by allow-listing fields. Do not replace
 * this projection with a spread: report input deliberately retains private
 * provider markdown for interpretation and discounting.
 */
function publicAiOverviewEvidence(
  observation: KeywordOpportunityAiOverviewObservation | null | undefined,
): KeywordOpportunityAiOverviewEvidence | null {
  if (observation === null || observation === undefined) return null;
  return {
    availability: observation.availability,
    loadedAsync: observation.loadedAsync,
    answerAssessment: observation.answerAssessment,
    reason: observation.reason,
    modelId: observation.modelId,
    promptVersion: observation.promptVersion,
  };
}

export interface KeywordOpportunityReportInput {
  readonly marketCode: string;
  readonly languageCode: string;
  readonly context: KeywordOpportunityContext;
  readonly generated: number;
  readonly observations: readonly KeywordOpportunityObservation[];
  /** Stage names that could not run, e.g. "serp_sample" or "gsc_coverage". */
  readonly unavailableStages: readonly string[];
  /** Caller-owned transport, threshold and timing facts for reconciliation. */
  readonly process?: KeywordOpportunityProcessInput;
  /**
   * When the run finished, supplied by the caller.
   *
   * The clock lives in `apps/*`: reading it here would make every test either
   * nondeterministic or forced to stub a global.
   */
  readonly completedAt: string;
}

function safeLegacySupportingPageUrl(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  if (!/^https?:\/\/[^/?#]+(?:[/?#]|$)/i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.host === "" ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * Decide whether an observation reaches the reader.
 *
 * The SEO lane needs measured demand and a page one that a weak site already
 * broke into. The GEO lane is judged on neither: gating question-form terms on
 * volume would delete 87% of them, so they qualify on having a crawled page
 * that answers them and are labelled as carrying no demand data.
 */
function isLegacyShown(observation: KeywordOpportunityObservation): boolean {
  if (isKeywordAlreadyCovered(observation.coverage)) return false;
  if (observation.lane === "geo") {
    return observation.supportingPage?.availability === "available" ||
      (observation.supportingPage === undefined &&
        safeLegacySupportingPageUrl(observation.supportingPageUrl) !== null);
  }
  return (
    observation.validation.availability === "available" &&
    isKeywordWinnable(observation.serp)
  );
}

function toSupportingPageUrl(
  supportingPage: KeywordOpportunitySupportingPage,
): string | null {
  return supportingPage.availability === "available"
    ? supportingPage.url
    : null;
}

function observationSupportingPage(
  observation: KeywordOpportunityObservation,
): KeywordOpportunitySupportingPage {
  return (
    observation.supportingPage ?? {
      availability: "unavailable",
      source: null,
      url: null,
    }
  );
}

function observationSupportingPageUrl(
  observation: KeywordOpportunityObservation,
): string | null {
  return observation.supportingPage === undefined
    ? safeLegacySupportingPageUrl(observation.supportingPageUrl)
    : toSupportingPageUrl(observation.supportingPage);
}

function hasObservedExistingPage(
  coverage: KeywordOpportunityCoverage,
): boolean {
  return isKeywordAlreadyCovered(coverage);
}

function supportingPageOrDefault(
  observation: KeywordOpportunityObservation,
): KeywordOpportunitySupportingPage {
  return observation.supportingPage ?? { state: "not_observed" };
}

type KeywordOpportunityClassification =
  | {
      readonly disposition: "eligible";
      readonly decision: KeywordOpportunityDecision | null;
    }
  | {
      readonly disposition: "excluded";
      readonly decision: KeywordOpportunityDecision | null;
      readonly reason: KeywordOpportunityWithheldReason;
    }
  | {
      readonly disposition: "incomplete";
      readonly decision: KeywordOpportunityDecision;
      readonly reason: KeywordOpportunityIncompleteReason;
      readonly signals: KeywordOpportunitySignals;
    };

/**
 * Classify v3 evidence while retaining a narrow legacy path for old bundles.
 * New producers always supply `signals`; their unknowns therefore reach the
 * incomplete section instead of inheriting the old binary shown/withheld gate.
 */
function classifyObservation(
  observation: KeywordOpportunityObservation,
  unavailableStages: readonly string[],
): KeywordOpportunityClassification {
  if (observation.signals === undefined) {
    return isLegacyShown(observation)
      ? { disposition: "eligible", decision: null }
      : {
          disposition: "excluded",
          decision: null,
          reason: withheldReason(observation, unavailableStages),
        };
  }

  const signalDecision = classifyKeywordOpportunitySignals(
    observation.signals,
  );
  const makeDecision = (
    disposition: KeywordOpportunityDecision["disposition"],
    basis: KeywordOpportunityDecision["basis"],
    positiveSignals = signalDecision.positiveSignals,
  ): KeywordOpportunityDecision => ({
    disposition,
    basis,
    positiveSignals,
    discounts: keywordOpportunityDecisionDiscounts(observation.aiOverview),
  });

  if (hasObservedExistingPage(observation.coverage)) {
    return {
      disposition: "excluded",
      decision: makeDecision("excluded", "existing_page_observed"),
      reason: "already_covered",
    };
  }

  if (observation.validation.availability === "explicit_zero") {
    return {
      disposition: "excluded",
      decision: makeDecision("excluded", "volume_priced_at_zero", []),
      reason: "volume_priced_at_zero",
    };
  }

  if (observation.serp.status !== "complete") {
    return {
      disposition: "incomplete",
      decision: makeDecision("incomplete", "serp_evidence_unavailable"),
      reason: "serp_evidence_unavailable",
      signals: observation.signals,
    };
  }

  if (signalDecision.disposition === "incomplete") {
    return {
      disposition: "incomplete",
      decision: makeDecision("incomplete", signalDecision.basis),
      reason: signalDecision.incompleteReason,
      signals: observation.signals,
    };
  }

  if (signalDecision.disposition === "excluded") {
    return {
      disposition: "excluded",
      decision: makeDecision("excluded", signalDecision.basis),
      reason: "all_signals_not_observed",
    };
  }

  return {
    disposition: "eligible",
    decision: makeDecision("eligible", signalDecision.basis),
  };
}

/**
 * Name the actual reason a candidate was held back.
 *
 * Ordered so the earliest true statement wins, and split by lane because the
 * two lanes are judged on different evidence. A GEO row is never held back for
 * missing demand data — it is not judged on demand at all — so reporting that
 * would send the reader looking for a number the tool never wanted. Likewise a
 * page one that was sampled and came back contested is a different fact from a
 * page one nobody sampled: only the second is worth re-running.
 */
function withheldReason(
  observation: KeywordOpportunityObservation,
  unavailableStages: readonly string[],
): KeywordOpportunityWithheld["reason"] {
  if (isKeywordAlreadyCovered(observation.coverage)) return "already_covered";
  if (observation.lane === "geo") return "no_supporting_page";
  // The two non-available volume states are reported separately: this list is
  // where a reader decides about one specific term, and "the provider said
  // zero" ends that decision while "the provider said nothing" does not.
  if (observation.validation.availability === "explicit_zero") {
    return "volume_priced_at_zero";
  }
  if (observation.validation.availability === "provider_no_data") {
    return "volume_not_returned";
  }
  if (observation.serp.verdict === "contested_evidence") {
    return "page_one_contested";
  }
  // A page one that was opened but resolved no ranks is a provider gap for
  // THIS term, not a budget miss. Reporting it as budget invited a seeded
  // re-run that spends another sample to hit the same gap; the domains list
  // is the witness that the page was fetched.
  if (observation.serp.topTenDomains.length > 0) {
    return "page_one_ranks_unresolved";
  }
  // A stage that failed and a budget that ran out are different facts, and
  // only the first is worth retrying unchanged. Reporting the second for both
  // told a reader to narrow a run that was never the problem.
  return unavailableStages.includes(KEYWORD_STAGE_SERP_SAMPLE)
    ? "serp_sample_unavailable"
    : "serp_sample_budget_exhausted";
}

function countFunnel(
  input: KeywordOpportunityReportInput,
  shown: readonly KeywordOpportunityObservation[],
): KeywordOpportunityFunnel {
  const observations = input.observations;
  const availability = (state: string): number =>
    observations.filter((o) => o.validation.availability === state).length;

  return {
    generated: input.generated,
    deduplicated: observations.length,
    providerReturned: availability("available") + availability("explicit_zero"),
    volumePositive: availability("available"),
    explicitZero: availability("explicit_zero"),
    providerNoData: availability("provider_no_data"),
    // Read off the stage list, which is the fact, rather than inferred from
    // the rows, which are a lossy projection of it. A failed read has no
    // universe, while a truncated read is missing its low-click tail; neither
    // can support a confident count of all already-covered candidates.
    alreadyCovered:
      input.unavailableStages.includes(KEYWORD_STAGE_GSC_COVERAGE) ||
      input.unavailableStages.includes(KEYWORD_STAGE_GSC_COVERAGE_TRUNCATED)
        ? null
        : observations.filter((o) => hasObservedExistingPage(o.coverage))
            .length,
    serpSampled: observations.filter((o) => o.serp.status === "complete")
      .length,
    winnableEvidence: observations.filter((o) => isKeywordWinnable(o.serp))
      .length,
    shown: shown.length,
  };
}

function countsAreWholeAndNonNegative(values: readonly number[]): boolean {
  return values.every((value) => Number.isInteger(value) && value >= 0);
}

function reportedCount(value: number | undefined): number | null {
  return value !== undefined && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function processSerpFailureReason(
  observation: KeywordOpportunityObservation,
): KeywordOpportunityProcessSerpFailureReason {
  switch (observation.serp.failureReason) {
    case "provider_unavailable":
    case "provider_no_data":
    case "transport_outcome_unknown":
    case "budget_exhausted":
      return observation.serp.failureReason;
    default:
      return "unreported";
  }
}

function unmeasuredThresholds(): KeywordOpportunityProcessThresholds {
  return {
    policyVersion: null,
    youngDomainMonths: null,
    siteDomainRank: null,
    siteRankTier: null,
    lowOrganicTrafficThreshold: null,
  };
}

function unmeasuredDurations(): KeywordOpportunityProcessDurationsMs {
  return {
    total: null,
    validation: null,
    coverage: null,
    serpSampling: null,
    serpInterpretation: null,
    domainEnrichment: null,
    report: null,
  };
}

function processThresholds(
  input: KeywordOpportunityProcessInput | undefined,
): KeywordOpportunityProcessThresholds {
  const thresholds = input?.thresholds;
  return thresholds === undefined
    ? unmeasuredThresholds()
    : {
        policyVersion: thresholds.policyVersion ?? null,
        youngDomainMonths: thresholds.youngDomainMonths ?? null,
        siteDomainRank: thresholds.siteDomainRank ?? null,
        siteRankTier: thresholds.siteRankTier ?? null,
        lowOrganicTrafficThreshold:
          thresholds.lowOrganicTrafficThreshold ?? null,
      };
}

function processDurations(
  input: KeywordOpportunityProcessInput | undefined,
): KeywordOpportunityProcessDurationsMs {
  const durations = input?.durationsMs;
  return durations === undefined
    ? unmeasuredDurations()
    : {
        total: durations.total ?? null,
        validation: durations.validation ?? null,
        coverage: durations.coverage ?? null,
        serpSampling: durations.serpSampling ?? null,
        serpInterpretation: durations.serpInterpretation ?? null,
        domainEnrichment: durations.domainEnrichment ?? null,
        report: durations.report ?? null,
      };
}

function buildSignalStateCounts(
  observations: readonly KeywordOpportunityObservation[],
): readonly KeywordOpportunityProcessSignalStateCount[] {
  const counts: KeywordOpportunityProcessSignalStateCount[] = [];
  for (const youngDomain of KEYWORD_OPPORTUNITY_SIGNAL_STATES) {
    for (const lowOrganicTrafficDomain of KEYWORD_OPPORTUNITY_SIGNAL_STATES) {
      for (const communityResult of KEYWORD_OPPORTUNITY_SIGNAL_STATES) {
        const count = observations.filter(
          (observation) =>
            observation.signals?.youngDomain.state === youngDomain &&
            observation.signals.lowOrganicTrafficDomain.state ===
              lowOrganicTrafficDomain &&
            observation.signals.communityResult.state === communityResult,
        ).length;
        if (count > 0) {
          counts.push({
            youngDomain,
            lowOrganicTrafficDomain,
            communityResult,
            count,
          });
        }
      }
    }
  }
  return counts;
}

function buildKeywordOpportunityProcess(
  input: KeywordOpportunityReportInput,
  eligible: readonly {
    readonly observation: KeywordOpportunityObservation;
    readonly decision: KeywordOpportunityDecision | null;
  }[],
  withheld: readonly KeywordOpportunityWithheld[],
  incomplete: readonly KeywordOpportunityIncompleteV3[],
): KeywordOpportunityProcess {
  const observations = input.observations;
  const available = observations.filter(
    (observation) => observation.validation.availability === "available",
  ).length;
  const explicitZero = observations.filter(
    (observation) => observation.validation.availability === "explicit_zero",
  ).length;
  const providerNoData = observations.filter(
    (observation) =>
      observation.validation.availability === "provider_no_data",
  ).length;
  const validationRequested = reportedCount(
    input.process?.validation?.requested,
  );
  const validationCounts = [available, explicitZero, providerNoData];

  const failureReasons: Record<
    KeywordOpportunityProcessSerpFailureReason,
    number
  > = {
    provider_unavailable: 0,
    provider_no_data: 0,
    transport_outcome_unknown: 0,
    budget_exhausted: 0,
    unreported: 0,
  };
  const plannedObservations = observations.filter(
    (observation) =>
      observation.validation.availability !== "explicit_zero",
  );
  let completed = 0;
  let legacyStatusUnreported = 0;
  for (const observation of plannedObservations) {
    if (observation.serp.status === undefined) {
      legacyStatusUnreported += 1;
      continue;
    }
    if (observation.serp.status === "complete") {
      completed += 1;
      continue;
    }
    failureReasons[processSerpFailureReason(observation)] += 1;
  }
  const failed = KEYWORD_OPPORTUNITY_PROCESS_SERP_FAILURE_REASONS.reduce(
    (sum, reason) => sum + failureReasons[reason],
    0,
  );
  const planned = reportedCount(input.process?.serp?.planned);
  const dispatched = reportedCount(input.process?.serp?.dispatched);
  const serpCounts = [
    completed,
    failed,
    legacyStatusUnreported,
    ...KEYWORD_OPPORTUNITY_PROCESS_SERP_FAILURE_REASONS.map(
      (reason) => failureReasons[reason],
    ),
  ];

  const withheldReasons: Record<KeywordOpportunityWithheldReason, number> = {
    volume_priced_at_zero: 0,
    volume_not_returned: 0,
    already_covered: 0,
    page_one_contested: 0,
    page_one_ranks_unresolved: 0,
    serp_sample_budget_exhausted: 0,
    serp_sample_unavailable: 0,
    no_supporting_page: 0,
    all_signals_not_observed: 0,
  };
  for (const entry of withheld) withheldReasons[entry.reason] += 1;
  const incompleteReasons: Record<KeywordOpportunityIncompleteReason, number> =
    {
      serp_evidence_unavailable: 0,
      young_domain_signal_unavailable: 0,
      low_organic_traffic_signal_unavailable: 0,
      community_result_signal_unavailable: 0,
    };
  for (const entry of incomplete) incompleteReasons[entry.reason] += 1;
  const withheldReasonsTotal = KEYWORD_OPPORTUNITY_WITHHELD_REASONS.reduce(
    (sum, reason) => sum + withheldReasons[reason],
    0,
  );
  const incompleteReasonsTotal = KEYWORD_OPPORTUNITY_INCOMPLETE_REASONS.reduce(
    (sum, reason) => sum + incompleteReasons[reason],
    0,
  );
  const positiveWithUnavailableSignals = eligible.filter(({ observation }) => {
    const signals = observation.signals;
    if (signals === undefined) return false;
    const states = [
      signals.youngDomain.state,
      signals.lowOrganicTrafficDomain.state,
      signals.communityResult.state,
    ];
    return states.includes("observed") && states.includes("unavailable");
  }).length;

  const supportingPageSources: Record<
    (typeof KEYWORD_OPPORTUNITY_SUPPORTING_PAGE_SOURCES)[number],
    number
  > = {
    gsc_observed_query_page: 0,
    lexical_page_match: 0,
    inventory_url_match: 0,
    llm_proposition_source: 0,
  };
  let supportingPageUnavailable = 0;
  let supportingPageSourceUnreported = 0;
  for (const observation of observations) {
    const supportingPage = observation.supportingPage;
    if (supportingPage === undefined) {
      if (safeLegacySupportingPageUrl(observation.supportingPageUrl) !== null) {
        supportingPageSourceUnreported += 1;
      } else {
        supportingPageUnavailable += 1;
      }
      continue;
    }
    if (supportingPage.availability !== "available") {
      supportingPageUnavailable += 1;
      continue;
    }
    switch (supportingPage.source) {
      case "gsc_observed_query_page":
      case "lexical_page_match":
      case "inventory_url_match":
      case "llm_proposition_source":
        supportingPageSources[supportingPage.source] += 1;
        break;
    }
  }
  const supportingPageCount =
    supportingPageUnavailable +
    supportingPageSourceUnreported +
    KEYWORD_OPPORTUNITY_SUPPORTING_PAGE_SOURCES.reduce(
      (sum, source) => sum + supportingPageSources[source],
      0,
    );
  const decisionCounts = [
    eligible.length,
    withheld.length,
    incomplete.length,
    positiveWithUnavailableSignals,
    ...KEYWORD_OPPORTUNITY_WITHHELD_REASONS.map(
      (reason) => withheldReasons[reason],
    ),
    ...KEYWORD_OPPORTUNITY_INCOMPLETE_REASONS.map(
      (reason) => incompleteReasons[reason],
    ),
  ];

  return {
    validation: {
      requested: validationRequested,
      available,
      explicitZero,
      providerNoData,
      accounted:
        validationRequested !== null &&
        countsAreWholeAndNonNegative(validationCounts) &&
        validationRequested === available + explicitZero + providerNoData,
    },
    serp: {
      planned,
      dispatched,
      completed,
      failed,
      legacyStatusUnreported,
      failureReasons,
      accounted:
        planned !== null &&
        dispatched !== null &&
        countsAreWholeAndNonNegative(serpCounts) &&
        legacyStatusUnreported === 0 &&
        failureReasons.unreported === 0 &&
        planned === completed + failed &&
        dispatched === planned - failureReasons.budget_exhausted,
    },
    decisions: {
      eligible: eligible.length,
      withheld: withheld.length,
      incomplete: incomplete.length,
      positiveWithUnavailableSignals,
      withheldReasons,
      incompleteReasons,
      accounted:
        countsAreWholeAndNonNegative(decisionCounts) &&
        observations.length ===
          eligible.length + withheld.length + incomplete.length &&
        withheld.length === withheldReasonsTotal &&
        incomplete.length === incompleteReasonsTotal,
    },
    supportingPages: {
      sources: supportingPageSources,
      sourceUnreported: supportingPageSourceUnreported,
      unavailable: supportingPageUnavailable,
      accounted: supportingPageCount === observations.length,
    },
    signalStates: buildSignalStateCounts(observations),
    legacyWithoutSignals: observations.filter(
      (observation) => observation.signals === undefined,
    ).length,
    thresholds: processThresholds(input.process),
    durationsMs: processDurations(input.process),
  };
}

/**
 * What to tell a reader whose run came back thin.
 *
 * Only ever suggestions about the inputs. A run that found nothing has learned
 * nothing about the site's prospects, so it must not editorialise about them.
 */
function nextSteps(
  input: KeywordOpportunityReportInput,
  shownCount: number,
  incompleteCount: number,
): readonly string[] {
  const steps: string[] = [];
  if (!input.context.contextSufficient) {
    steps.push("supply_product_description");
  }
  if (shownCount < KEYWORD_OPPORTUNITY_MIN_ROWS) {
    steps.push("add_seed_keywords", "try_another_market");
  }
  if (input.unavailableStages.length > 0 || incompleteCount > 0) {
    steps.push("rerun_when_stage_recovers");
  }
  return steps;
}

/**
 * Resolve the run-level availability.
 *
 * `partial` exists so a missing stage can never be read as a clean run: the
 * seo-audit history in this repo has a case where a fully disallowed crawl was
 * reported as "checked, nothing found". A run missing a stage says so even
 * when it produced plenty of rows.
 */
function resolveAvailability(
  input: KeywordOpportunityReportInput,
  shownCount: number,
  incompleteCount: number,
): KeywordOpportunityAvailability {
  if (shownCount < KEYWORD_OPPORTUNITY_MIN_ROWS) return "insufficient_evidence";
  if (input.unavailableStages.length > 0 || incompleteCount > 0) return "partial";
  return "available";
}

function countReasons<T extends string>(
  values: readonly T[],
): Readonly<Partial<Record<T, number>>> {
  const counts: Partial<Record<T, number>> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function summarizeSupportingPages(
  observations: readonly KeywordOpportunityObservation[],
): KeywordOpportunitySupportingPageSummary {
  let gscObservedQueryPage = 0;
  let lexicalPageMatch = 0;
  let llmPropositionSource = 0;
  let inventoryUrlMatch = 0;
  let notObserved = 0;

  for (const observation of observations) {
    const supportingPage = supportingPageOrDefault(observation);
    if (supportingPage.state !== "observed") {
      notObserved += 1;
      continue;
    }
    switch (supportingPage.source) {
      case "gsc_observed_query_page":
        gscObservedQueryPage += 1;
        break;
      case "lexical_page_match":
        lexicalPageMatch += 1;
        break;
      case "llm_proposition_source":
        llmPropositionSource += 1;
        break;
      case "inventory_url_match":
        inventoryUrlMatch += 1;
        break;
    }
  }

  return {
    gscObservedQueryPage,
    lexicalPageMatch,
    llmPropositionSource,
    inventoryUrlMatch,
    notObserved,
  };
}

function summarizeDecisions(
  observations: readonly KeywordOpportunityObservation[],
  eligibleCount: number,
  withheld: readonly KeywordOpportunityWithheld[],
  incomplete: readonly KeywordOpportunityIncomplete[],
): KeywordOpportunityDecisionSummary {
  const positiveWithUnavailableSignals = observations.filter((observation) => {
    if (observation.signals === undefined) return false;
    const states = [
      observation.signals.youngDomain.state,
      observation.signals.lowOrganicTrafficDomain.state,
      observation.signals.communityResult.state,
    ];
    return states.includes("observed") && states.includes("unavailable");
  }).length;

  return {
    eligible: eligibleCount,
    withheld: withheld.length,
    incomplete: incomplete.length,
    positiveWithUnavailableSignals,
    withheldReasons: countReasons(withheld.map((entry) => entry.reason)),
    incompleteReasons: countReasons(incomplete.map((entry) => entry.reason)),
  };
}

function summarizeProcess(
  input: KeywordOpportunityReportInput,
  observations: readonly KeywordOpportunityObservation[],
  eligibleCount: number,
  withheld: readonly KeywordOpportunityWithheld[],
  incomplete: readonly KeywordOpportunityIncomplete[],
): KeywordOpportunityProcess {
  const completed = observations.filter(
    (observation) =>
      observation.validation.availability !== "explicit_zero" &&
      observation.serp.status === "complete",
  ).length;
  const planned =
    input.serpPlanned ??
    observations.filter(
      (observation) => observation.validation.availability !== "explicit_zero",
    ).length;
  const failureReasons = {
    ...(input.serpFailureReasons ?? {}),
  } satisfies Partial<Record<KeywordOpportunitySerpFailureReason, number>>;

  return {
    serp: {
      planned,
      completed,
      failed: Math.max(planned - completed, 0),
      failureReasons,
    },
    supportingPages: summarizeSupportingPages(observations),
    decisions: summarizeDecisions(
      observations,
      eligibleCount,
      withheld,
      incomplete,
    ),
    thresholds: input.thresholds ?? {
      siteDomainRank: null,
      lowOrganicTrafficThreshold: null,
    },
    durationsMs: input.durationsMs ?? {
      total: 0,
      coverage: null,
      serpSampling: null,
      serpInterpretation: null,
      domainEnrichment: null,
    },
  };
}

/** Assemble the finished result from observations that are already judged. */
export function buildKeywordOpportunityResult(
  input: KeywordOpportunityReportInput,
): KeywordOpportunityResultV3 {
  const eligible: Array<{
    readonly observation: KeywordOpportunityObservation;
    readonly decision: KeywordOpportunityDecision | null;
  }> = [];
  const withheld: KeywordOpportunityWithheld[] = [];
  const incomplete: KeywordOpportunityIncompleteV3[] = [];

  for (const observation of input.observations) {
    const classification = classifyObservation(
      observation,
      input.unavailableStages,
    );
    if (classification.disposition === "eligible") {
      eligible.push({ observation, decision: classification.decision });
    } else if (classification.disposition === "excluded") {
      withheld.push({
        keyword: observation.keyword,
        discoveryBasis: observation.discoveryBasis,
        reason: classification.reason,
        ...(classification.decision === null
          ? {}
          : { decision: classification.decision }),
      });
    } else {
      incomplete.push({
        keyword: observation.keyword,
        lane: observation.lane,
        discoveryBasis: observation.discoveryBasis,
        validation: observation.validation,
        coverage: observation.coverage,
        serp: observation.serp,
        serpIntent: observation.serpIntent ?? null,
        signals: classification.signals,
        aiOverview: publicAiOverviewEvidence(observation.aiOverview),
        reason: classification.reason,
        decision: classification.decision,
        supportingPage: observationSupportingPage(observation),
        supportingPageUrl: observationSupportingPageUrl(observation),
      });
    }
  }

  const shown = eligible.map(({ observation }) => observation);
  const clusters = clusterKeywords(shown.map((row) => row.keyword));
  const clusterIds = keywordClusterIndex(clusters);
  const rows: KeywordOpportunityRowV3[] = eligible.map(
    ({ observation, decision }) => ({
      keyword: observation.keyword,
      lane: observation.lane,
      discoveryBasis: observation.discoveryBasis,
      questionForm: observation.questionForm,
      propositionIndex: observation.propositionIndex,
      validation: observation.validation,
      serp: observation.serp,
      ...(decision === null
        ? {}
        : {
            serpIntent: observation.serpIntent ?? null,
            signals: observation.signals,
            aiOverview: publicAiOverviewEvidence(observation.aiOverview),
            decision,
          }),
      coverage: observation.coverage,
      supportingPage: observationSupportingPage(observation),
      supportingPageUrl: observationSupportingPageUrl(observation),
      nextChecks: keywordNextChecks(observation),
      clusterId: clusterIds.get(observation.keyword) ?? null,
    }),
  );
  const process = buildKeywordOpportunityProcess(
    input,
    eligible,
    withheld,
    incomplete,
  );

  return {
    availability: resolveAvailability(input, rows.length, incomplete.length),
    marketCode: input.marketCode,
    languageCode: input.languageCode,
    context: input.context,
    rows,
    withheld,
    incomplete,
    clusters,
    funnel: countFunnel(input, shown),
    process: summarizeProcess(
      input,
      input.observations,
      rows.length,
      withheld,
      incomplete,
    ),
    unavailableStages: input.unavailableStages,
    nextStepSuggestions: nextSteps(input, rows.length, incomplete.length),
    process,
  };
}

/**
 * Wrap the result in the shared public-tool envelope.
 *
 * `createPublicToolResult` pins `mode: "public_preview"` and
 * `persistence: "none"`, which is exactly true here: nothing this run produces
 * is written anywhere. If that ever stops being true the helper has to change
 * rather than the caller patching the field back in.
 */
export function buildKeywordOpportunityPayload(
  input: KeywordOpportunityReportInput,
): KeywordOpportunityEnvelope {
  return createPublicToolResult(
    {
      tool: "keyword_opportunity_map",
      schemaVersion: KEYWORD_OPPORTUNITY_SCHEMA_VERSION,
      scope: "site",
      completedAt: input.completedAt,
    },
    buildKeywordOpportunityResult(input),
  );
}
