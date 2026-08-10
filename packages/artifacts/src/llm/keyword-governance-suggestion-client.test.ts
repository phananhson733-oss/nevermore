import type {
  KeywordGovernanceSuggestionInputManifest,
  KeywordGovernanceSuggestionStructuredOutput,
} from "@sf/contracts";
import { describe, expect, it, vi } from "vitest";
import { ANALYSIS_INVOCATION_TASKS } from "../types.ts";
import {
  KEYWORD_GOVERNANCE_SUGGESTION_PROMPT_SET_VERSION,
  createOpenAIKeywordGovernanceSuggestionClient,
  prepareKeywordGovernanceSuggestionGeneration,
  type KeywordGovernanceSuggestionTransport,
} from "./keyword-governance-suggestion-client.ts";
import { LLMError } from "./openai-client.ts";

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
        valueProposition: "Turn product signals into timely actions.",
        targetAudience: "B2B SaaS product teams",
        buyerRoles: ["VP Product"],
        pains: ["Fragmented product signals"],
        outcomes: ["Higher activation"],
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
        expectedGovernanceRevision: 3,
        displayKeyword: "customer activation automation",
        normalizedKeyword: "customer activation automation",
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
        displayKeyword: "reduce customer churn",
        normalizedKeyword: "reduce customer churn",
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

const validOutput: KeywordGovernanceSuggestionStructuredOutput = {
  schemaVersion: "keyword-governance-suggestion-output.v1",
  suggestions: [
    {
      keywordKey: "keyword-1",
      status: "approved",
      intent: null,
      buyerStage: "decision",
      topicKey: "topic-2",
      mappingDecision: "existing_page",
      pageKey: "page-2",
      reason: "Strong fit with the supplied activation evidence.",
    },
    {
      keywordKey: "keyword-2",
      status: "approved",
      intent: "informational",
      buyerStage: "awareness",
      topicKey: "topic-2",
      mappingDecision: "new_asset",
      pageKey: null,
      reason: "The supplied page allowlist does not cover this intent.",
    },
  ],
};

function fakeTransport(
  output: unknown = validOutput,
): KeywordGovernanceSuggestionTransport & {
  readonly complete: ReturnType<typeof vi.fn>;
} {
  return {
    complete: vi.fn().mockResolvedValue({
      content: typeof output === "string" ? output : JSON.stringify(output),
      usage: { inputTokens: 47, outputTokens: 29 },
    }),
  };
}

function client(transport: KeywordGovernanceSuggestionTransport) {
  return createOpenAIKeywordGovernanceSuggestionClient({
    apiKey: "fake-api-key",
    model: "gpt-4.1-mini",
    transport,
  });
}

function sentContext(transport: ReturnType<typeof fakeTransport>): unknown {
  const call = transport.complete.mock.calls[0] as [
    { readonly system: string; readonly user: string },
  ];
  return JSON.parse(
    call[0].user
      .split("<UNTRUSTED_KEYWORD_GOVERNANCE_DATA>\n")[1]!
      .split("\n</UNTRUSTED_KEYWORD_GOVERNANCE_DATA>")[0]!,
  );
}

