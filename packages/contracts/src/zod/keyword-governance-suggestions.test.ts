import { describe, expect, it } from "vitest";

import {
  ApproveKeywordReviewSuggestionRequest,
  KeywordGovernancePendingSuggestion,
  KeywordGovernanceSuggestionInputManifest,
  KEYWORD_GOVERNANCE_SUGGESTION_MANIFEST_FIELDS,
  KeywordGovernanceSuggestionStructuredOutput,
  parseKeywordGovernanceSuggestionStructuredOutput,
} from "./keyword-governance-suggestions.ts";

const ids = {
  project: "81000000-0000-4000-8000-000000000001",
  workspace: "81000000-0000-4000-8000-000000000012",
  profile: "81000000-0000-4000-8000-000000000002",
  topicRevision: "81000000-0000-4000-8000-000000000003",
  topic: "81000000-0000-4000-8000-000000000004",
  page: "81000000-0000-4000-8000-000000000005",
  keyword: "81000000-0000-4000-8000-000000000006",
  occurrence: "81000000-0000-4000-8000-000000000007",
  snapshot: "81000000-0000-4000-8000-000000000008",
  observation: "81000000-0000-4000-8000-000000000009",
  suggestion: "81000000-0000-4000-8000-000000000010",
  invocation: "81000000-0000-4000-8000-000000000011",
} as const;

const hash = "a".repeat(64);

const manifest = {
  schemaVersion: "keyword-governance-suggestion-input.v1",
  generationVersion: "keyword-governance-suggestion-generation.v1",
  promptSetVersion: "keyword-governance-suggestion.prompt.v1",
  projectId: ids.project,
  workspaceId: ids.workspace,
  marketCode: "US",
  languageTag: "en",
  confirmedProductProfile: {
    productProfileId: ids.profile,
    version: 3,
    contentHash: hash,
    facts: {
      productName: "Acme",
      category: "Revenue automation",
      valueProposition: "Connect revenue workflows",
      targetAudience: "B2B revenue teams",
      buyerRoles: ["VP Revenue"],
      pains: ["Fragmented workflows"],
      outcomes: ["Faster handoffs"],
    },
  },
  confirmedTopicModel: {
    topicModelRevisionId: ids.topicRevision,
    revision: 2,
    contentHash: hash,
  },
  topicAllowlist: [
    {
      topicKey: "topic-001",
      topicNodeId: ids.topic,
      topicModelRevision: 2,
      label: "Revenue automation",
    },
  ],
  pageAllowlist: [
    {
      pageKey: "page-001",
      sitePageId: ids.page,
      normalizedUrl: "https://example.test/revenue-automation",
      title: "Revenue automation",
    },
  ],
  candidates: [
    {
      ordinal: 1,
      keywordKey: "keyword-001",
      keywordId: ids.keyword,
      queryKind: "search_query",
      expectedGovernanceRevision: 4,
      displayKeyword: "Revenue automation software",
      normalizedKeyword: "revenue automation software",
      deterministicEvidence: {
        sourceOccurrenceIds: [ids.occurrence],
        providerSearchIntent: {
          value: "commercial",
          snapshotId: ids.snapshot,
          observationId: ids.observation,
          observedAt: "2026-08-10T08:00:00Z",
        },
        currentTopicKey: "topic-001",
        currentPageKey: "page-001",
      },
    },
  ],
} as const;

const output = {
  schemaVersion: "keyword-governance-suggestion-output.v1",
  suggestions: [
    {
      keywordKey: "keyword-001",
      status: "approved",
      intent: null,
      buyerStage: "consideration",
      topicKey: "topic-001",
      mappingDecision: "existing_page",
      pageKey: "page-001",
      reason: "The confirmed Topic and owned page match this keyword.",
    },
  ],
} as const;

