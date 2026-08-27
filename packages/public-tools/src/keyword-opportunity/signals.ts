// @input  -- three completed-or-unavailable SERP signals plus optional AI Overview assessment
// @output -- a deterministic eligible/excluded/incomplete basis and ranking-only discounts
// @pos    -- pure decision policy; provider transport and model interpretation stay outside
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type {
  KeywordOpportunityAiOverviewObservation,
  KeywordOpportunityDecisionDiscount,
  KeywordOpportunityIncompleteReason,
  KeywordOpportunitySignal,
  KeywordOpportunitySignalDecision,
  KeywordOpportunitySignalState,
  KeywordOpportunitySignals,
} from "./types.ts";

/**
 * Apply the three-question rule without collapsing unknown evidence to false.
 * A positive signal stays positive even when a sibling signal is unavailable;
 * only a row with no positive signal falls back to incomplete-on-unknown or
 * excluded-on-three-negatives.
 */
export function classifyKeywordOpportunitySignals(
  signals: KeywordOpportunitySignals,
): KeywordOpportunitySignalDecision {
  const named = [
    [
      "young_domain",
      signals.youngDomain.state,
      "young_domain_signal_unavailable",
    ],
    [
      "low_organic_traffic_domain",
      signals.lowOrganicTrafficDomain.state,
      "low_organic_traffic_signal_unavailable",
    ],
    [
      "community_result",
      signals.communityResult.state,
      "community_result_signal_unavailable",
    ],
  ] as const satisfies readonly (readonly [
    KeywordOpportunitySignal,
    KeywordOpportunitySignalState,
    KeywordOpportunityIncompleteReason,
  ])[];
  const positiveSignals = named
    .filter(([, state]) => state === "observed")
    .map(([name]) => name);
  const unavailable = named.find(([, state]) => state === "unavailable");

  if (positiveSignals.length > 0) {
    return {
      disposition: "eligible",
      basis: "positive_signal_observed",
      positiveSignals,
      incompleteReason: null,
    };
  }

  if (unavailable !== undefined) {
    return {
      disposition: "incomplete",
      basis: "signal_evidence_unavailable",
      positiveSignals,
      incompleteReason: unavailable[2],
    };
  }

  return {
    disposition: "excluded",
    basis: "all_signals_not_observed",
    positiveSignals: [],
    incompleteReason: null,
  };
}

/** AI Overview assessment is a ranking discount in v2, never an exclusion. */
export function keywordOpportunityDecisionDiscounts(
  aiOverview: KeywordOpportunityAiOverviewObservation | null | undefined,
): readonly KeywordOpportunityDecisionDiscount[] {
  return aiOverview?.availability === "observed" &&
    aiOverview.answerAssessment === "complete" &&
    Boolean(aiOverview.markdown?.trim())
    ? ["ai_overview_answer_discount"]
    : [];
}