describe("keyword governance suggestion structured client", () => {
  it("uses the internal async invocation discriminator", () => {
    expect(ANALYSIS_INVOCATION_TASKS).toContain(
      "keyword_governance_suggestion_generation",
    );
  });

  it("sends bounded prompt-local authority without stable IDs, hashes or timestamps", async () => {
    const transport = fakeTransport();
    const result = await client(transport).generateKeywordGovernanceSuggestions(
      manifest(),
    );

    const [messages] = transport.complete.mock.calls[0] as [
      { readonly system: string; readonly user: string },
    ];
    expect(messages.system).toContain(
      "buyerStage must be awareness, consideration, decision, retention, or null.",
    );
    expect(messages.user).toContain(
      '"buyerStage":"awareness | consideration | decision | retention | null"',
    );

    expect(sentContext(transport)).toEqual({
      schemaVersion: "keyword-governance-suggestion-prompt.v1",
      marketCode: "US",
      languageTag: "en-US",
      productProfile: manifest().confirmedProductProfile.facts,
      topics: [
        { topicKey: "topic-1", label: "Activation" },
        { topicKey: "topic-2", label: "Retention" },
      ],
      pages: [
        {
          pageKey: "page-1",
          normalizedUrl: "https://relayops.example/activation",
          title: "Activation",
        },
        {
          pageKey: "page-2",
          normalizedUrl: "https://relayops.example/retention",
          title: "Retention",
        },
      ],
      candidates: [
        {
          keywordKey: "keyword-1",
          displayKeyword: "customer activation automation",
          normalizedKeyword: "customer activation automation",
          providerSearchIntent: "commercial",
          currentTopicKey: "topic-1",
          currentPageKey: "page-1",
        },
        {
          keywordKey: "keyword-2",
          displayKeyword: "reduce customer churn",
          normalizedKeyword: "reduce customer churn",
          providerSearchIntent: null,
          currentTopicKey: null,
          currentPageKey: null,
        },
      ],
    });
    expect(JSON.stringify(sentContext(transport))).not.toMatch(
      /00000000-|[ab]{64}|2026-08-10T/u,
    );
    expect(result.output).toEqual(validOutput);
    expect(result.invocation).toMatchObject({
      task: "keyword_governance_suggestion_generation",
      provider: "openai",
      model: "gpt-4.1-mini",
      promptSetVersion: KEYWORD_GOVERNANCE_SUGGESTION_PROMPT_SET_VERSION,
      status: "succeeded",
      inputHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      outputHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      inputTokens: 47,
      outputTokens: 29,
    });
  });

  it("hashes only the canonical provider projection deterministically", () => {
    const original = manifest();
    const reordered = {
      ...original,
      confirmedProductProfile: {
        ...original.confirmedProductProfile,
        facts: {
          outcomes: original.confirmedProductProfile.facts.outcomes,
          pains: original.confirmedProductProfile.facts.pains,
          buyerRoles: original.confirmedProductProfile.facts.buyerRoles,
          targetAudience:
            original.confirmedProductProfile.facts.targetAudience,
          valueProposition:
            original.confirmedProductProfile.facts.valueProposition,
          category: original.confirmedProductProfile.facts.category,
          productName: original.confirmedProductProfile.facts.productName,
        },
      },
    };
    expect(prepareKeywordGovernanceSuggestionGeneration(original)).toEqual(
      prepareKeywordGovernanceSuggestionGeneration(reordered),
    );

    const privateAuthorityChanged: KeywordGovernanceSuggestionInputManifest = {
      ...original,
      workspaceId: "10000000-0000-4000-8000-000000000001",
      projectId: "10000000-0000-4000-8000-000000000002",
      confirmedProductProfile: {
        ...original.confirmedProductProfile,
        productProfileId: "10000000-0000-4000-8000-000000000003",
        version: 9,
        contentHash: "c".repeat(64),
      },
      confirmedTopicModel: {
        topicModelRevisionId: "10000000-0000-4000-8000-000000000004",
        revision: 9,
        contentHash: "d".repeat(64),
      },
      topicAllowlist: original.topicAllowlist.map((topic, index) => ({
        ...topic,
        topicNodeId: `10000000-0000-4000-8000-${String(index + 5).padStart(12, "0")}`,
        topicModelRevision: 9,
      })),
      pageAllowlist: original.pageAllowlist.map((page, index) => ({
        ...page,
        sitePageId: `10000000-0000-4000-8000-${String(index + 7).padStart(12, "0")}`,
      })),
      candidates: original.candidates.map((candidate, index) => ({
        ...candidate,
        keywordId: `10000000-0000-4000-8000-${String(index + 9).padStart(12, "0")}`,
        expectedGovernanceRevision: 20 + index,
        deterministicEvidence: {
          ...candidate.deterministicEvidence,
          sourceOccurrenceIds: [
            `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          ],
          providerSearchIntent:
            candidate.deterministicEvidence.providerSearchIntent === null
              ? null
              : {
                  ...candidate.deterministicEvidence.providerSearchIntent,
                  snapshotId: "20000000-0000-4000-8000-000000000003",
                  observationId: "20000000-0000-4000-8000-000000000004",
                  observedAt: "2026-08-10T05:06:07.000Z",
                },
        },
      })),
    };
    expect(
      prepareKeywordGovernanceSuggestionGeneration(privateAuthorityChanged),
    ).toEqual(prepareKeywordGovernanceSuggestionGeneration(original));

    const changedPrompt: KeywordGovernanceSuggestionInputManifest = {
      ...original,
      candidates: original.candidates.map((candidate, index) =>
        index === 0
          ? { ...candidate, displayKeyword: "customer retention automation" }
          : candidate,
      ),
    };
    expect(
      prepareKeywordGovernanceSuggestionGeneration(changedPrompt).inputHash,
    ).not.toBe(
      prepareKeywordGovernanceSuggestionGeneration(original).inputHash,
    );
  });

  it.each([
    [
      "missing",
      { ...validOutput, suggestions: [validOutput.suggestions[0]] },
    ],
    [
      "duplicate",
      {
        ...validOutput,
        suggestions: [
          validOutput.suggestions[0],
          validOutput.suggestions[0],
        ],
      },
    ],
    [
      "extra",
      {
        ...validOutput,
        suggestions: [
          ...validOutput.suggestions,
          { ...validOutput.suggestions[1], keywordKey: "keyword-extra" },
        ],
      },
    ],
    [
      "unresolved Topic",
      {
        ...validOutput,
        suggestions: validOutput.suggestions.map((row, index) =>
          index === 1 ? { ...row, topicKey: "topic-unknown" } : row,
        ),
      },
    ],
    [
      "invented provider fact",
      {
        ...validOutput,
        suggestions: validOutput.suggestions.map((row, index) =>
          index === 1
            ? { ...row, providerSearchIntent: "transactional" }
            : row,
        ),
      },
    ],
    [
      "unsafe reason",
      {
        ...validOutput,
        suggestions: validOutput.suggestions.map((row, index) =>
          index === 1 ? { ...row, reason: "<script>alert(1)</script>" } : row,
        ),
      },
    ],
    [
      "non-canonical generated intent",
      {
        ...validOutput,
        suggestions: validOutput.suggestions.map((row, index) =>
          index === 1 ? { ...row, intent: "research" } : row,
        ),
      },
    ],
    [
      "too-short reason",
      {
        ...validOutput,
        suggestions: validOutput.suggestions.map((row, index) =>
          index === 1 ? { ...row, reason: "ok" } : row,
        ),
      },
    ],
  ])("rejects the whole batch for %s output", async (_label, output) => {
    const error = await client(fakeTransport(output))
      .generateKeywordGovernanceSuggestions(manifest())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LLMError);
    expect((error as LLMError).invocation).toMatchObject({
      task: "keyword_governance_suggestion_generation",
      status: "rejected",
      outputHash: null,
    });
  });
});
