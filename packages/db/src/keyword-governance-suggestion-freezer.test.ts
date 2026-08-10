import { describe, expect, it } from "vitest";
import { KeywordGovernanceSuggestionInputManifest } from "@sf/contracts";
import {
  KEYWORD_GOVERNANCE_SUGGESTION_CANONICAL_INTENTS,
  freezeKeywordGovernanceSuggestionInput,
  type KeywordGovernanceSuggestionFreezeInput,
} from "./keyword-governance-suggestion-freezer.ts";

const IDS = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  profile: "00000000-0000-4000-8000-000000000003",
  topicRevision: "00000000-0000-4000-8000-000000000004",
  topic: "00000000-0000-4000-8000-000000000005",
  occurrence: "00000000-0000-4000-8000-000000000006",
  snapshot: "00000000-0000-4000-8000-000000000007",
  observation: "00000000-0000-4000-8000-000000000008",
  keyword: "00000000-0000-4000-8000-000000000009",
} as const;

function authority(
  intent: string,
): KeywordGovernanceSuggestionFreezeInput {
  return {
    workspaceId: IDS.workspace,
    projectId: IDS.project,
    marketCode: "US",
    languageTag: "en-US",
    primaryMarketCode: "US",
    primaryLanguageTag: "en-US",
    confirmedProductProfile: {
      state: "confirmed",
      productProfileId: IDS.profile,
      version: 1,
      contentHash: "a".repeat(64),
      facts: {
        productName: "RelayOps",
        category: "Lifecycle automation",
        valueProposition: "Turn customer signals into actions.",
        targetAudience: "B2B SaaS teams",
        buyerRoles: ["VP Customer Success"],
        pains: ["Fragmented onboarding"],
        outcomes: ["Faster activation"],
      },
    },
    confirmedTopicModel: {
      state: "confirmed",
      topicModelRevisionId: IDS.topicRevision,
      revision: 1,
      contentHash: "b".repeat(64),
      topics: [{ topicNodeId: IDS.topic, label: "Activation" }],
    },
    pages: [],
    keywords: [
      {
        keywordId: IDS.keyword,
        displayKeyword: "activation automation",
        normalizedKeyword: "activation automation",
        marketCode: "US",
        languageTag: "en-US",
        queryKind: "search_query",
        status: "candidate",
        reviewState: "unreviewed",
        reviewOrigin: null,
        hasHumanDecision: false,
        governanceRevision: 0,
        topicNodeId: null,
        topicModelRevision: null,
        mappedSitePageId: null,
        occurrences: [
          {
            occurrenceId: IDS.occurrence,
            marketCode: "US",
            languageTag: "en-US",
            valid: true,
            sourceKind: "dataforseo_ranked",
            providerSearchIntent: {
              value: intent,
              snapshotId: IDS.snapshot,
              observationId: IDS.observation,
              observedAt: "2026-08-10T00:00:00.000Z",
            },
          },
        ],
      },
    ],
  };
}

describe("shared Keyword governance suggestion freezer", () => {
  it("keeps the frozen provider-intent vocabulary aligned with the manifest runtime parser", () => {
    expect(KEYWORD_GOVERNANCE_SUGGESTION_CANONICAL_INTENTS).toEqual([
      "informational",
      "navigational",
      "commercial",
      "transactional",
    ]);

    for (const intent of KEYWORD_GOVERNANCE_SUGGESTION_CANONICAL_INTENTS) {
      const frozen = freezeKeywordGovernanceSuggestionInput(authority(intent));
      expect(
        KeywordGovernanceSuggestionInputManifest.safeParse(frozen.manifest)
          .success,
      ).toBe(true);
      expect(
        frozen.manifest.candidates[0]?.deterministicEvidence
          .providerSearchIntent?.value,
      ).toBe(intent);
    }

    expect(() =>
      freezeKeywordGovernanceSuggestionInput(authority("research")),
    ).toThrow(/provider intent/u);
  });
});
