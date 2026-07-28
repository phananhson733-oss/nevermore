import { describe, expect, it } from "vitest";
import {
  GrowthMapTopicModelInsights,
  GrowthMapTopicNodeInsight,
} from "./topic-model-insights.ts";

const ids = {
  project: "93000000-0000-4000-8000-000000000001",
  nodeA: "93000000-0000-4000-8000-000000000002",
  nodeB: "93000000-0000-4000-8000-000000000003",
} as const;

function node(
  overrides: Record<string, unknown> = {},
) {
  return {
    projectId: ids.project,
    topicNodeId: ids.nodeA,
    topicModelRevision: 4,
    label: "Customer Onboarding",
    keywordCount: 3,
    approvedKeywordCount: 2,
    reviewPendingKeywordCount: 1,
    existingPageKeywordCount: 2,
    newAssetKeywordCount: 1,
    unassignedKeywordCount: 0,
    mappedPageCount: 2,
    conflictingIntentCount: 0,
    coverageState: "partial",
    limitation:
      "Coverage is partial because one Keyword awaits review and one requires a new asset.",
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    projectId: ids.project,
    topicModelRevision: 4,
    nodes: [node()],
    coverage: {
      availability: "available",
      limitations: [],
    },
    generatedAt: "2026-07-28T05:00:00.000Z",
    ...overrides,
  };
}

describe("GrowthMapTopicNodeInsight", () => {
  it.each([
    {
      state: "empty",
      facts: {
        keywordCount: 0,
        approvedKeywordCount: 0,
        reviewPendingKeywordCount: 0,
        existingPageKeywordCount: 0,
        newAssetKeywordCount: 0,
        unassignedKeywordCount: 0,
        mappedPageCount: 0,
        conflictingIntentCount: 0,
        limitation:
          "No non-excluded current Keyword is assigned to this Topic.",
      },
    },
    {
      state: "uncovered",
      facts: {
        keywordCount: 2,
        approvedKeywordCount: 1,
        reviewPendingKeywordCount: 0,
        existingPageKeywordCount: 0,
        newAssetKeywordCount: 1,
        unassignedKeywordCount: 1,
        mappedPageCount: 0,
        conflictingIntentCount: 0,
        limitation:
          "Assigned Keywords do not map to an existing content page.",
      },
    },
    {
      state: "covered",
      facts: {
        keywordCount: 2,
        approvedKeywordCount: 2,
        reviewPendingKeywordCount: 0,
        existingPageKeywordCount: 2,
        newAssetKeywordCount: 0,
        unassignedKeywordCount: 0,
        mappedPageCount: 1,
        conflictingIntentCount: 0,
        limitation: null,
      },
    },
    {
      state: "conflict",
      facts: {
        keywordCount: 3,
        approvedKeywordCount: 3,
        reviewPendingKeywordCount: 0,
        existingPageKeywordCount: 3,
        newAssetKeywordCount: 0,
        unassignedKeywordCount: 0,
        mappedPageCount: 2,
        conflictingIntentCount: 1,
        limitation:
          "One reviewed intent maps to multiple existing pages.",
      },
    },
  ])("accepts the derived $state coverage state", ({ state, facts }) => {
    expect(
      GrowthMapTopicNodeInsight.parse({
        ...node(),
        ...facts,
        coverageState: state,
      }),
    ).toMatchObject({ coverageState: state });
  });

  it("rejects invented totals that do not partition mapping decisions", () => {
    expect(
      GrowthMapTopicNodeInsight.safeParse({
        ...node(),
        keywordCount: 4,
      }).success,
    ).toBe(false);
  });

  it("rejects a cannibalization conflict without multiple existing pages", () => {
    expect(
      GrowthMapTopicNodeInsight.safeParse({
        ...node(),
        keywordCount: 2,
        approvedKeywordCount: 2,
        reviewPendingKeywordCount: 0,
        existingPageKeywordCount: 2,
        newAssetKeywordCount: 0,
        unassignedKeywordCount: 0,
        mappedPageCount: 1,
        conflictingIntentCount: 1,
        coverageState: "conflict",
      }).success,
    ).toBe(false);
  });

  it("requires every non-covered state to explain its limitation", () => {
    expect(
      GrowthMapTopicNodeInsight.safeParse({
        ...node(),
        limitation: null,
      }).success,
    ).toBe(false);
    expect(
      GrowthMapTopicNodeInsight.safeParse({
        ...node({
          keywordCount: 1,
          approvedKeywordCount: 1,
          reviewPendingKeywordCount: 0,
          existingPageKeywordCount: 1,
          newAssetKeywordCount: 0,
          mappedPageCount: 1,
          coverageState: "covered",
        }),
        limitation: "An invented limitation.",
      }).success,
    ).toBe(false);
  });
});

describe("GrowthMapTopicModelInsights", () => {
  it("binds every active node to one exact confirmed revision and project", () => {
    expect(
      GrowthMapTopicModelInsights.parse({
        ...response(),
        nodes: [
          node(),
          node({
            topicNodeId: ids.nodeB,
            label: "Integrations",
          }),
        ],
      }),
    ).toMatchObject({
      projectId: ids.project,
      topicModelRevision: 4,
      nodes: [{ topicModelRevision: 4 }, { topicModelRevision: 4 }],
    });
  });

  it("represents missing confirmed authority as unavailable, never as zero-valued nodes", () => {
    expect(
      GrowthMapTopicModelInsights.parse({
        ...response(),
        topicModelRevision: null,
        nodes: [],
        coverage: {
          availability: "unavailable",
          limitations: [
            "No confirmed Topic Model is available for analysis.",
          ],
        },
      }),
    ).toMatchObject({
      topicModelRevision: null,
      nodes: [],
      coverage: { availability: "unavailable" },
    });
  });

  it("rejects nodes projected from a draft or foreign confirmed revision", () => {
    expect(
      GrowthMapTopicModelInsights.safeParse({
        ...response(),
        nodes: [node({ topicModelRevision: 5 })],
      }).success,
    ).toBe(false);
    expect(
      GrowthMapTopicModelInsights.safeParse({
        ...response(),
        nodes: [node({ projectId: ids.nodeB })],
      }).success,
    ).toBe(false);
  });

  it("does not accept an empty confirmed model projection", () => {
    expect(
      GrowthMapTopicModelInsights.safeParse({
        ...response(),
        nodes: [],
      }).success,
    ).toBe(false);
  });
});