const pendingSuggestion = {
  suggestionId: ids.suggestion,
  suggestionVersion: "keyword-governance-suggestion.v1",
  state: "pending_ready",
  expectedGovernanceRevision: 4,
  status: "approved",
  intent: "commercial",
  buyerStage: "consideration",
  topicNodeId: ids.topic,
  topicModelRevision: 2,
  topicLabel: "Revenue automation",
  mappingDecision: "existing_page",
  mappedSitePageId: ids.page,
  mappedSitePageTitle: "Revenue automation",
  reason: "The confirmed Topic and owned page match this keyword.",
  readinessReason: "all_authorities_confirmed",
  limitation: null,
  lineage: {
    generationVersion: "keyword-governance-suggestion-generation.v1",
    promptSetVersion: "keyword-governance-suggestion.prompt.v1",
    authority: "llm_generated",
    analysisInvocationId: ids.invocation,
  },
  intentLineage: {
    authority: "provider_observed",
    snapshotId: ids.snapshot,
    observationId: ids.observation,
    analysisInvocationId: null,
    observedAt: "2026-08-10T08:00:00Z",
  },
  createdAt: "2026-08-10T08:01:00Z",
} as const;

describe("Keyword governance suggestion contracts", () => {
  it("keeps the manifest field inventory exact and self-hash-free", () => {
    expect(Object.keys(KeywordGovernanceSuggestionInputManifest.shape)).toEqual(
      KEYWORD_GOVERNANCE_SUGGESTION_MANIFEST_FIELDS,
    );
    expect(KEYWORD_GOVERNANCE_SUGGESTION_MANIFEST_FIELDS).not.toContain("inputHash");
  });
  it("accepts one exact bounded frozen manifest", () => {
    expect(KeywordGovernanceSuggestionInputManifest.parse(manifest)).toEqual(
      manifest,
    );
  });

  it("rejects unordered, duplicate, non-search-query, unresolved and unbounded manifest input", () => {
    for (const invalid of [
      {
        ...manifest,
        candidates: [{ ...manifest.candidates[0], ordinal: 2 }],
      },
      {
        ...manifest,
        candidates: [manifest.candidates[0], manifest.candidates[0]],
      },
      {
        ...manifest,
        candidates: [
          { ...manifest.candidates[0], queryKind: "generative_query" },
        ],
      },
      {
        ...manifest,
        candidates: [
          {
            ...manifest.candidates[0],
            deterministicEvidence: {
              ...manifest.candidates[0].deterministicEvidence,
              currentTopicKey: "topic-999",
            },
          },
        ],
      },
      {
        ...manifest,
        candidates: Array.from({ length: 101 }, (_, index) => ({
          ...manifest.candidates[0],
          ordinal: index + 1,
          keywordKey: `keyword-${String(index + 1).padStart(3, "0")}`,
          keywordId: `81000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
        })),
      },
    ]) {
      expect(
        KeywordGovernanceSuggestionInputManifest.safeParse(invalid).success,
      ).toBe(false);
    }
  });

  it("keeps frozen provider evidence exact and rejects client/model-owned additions", () => {
    expect(
      KeywordGovernanceSuggestionInputManifest.safeParse({
        ...manifest,
        candidates: [
          {
            ...manifest.candidates[0],
            deterministicEvidence: {
              ...manifest.candidates[0].deterministicEvidence,
              analysisInvocationId: ids.invocation,
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      KeywordGovernanceSuggestionInputManifest.safeParse({
        ...manifest,
        inputHash: hash,
      }).success,
    ).toBe(false);
    expect(
      KeywordGovernanceSuggestionInputManifest.safeParse({
        ...manifest,
        workspaceId: undefined,
      }).success,
    ).toBe(false);
    expect(
      KeywordGovernanceSuggestionInputManifest.safeParse({
        ...manifest,
        candidates: [
          {
            ...manifest.candidates[0],
            deterministicEvidence: {
              ...manifest.candidates[0].deterministicEvidence,
              providerSearchIntent: {
                ...manifest.candidates[0].deterministicEvidence.providerSearchIntent,
                value: "awareness",
              },
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      KeywordGovernanceSuggestionInputManifest.safeParse({
        ...manifest,
        rawProviderPayload: {},
      }).success,
    ).toBe(false);
  });

  it("accepts one strict model result for every prompt-local Keyword key", () => {
    expect(KeywordGovernanceSuggestionStructuredOutput.parse(output)).toEqual(
      output,
    );
    expect(
      parseKeywordGovernanceSuggestionStructuredOutput(output, manifest),
    ).toEqual(output);
  });

  it("fails closed for missing, extra, duplicate or unresolved prompt-local keys", () => {
    for (const invalid of [
      { ...output, suggestions: [] },
      {
        ...output,
        suggestions: [
          output.suggestions[0],
          { ...output.suggestions[0], keywordKey: "keyword-002" },
        ],
      },
      {
        ...output,
        suggestions: [output.suggestions[0], output.suggestions[0]],
      },
      {
        ...output,
        suggestions: [
          { ...output.suggestions[0], topicKey: "topic-999" },
        ],
      },
      {
        ...output,
        suggestions: [{ ...output.suggestions[0], pageKey: "page-999" }],
      },
    ]) {
      expect(() =>
        parseKeywordGovernanceSuggestionStructuredOutput(invalid, manifest),
      ).toThrow();
    }
  });

  it("rejects excluded or provider-overriding model governance", () => {
    for (const invalid of [
      {
        ...output,
        suggestions: [{ ...output.suggestions[0], status: "excluded", topicKey: "topic-001" }],
      },
      {
        ...output,
        suggestions: [{ ...output.suggestions[0], status: "excluded", mappingDecision: "existing_page", pageKey: "page-001" }],
      },
      {
        ...output,
        suggestions: [{ ...output.suggestions[0], intent: "transactional" }],
      },
      {
        ...output,
        suggestions: [{ ...output.suggestions[0], intent: "awareness" }],
      },
      {
        ...output,
        suggestions: [{ ...output.suggestions[0], reason: "ok" }],
      },
    ]) {
      expect(() =>
        parseKeywordGovernanceSuggestionStructuredOutput(invalid, manifest),
      ).toThrow();
    }
    expect(() =>
      parseKeywordGovernanceSuggestionStructuredOutput(
        {
          ...output,
          suggestions: [{ ...output.suggestions[0], intent: "awareness" }],
        },
        {
          ...manifest,
          candidates: [
            {
              ...manifest.candidates[0],
              deterministicEvidence: {
                ...manifest.candidates[0].deterministicEvidence,
                providerSearchIntent: null,
              },
            },
          ],
        },
      ),
    ).toThrow();
  });

  it("rejects DB identities, provider facts, actors and timestamps from model output", () => {
    for (const extra of [
      { topicNodeId: ids.topic },
      { mappedSitePageId: ids.page },
      { providerSearchIntent: "commercial" },
      { actorId: ids.invocation },
      { createdAt: "2026-08-10T08:00:00Z" },
    ]) {
      expect(
        KeywordGovernanceSuggestionStructuredOutput.safeParse({
          ...output,
          suggestions: [{ ...output.suggestions[0], ...extra }],
        }).success,
      ).toBe(false);
    }
  });

  it("accepts a ready customer-safe suggestion with separate provider and model lineage", () => {
    expect(KeywordGovernancePendingSuggestion.parse(pendingSuggestion)).toEqual(
      pendingSuggestion,
    );
  });

  it("rejects 1-2 character reasons in structured output and ready pending suggestions", () => {
    expect(() =>
      parseKeywordGovernanceSuggestionStructuredOutput(
        {
          ...output,
          suggestions: [{ ...output.suggestions[0], reason: "ok" }],
        },
        {
          ...manifest,
          candidates: [
            {
              ...manifest.candidates[0],
              deterministicEvidence: {
                ...manifest.candidates[0].deterministicEvidence,
                providerSearchIntent: null,
              },
            },
          ],
        },
      ),
    ).toThrow();
    expect(
      KeywordGovernancePendingSuggestion.safeParse({
        ...pendingSuggestion,
        reason: "ok",
      }).success,
    ).toBe(false);
  });

  it("rejects incomplete ready suggestions and excluded assignment residue", () => {
    for (const invalid of [
      { ...pendingSuggestion, mappingDecision: null },
      { ...pendingSuggestion, intentLineage: null },
      { ...pendingSuggestion, status: "excluded" },
      {
        ...pendingSuggestion,
        status: "excluded",
        topicNodeId: null,
        topicModelRevision: null,
        topicLabel: null,
        mappingDecision: "unassigned",
        mappedSitePageId: ids.page,
      },
    ]) {
      expect(KeywordGovernancePendingSuggestion.safeParse(invalid).success).toBe(false);
    }
    expect(
      KeywordGovernancePendingSuggestion.safeParse({
        ...pendingSuggestion,
        status: "excluded",
        topicNodeId: null,
        topicModelRevision: null,
        topicLabel: null,
        mappingDecision: "unassigned",
        mappedSitePageId: null,
        mappedSitePageTitle: null,
      }).success,
    ).toBe(true);
  });

  it("requires successful invocation lineage for LLM fields and never mixes provider facts with it", () => {
    expect(
      KeywordGovernancePendingSuggestion.safeParse({
        ...pendingSuggestion,
        lineage: {
          ...pendingSuggestion.lineage,
          analysisInvocationId: null,
        },
      }).success,
    ).toBe(false);
    expect(
      KeywordGovernancePendingSuggestion.safeParse({
        ...pendingSuggestion,
        intentLineage: {
          ...pendingSuggestion.intentLineage,
          analysisInvocationId: ids.invocation,
        },
      }).success,
    ).toBe(false);
    expect(
      KeywordGovernancePendingSuggestion.safeParse({
        ...pendingSuggestion,
        intentLineage: {
          authority: "llm_generated",
          snapshotId: ids.snapshot,
          observationId: null,
          analysisInvocationId: ids.invocation,
          observedAt: null,
        },
      }).success,
    ).toBe(false);
  });

  it("keeps generating, needs-review, stale and unavailable states deterministic", () => {
    const emptySuggestion = {
      ...pendingSuggestion,
      status: null,
      intent: null,
      buyerStage: null,
      topicNodeId: null,
      topicModelRevision: null,
      topicLabel: null,
      mappingDecision: null,
      mappedSitePageId: null,
      mappedSitePageTitle: null,
      reason: null,
      lineage: null,
      intentLineage: null,
    } as const;
    expect(
      KeywordGovernancePendingSuggestion.safeParse({
        ...emptySuggestion,
        state: "generating",
        readinessReason: "generation_in_progress",
        limitation: "The bounded suggestion job is still running.",
      }).success,
    ).toBe(true);
    expect(
      KeywordGovernancePendingSuggestion.safeParse({
        ...pendingSuggestion,
        state: "pending_needs_review",
        readinessReason: "insufficient_authority",
        limitation: "The suggested Page needs customer confirmation.",
      }).success,
    ).toBe(true);
    expect(
      KeywordGovernancePendingSuggestion.safeParse({
        ...pendingSuggestion,
        state: "stale",
        readinessReason: "governance_revision_changed",
        limitation: "The Keyword revision changed after generation.",
      }).success,
    ).toBe(true);
    expect(
      KeywordGovernancePendingSuggestion.safeParse({
        ...emptySuggestion,
        state: "unavailable",
        readinessReason: "authority_unavailable",
        limitation: "Confirmed Topic authority is unavailable.",
      }).success,
    ).toBe(true);
  });

  it("exposes only revision and suggestion version in the approval command", () => {
    const request = {
      expectedGovernanceRevision: 4,
      suggestionVersion: "keyword-governance-suggestion.v1",
    } as const;
    expect(ApproveKeywordReviewSuggestionRequest.parse(request)).toEqual(
      request,
    );
    expect(
      ApproveKeywordReviewSuggestionRequest.safeParse({
        ...request,
        actorId: ids.invocation,
      }).success,
    ).toBe(false);
  });
});
