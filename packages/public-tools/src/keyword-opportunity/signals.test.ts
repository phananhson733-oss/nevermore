import { describe, expect, it } from "vitest";

import {
  classifyKeywordOpportunitySignals,
  keywordOpportunityDecisionDiscounts,
} from "./signals.ts";
import {
  KEYWORD_OPPORTUNITY_INCOMPLETE_REASONS,
  KEYWORD_OPPORTUNITY_SIGNAL_STATES,
  KEYWORD_OPPORTUNITY_SIGNALS,
} from "./types.ts";
import type {
  KeywordOpportunityAiOverviewObservation,
  KeywordOpportunitySignals,
} from "./types.ts";

const NEGATIVE = { state: "not_observed" as const, observation: null };
const UNKNOWN = {
  state: "unavailable" as const,
  observation: null,
  reason: "provider_did_not_return_required_evidence",
};

function signals(
  overrides: Partial<KeywordOpportunitySignals> = {},
): KeywordOpportunitySignals {
  return {
    youngDomain: NEGATIVE,
    lowOrganicTrafficDomain: NEGATIVE,
    communityResult: NEGATIVE,
    ...overrides,
  };
}

describe("classifyKeywordOpportunitySignals", () => {
  it("publishes exhaustive stable states and incomplete reasons", () => {
    expect(KEYWORD_OPPORTUNITY_SIGNALS).toEqual([
      "young_domain",
      "low_organic_traffic_domain",
      "community_result",
    ]);
    expect(KEYWORD_OPPORTUNITY_SIGNAL_STATES).toEqual([
      "observed",
      "not_observed",
      "unavailable",
    ]);
    expect(KEYWORD_OPPORTUNITY_INCOMPLETE_REASONS).toEqual([
      "serp_evidence_unavailable",
      "young_domain_signal_unavailable",
      "low_organic_traffic_signal_unavailable",
      "community_result_signal_unavailable",
    ]);
  });

  it("is eligible when at least one completed signal is observed", () => {
    expect(
      classifyKeywordOpportunitySignals(
        signals({
          communityResult: {
            state: "observed",
            observation: {
              domain: "forum.test",
              url: "https://forum.test/thread",
              position: 4,
              source: "provider_item_type",
            },
          },
        }),
      ),
    ).toEqual({
      disposition: "eligible",
      basis: "positive_signal_observed",
      positiveSignals: ["community_result"],
      incompleteReason: null,
    });
  });

  it("excludes only when all three completed as not observed", () => {
    expect(classifyKeywordOpportunitySignals(signals())).toEqual({
      disposition: "excluded",
      basis: "all_signals_not_observed",
      positiveSignals: [],
      incompleteReason: null,
    });
  });

  it.each([
    ["youngDomain", "young_domain_signal_unavailable"],
    ["lowOrganicTrafficDomain", "low_organic_traffic_signal_unavailable"],
    ["communityResult", "community_result_signal_unavailable"],
  ] as const)("keeps unavailable %s evidence unknown", (field, reason) => {
    const decision = classifyKeywordOpportunitySignals(
      signals({ [field]: UNKNOWN }),
    );
    expect(decision).toMatchObject({
      disposition: "incomplete",
      basis: "signal_evidence_unavailable",
      incompleteReason: reason,
    });
    expect(decision.basis).not.toBe("all_signals_not_observed");
  });
});

describe("keywordOpportunityDecisionDiscounts", () => {
  const complete: KeywordOpportunityAiOverviewObservation = {
    availability: "observed",
    markdown: "The complete answer.",
    loadedAsync: true,
    answerAssessment: "complete",
    reason: "The question is fully answered.",
    modelId: "test-model",
    promptVersion: "aio-answer.v1",
  };

  it("discounts an observed complete answer without making a verdict", () => {
    expect(keywordOpportunityDecisionDiscounts(complete)).toEqual([
      "ai_overview_answer_discount",
    ]);
  });

  it("does not discount partial or unavailable evidence", () => {
    expect(
      keywordOpportunityDecisionDiscounts({
        ...complete,
        answerAssessment: "partial",
      }),
    ).toEqual([]);
    expect(
      keywordOpportunityDecisionDiscounts({
        ...complete,
        availability: "unavailable",
        markdown: null,
        loadedAsync: false,
      }),
    ).toEqual([]);
  });

  it.each([null, "", "   "])(
    "does not discount an observed complete assessment without retained markdown: %j",
    (markdown) => {
      expect(
        keywordOpportunityDecisionDiscounts({ ...complete, markdown }),
      ).toEqual([]);
    },
  );
});
