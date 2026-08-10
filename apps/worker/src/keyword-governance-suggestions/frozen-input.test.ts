import { describe, expect, it } from "vitest";
import {
  freezeKeywordGovernanceSuggestionInput,
  type KeywordGovernanceSuggestionFreezeInput,
} from "./frozen-input.ts";

const ids = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  profile: "00000000-0000-4000-8000-000000000003",
  topicRevision: "00000000-0000-4000-8000-000000000004",
  topicA: "00000000-0000-4000-8000-000000000005",
  topicB: "00000000-0000-4000-8000-000000000006",
  pageA: "00000000-0000-4000-8000-000000000007",
  pageB: "00000000-0000-4000-8000-000000000008",
  snapshot: "00000000-0000-4000-8000-000000000009",
  observation: "00000000-0000-4000-8000-00000000000a",
} as const;

function keyword(
  suffix: number,
  overrides: Partial<KeywordGovernanceSuggestionFreezeInput["keywords"][number]> = {},
): KeywordGovernanceSuggestionFreezeInput["keywords"][number] {
  const hex = suffix.toString(16).padStart(12, "0");
  return {
    keywordId: `10000000-0000-4000-8000-${hex}`,
    displayKeyword: `Keyword ${suffix}`,
    normalizedKeyword: `keyword ${suffix}`,
    marketCode: "US",
    languageTag: "en-US",
    queryKind: "search_query",
    status: "candidate",
    reviewState: "unreviewed",
    reviewOrigin: null,
    hasHumanDecision: false,
    governanceRevision: suffix,
    topicNodeId: null,
    topicModelRevision: null,
    mappedSitePageId: null,
    occurrences: [
      {
        occurrenceId: `20000000-0000-4000-8000-${hex}`,
        marketCode: "US",
        languageTag: "en-US",
        valid: true,
        sourceKind: "manual",
        providerSearchIntent: null,
      },
    ],
    ...overrides,
  };
}

function input(
  overrides: Partial<KeywordGovernanceSuggestionFreezeInput> = {},
): KeywordGovernanceSuggestionFreezeInput {
  return {
    workspaceId: ids.workspace,
    projectId: ids.project,
    marketCode: "US",
    languageTag: "en-US",
    primaryMarketCode: "US",
    primaryLanguageTag: "en-US",
    confirmedProductProfile: {
      state: "confirmed",
      productProfileId: ids.profile,
      version: 3,
      contentHash: "a".repeat(64),
      facts: {
        productName: "RelayOps",
        category: "Lifecycle automation",
        valueProposition: "Turn product signals into timely actions.",
        targetAudience: "B2B SaaS product teams",
        buyerRoles: ["VP Product"],
        pains: ["Fragmented product signals"],
        outcomes: ["Higher activation"],
      },
    },
    confirmedTopicModel: {
      state: "confirmed",
      topicModelRevisionId: ids.topicRevision,
      revision: 4,
      contentHash: "b".repeat(64),
      topics: [
        { topicNodeId: ids.topicB, label: "Retention" },
        { topicNodeId: ids.topicA, label: "Activation" },
      ],
    },
    pages: [
      {
        sitePageId: ids.pageB,
        normalizedUrl: "https://relayops.example/retention",
        title: "Retention",
        owned: true,
      },
      {
        sitePageId: ids.pageA,
        normalizedUrl: "https://relayops.example/activation",
        title: "Activation",
        owned: true,
      },
    ],
    keywords: [keyword(1)],
    ...overrides,
  };
}

