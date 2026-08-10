import type {
  KeywordGovernanceSuggestionInputManifest,
  KeywordGovernanceSuggestionStructuredOutput,
} from "@sf/contracts";
import { describe, expect, it } from "vitest";
import { resolveKeywordGovernanceSuggestions } from "./resolution.ts";

const ids = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  profile: "00000000-0000-4000-8000-000000000003",
  topicRevision: "00000000-0000-4000-8000-000000000004",
  topicA: "00000000-0000-4000-8000-000000000005",
  topicB: "00000000-0000-4000-8000-000000000006",
  pageA: "00000000-0000-4000-8000-000000000007",
  pageB: "00000000-0000-4000-8000-000000000008",
  keywordA: "00000000-0000-4000-8000-000000000009",
  keywordB: "00000000-0000-4000-8000-00000000000a",
  occurrenceA: "00000000-0000-4000-8000-00000000000b",
  occurrenceB: "00000000-0000-4000-8000-00000000000c",
  snapshot: "00000000-0000-4000-8000-00000000000d",
  observation: "00000000-0000-4000-8000-00000000000e",
  suggestionA: "00000000-0000-4000-8000-000000000010",
  suggestionB: "00000000-0000-4000-8000-000000000011",
} as const;

function manifest(): KeywordGovernanceSuggestionInputManifest {
  return {
    schemaVersion: "keyword-governance-suggestion-input.v1",
    generationVersion: "keyword-governance-suggestion-generation.v1",
    promptSetVersion: "keyword-governance-suggestion.prompt.v1",
    workspaceId: ids.workspace,
    projectId: ids.project,
    marketCode: "US",
    languageTag: "en-US",
    confirmedProductProfile: {
      productProfileId: ids.profile,
      version: 2,
      contentHash: "a".repeat(64),
      facts: {
        productName: "RelayOps",
        category: "Lifecycle automation",
        valueProposition: "Turn signals into actions.",
        targetAudience: "B2B SaaS teams",
        buyerRoles: [],
        pains: [],
        outcomes: [],
      },
    },
    confirmedTopicModel: {
      topicModelRevisionId: ids.topicRevision,
      revision: 7,
      contentHash: "b".repeat(64),
    },
    topicAllowlist: [
      {
        topicKey: "topic-1",
        topicNodeId: ids.topicA,
        topicModelRevision: 7,
        label: "Activation",
      },
      {
        topicKey: "topic-2",
        topicNodeId: ids.topicB,
        topicModelRevision: 7,
        label: "Retention",
      },
    ],
    pageAllowlist: [
      {
        pageKey: "page-1",
        sitePageId: ids.pageA,
        normalizedUrl: "https://relayops.example/activation",
        title: "Activation",
      },
      {
        pageKey: "page-2",
        sitePageId: ids.pageB,
        normalizedUrl: "https://relayops.example/retention",
        title: "Retention",
      },
    ],
    candidates: [
      {
        ordinal: 1,
        keywordKey: "keyword-1",
        keywordId: ids.keywordA,
        queryKind: "search_query",
        expectedGovernanceRevision: 4,
        displayKeyword: "activation automation",
        normalizedKeyword: "activation automation",
        deterministicEvidence: {
          sourceOccurrenceIds: [ids.occurrenceA],
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
      {
        ordinal: 2,
        keywordKey: "keyword-2",
        keywordId: ids.keywordB,
        queryKind: "search_query",
        expectedGovernanceRevision: 0,
        displayKeyword: "reduce churn",
        normalizedKeyword: "reduce churn",
        deterministicEvidence: {
          sourceOccurrenceIds: [ids.occurrenceB],
          providerSearchIntent: null,
          currentTopicKey: null,
          currentPageKey: null,
        },
      },
    ],
  };
}

function output(): KeywordGovernanceSuggestionStructuredOutput {
  return {
    schemaVersion: "keyword-governance-suggestion-output.v1",
    suggestions: [
      {
        keywordKey: "keyword-2",
        status: "approved",
        intent: "informational",
        buyerStage: "awareness",
        topicKey: "topic-2",
        mappingDecision: "new_asset",
        pageKey: null,
        reason: "No supplied Page matches this query.",
      },
      {
        keywordKey: "keyword-1",
        status: "approved",
        intent: null,
        buyerStage: "decision",
        topicKey: "topic-2",
        mappingDecision: "existing_page",
        pageKey: "page-2",
        reason: "The supplied authority supports approval.",
      },
    ],
  };
}

function resolve(
  structuredOutput: unknown = output(),
) {
  return resolveKeywordGovernanceSuggestions({
    manifest: manifest(),
    output: structuredOutput,
    suggestionIdsByKeywordId: {
      [ids.keywordA]: ids.suggestionA,
      [ids.keywordB]: ids.suggestionB,
    },
  });
}

describe("keyword governance suggestion resolution", () => {
  it("preserves provider intent and exact current Topic/Page before model inference", () => {
    const resolved = resolve();

    expect(resolved.map((row) => row.keywordId)).toEqual([
      ids.keywordA,
      ids.keywordB,
    ]);
    expect(resolved[0]).toEqual({
      suggestionId: ids.suggestionA,
      ordinal: 1,
      keywordId: ids.keywordA,
      expectedGovernanceRevision: 4,
      suggestionVersion: "keyword-governance-suggestion.v1",
      status: "approved",
      intent: "commercial",
      buyerStage: "decision",
      topicNodeId: ids.topicA,
      topicModelRevision: 7,
      mappingDecision: "existing_page",
      mappedSitePageId: ids.pageA,
      reason: "The supplied authority supports approval.",
      intentAuthority: "provider_observed",
      intentSnapshotId: ids.snapshot,
      intentObservationId: ids.observation,
      intentObservedAt: "2026-08-10T01:02:03.000Z",
    });
    expect(resolved[1]).toMatchObject({
      suggestionId: ids.suggestionB,
      ordinal: 2,
      keywordId: ids.keywordB,
      intent: "informational",
      topicNodeId: ids.topicB,
      topicModelRevision: 7,
      mappingDecision: "new_asset",
      mappedSitePageId: null,
      intentAuthority: "llm_generated",
      intentSnapshotId: null,
      intentObservationId: null,
      intentObservedAt: null,
    });
  });

  it.each([
    ["missing", { ...output(), suggestions: [output().suggestions[0]] }],
    [
      "duplicate",
      {
        ...output(),
        suggestions: [output().suggestions[0], output().suggestions[0]],
      },
    ],
    [
      "extra",
      {
        ...output(),
        suggestions: [
          ...output().suggestions,
          { ...output().suggestions[0], keywordKey: "keyword-extra" },
        ],
      },
    ],
    [
      "unknown Page",
      {
        ...output(),
        suggestions: output().suggestions.map((row, index) =>
          index === 0
            ? {
                ...row,
                mappingDecision: "existing_page" as const,
                pageKey: "page-unknown",
              }
            : row,
        ),
      },
    ],
    [
      "invented fact",
      {
        ...output(),
        suggestions: output().suggestions.map((row, index) =>
          index === 0 ? { ...row, searchVolume: 50_000 } : row,
        ),
      },
    ],
    [
      "unsafe text",
      {
        ...output(),
        suggestions: output().suggestions.map((row, index) =>
          index === 0 ? { ...row, reason: "javascript:alert(1)" } : row,
        ),
      },
    ],
    [
      "non-canonical buyer stage",
      {
        ...output(),
        suggestions: output().suggestions.map((row, index) =>
          index === 0 ? { ...row, buyerStage: "research" } : row,
        ),
      },
    ],
  ])("fails the whole batch for %s", (_label, structuredOutput) => {
    expect(() => resolve(structuredOutput)).toThrow();
  });

  it("rejects a final current-Page mapping when no Topic resolves", () => {
    const corruptManifest = manifest();
    corruptManifest.candidates[0]!.deterministicEvidence.currentTopicKey = null;
    const unassignedOutput = output();
    unassignedOutput.suggestions[1] = {
      ...unassignedOutput.suggestions[1]!,
      topicKey: null,
      mappingDecision: "unassigned",
      pageKey: null,
    };

    expect(() =>
      resolveKeywordGovernanceSuggestions({
        manifest: corruptManifest,
        output: unassignedOutput,
        suggestionIdsByKeywordId: {
          [ids.keywordA]: ids.suggestionA,
          [ids.keywordB]: ids.suggestionB,
        },
      }),
    ).toThrow(/Current Page key requires current Topic|mapped suggestion.*Topic/u);
  });

  it("rejects a generated new-asset mapping without a Topic", () => {
    const invalidOutput = output();
    invalidOutput.suggestions[0] = {
      ...invalidOutput.suggestions[0]!,
      topicKey: null,
      mappingDecision: "new_asset",
      pageKey: null,
    };

    expect(() => resolve(invalidOutput)).toThrow();
  });
});