describe("keyword governance suggestion frozen input", () => {
  it("admits only untouched candidate SearchQuery rows with exact-scope valid occurrences", () => {
    const eligible = keyword(1, {
      topicNodeId: ids.topicA,
      topicModelRevision: 4,
      mappedSitePageId: ids.pageA,
      occurrences: [
        {
          occurrenceId: "20000000-0000-4000-8000-000000000001",
          marketCode: "US",
          languageTag: "en-US",
          valid: true,
          sourceKind: "dataforseo_ranked",
          providerSearchIntent: {
            value: "commercial",
            snapshotId: ids.snapshot,
            observationId: ids.observation,
            observedAt: "2026-08-10T01:02:03.000Z",
          },
        },
      ],
    });
    const result = freezeKeywordGovernanceSuggestionInput(
      input({
        keywords: [
          keyword(7, { queryKind: "generative_query" }),
          keyword(6, { status: "approved" }),
          keyword(5, { reviewState: "confirmed" }),
          keyword(4, { reviewOrigin: "user" }),
          keyword(3, { hasHumanDecision: true }),
          keyword(2, {
            occurrences: keyword(2).occurrences.map((row) => ({
              ...row,
              languageTag: "fr-FR",
            })),
          }),
          eligible,
        ],
      }),
    );

    expect(result.manifest.candidates).toEqual([
      {
        ordinal: 1,
        keywordKey: "keyword-1",
        keywordId: eligible.keywordId,
        queryKind: "search_query",
        expectedGovernanceRevision: 1,
        displayKeyword: "Keyword 1",
        normalizedKeyword: "keyword 1",
        deterministicEvidence: {
          sourceOccurrenceIds: [
            "20000000-0000-4000-8000-000000000001",
          ],
          providerSearchIntent: {
            value: "commercial",
            snapshotId: ids.snapshot,
            observationId: ids.observation,
            observedAt: "2026-08-10T01:02:03.000Z",
          },
          currentTopicKey: "topic-1",
          currentPageKey: "page-1",
        },
      },
    ]);
    expect(result.inputHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("canonicalizes source order before assigning local keys and hashing", () => {
    const one = keyword(1, {
      topicNodeId: ids.topicB,
      topicModelRevision: 4,
      mappedSitePageId: ids.pageB,
    });
    const two = keyword(2);
    const forward = input({ keywords: [two, one] });
    const reverse = input({
      keywords: [one, two],
      pages: [...input().pages].reverse(),
      confirmedTopicModel: {
        ...input().confirmedTopicModel!,
        topics: [...input().confirmedTopicModel!.topics].reverse(),
      },
    });

    const frozen = freezeKeywordGovernanceSuggestionInput(forward);
    expect(frozen).toEqual(freezeKeywordGovernanceSuggestionInput(reverse));
    expect(frozen.inputHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(frozen.manifest).not.toHaveProperty("inputHash");
    expect(
      freezeKeywordGovernanceSuggestionInput(forward).manifest.candidates.map(
        ({ keywordKey, keywordId }) => ({ keywordKey, keywordId }),
      ),
    ).toEqual([
      { keywordKey: "keyword-1", keywordId: one.keywordId },
      { keywordKey: "keyword-2", keywordId: two.keywordId },
    ]);
  });

  it("fails closed without exact primary scope or confirmed authorities", () => {
    expect(() =>
      freezeKeywordGovernanceSuggestionInput(
        input({ marketCode: "GB" }),
      ),
    ).toThrow(/primary market/u);
    expect(() =>
      freezeKeywordGovernanceSuggestionInput(
        input({ languageTag: "en-GB" }),
      ),
    ).toThrow(/primary language/u);
    expect(() =>
      freezeKeywordGovernanceSuggestionInput(
        input({ confirmedProductProfile: null }),
      ),
    ).toThrow(/confirmed Product Profile/u);
    expect(() =>
      freezeKeywordGovernanceSuggestionInput(
        input({
          confirmedTopicModel: {
            ...input().confirmedTopicModel!,
            state: "draft",
          },
        }),
      ),
    ).toThrow(/confirmed Topic Model/u);
  });

  it("rejects a batch larger than the frozen 100-candidate limit", () => {
    expect(() =>
      freezeKeywordGovernanceSuggestionInput(
        input({
          keywords: Array.from({ length: 101 }, (_, index) =>
            keyword(index + 1),
          ),
        }),
      ),
    ).toThrow(/at most 100/u);
  });

  it("rejects a non-canonical provider intent before freezing lineage", () => {
    expect(() =>
      freezeKeywordGovernanceSuggestionInput(
        input({
          keywords: [
            keyword(1, {
              occurrences: [
                {
                  ...keyword(1).occurrences[0]!,
                  sourceKind: "dataforseo_ranked",
                  providerSearchIntent: {
                    value: "research",
                    snapshotId: ids.snapshot,
                    observationId: ids.observation,
                    observedAt: "2026-08-10T01:02:03.000Z",
                  },
                },
              ],
            }),
          ],
        }),
      ),
    ).toThrow(/provider intent/u);
  });
});
