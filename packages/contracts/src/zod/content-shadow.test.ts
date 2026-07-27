import { describe, expect, it } from "vitest";
import {
  CONTENT_SHADOW_ADAPTER_CONTRACT_VERSION,
  CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
  ContentShadowAuthoritySource,
  ContentShadowRunResponse,
  CreateContentShadowRunRequest,
} from "./content-shadow.ts";

const KEYWORD = "00000000-0000-4000-8000-00000000000a";
const GENERATIVE = "00000000-0000-4000-8000-00000000001a";
const ACTION = "00000000-0000-4000-8000-000000000002";
const PAGE_SNAPSHOT = "00000000-0000-4000-8000-00000000002a";
const DATA_SNAPSHOT = "00000000-0000-4000-8000-00000000002b";
const COMPETITOR = "00000000-0000-4000-8000-00000000002c";

function body(overrides: Record<string, unknown> = {}) {
  return {
    actionId: ACTION,
    searchCluster: { clusterKey: "growth", keywordEntityIds: [KEYWORD] },
    outputLocale: "en",
    capabilityContractVersion: CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
    ...overrides,
  };
}

describe("CreateContentShadowRunRequest", () => {
  it("accepts the minimal frozen request and defaults the optional sets", () => {
    const parsed = CreateContentShadowRunRequest.parse(body());

    expect(parsed.competitorEntityIds).toEqual([]);
    expect(parsed.generativeQueryEntityIds).toEqual([]);
    expect(parsed.contentBriefRevision).toBeUndefined();
  });

  it("rejects an unknown field", () => {
    expect(
      CreateContentShadowRunRequest.safeParse(body({ publish: true })).success,
    ).toBe(false);
  });

  it("rejects a foreign capability contract version", () => {
    expect(
      CreateContentShadowRunRequest.safeParse(
        body({ capabilityContractVersion: "content-shadow.0.3.0" }),
      ).success,
    ).toBe(false);
  });

  it("refuses an operator-chosen flow adapter version", () => {
    expect(
      CreateContentShadowRunRequest.safeParse(
        body({ flowAdapterVersion: "content-shadow-adapter.9.9.9" }),
      ).success,
    ).toBe(false);
    expect(
      CreateContentShadowRunRequest.safeParse(
        body({ flowAdapterVersion: CONTENT_SHADOW_ADAPTER_CONTRACT_VERSION }),
      ).success,
    ).toBe(true);
  });

  it("keeps search and generative observation separate (invariant 8)", () => {
    const result = CreateContentShadowRunRequest.safeParse(
      body({ generativeQueryEntityIds: [KEYWORD] }),
    );

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/must stay separate/);
  });

  it("accepts a disjoint generative set", () => {
    expect(
      CreateContentShadowRunRequest.safeParse(
        body({ generativeQueryEntityIds: [GENERATIVE] }),
      ).success,
    ).toBe(true);
  });

  it("requires at least one keyword in the frozen cluster", () => {
    expect(
      CreateContentShadowRunRequest.safeParse(
        body({ searchCluster: { clusterKey: "growth", keywordEntityIds: [] } }),
      ).success,
    ).toBe(false);
  });

  it("rejects duplicate identities inside a set", () => {
    expect(
      CreateContentShadowRunRequest.safeParse(
        body({
          searchCluster: {
            clusterKey: "growth",
            keywordEntityIds: [KEYWORD, KEYWORD],
          },
        }),
      ).success,
    ).toBe(false);
  });
});

describe("ContentShadowRunResponse", () => {
  const response = {
    flowShadowRunId: "00000000-0000-4000-8000-000000000010",
    projectId: "00000000-0000-4000-8000-000000000011",
    siteId: "00000000-0000-4000-8000-000000000012",
    asyncRunId: "00000000-0000-4000-8000-000000000013",
    status: "queued" as const,
    phase: "queued" as const,
    contentHash: "a".repeat(64),
    projectionVersion: "content-shadow.0.3.0",
    flowAdapterVersion: CONTENT_SHADOW_ADAPTER_CONTRACT_VERSION,
    outputLocale: "en",
    createdAt: "2026-07-25T00:00:00.000Z",
    source: {
      findingId: "00000000-0000-4000-8000-000000000014",
      actionId: ACTION,
      contentBriefArtifactId: "00000000-0000-4000-8000-000000000015",
      contentBriefRevision: 1,
    },
    frozenInputs: {
      primaryFindingId: "00000000-0000-4000-8000-000000000014",
      sourceDiagnosticRunId: "00000000-0000-4000-8000-000000000016",
      competitorEntityIds: [COMPETITOR],
      searchCluster: { clusterKey: "growth", keywordEntityIds: [KEYWORD] },
      generativeQueryEntityIds: [],
      firstParty: {
        siteOrigin: "https://acme.example",
        icpPrimaryConversionUrl: null,
      },
      contentBriefOutline: {
        briefSections: ["Objective"],
        targetKeywords: ["growth analytics"],
        pageAssignment: "existing_page" as const,
      },
      researchContext: {
        firstPartyPageSnapshots: [
          {
            pageSnapshotId: PAGE_SNAPSHOT,
            dataSnapshotId: DATA_SNAPSHOT,
            url: "https://acme.example/growth",
            urlHash: "b".repeat(64),
            contentHash: "c".repeat(64),
            capturedAt: "2026-07-24T00:00:00.000Z",
          },
        ],
        searchKeywordFacts: [
          {
            id: KEYWORD,
            display: "growth analytics",
            market: "US",
            language: "en",
            intent: "commercial",
            buyerStage: "consideration",
            cluster: "growth",
            mapping: {
              decision: "existing_page",
              mappedSitePageId: "00000000-0000-4000-8000-00000000002d",
              reviewState: "confirmed",
              revision: 2,
            },
            lastSeen: "2026-07-24T00:00:00.000Z",
            evidenceRefs: ["keyword-occurrence:kw-1"],
          },
        ],
        generativeKeywordFacts: [],
        competitorFacts: [
          {
            id: COMPETITOR,
            domain: "competitor.example",
            name: "Competitor",
            status: "approved",
            relationship: "direct",
            scopes: ["content", "keyword_gap"],
            revision: 3,
          },
        ],
        externalTargets: [
          {
            ref: "competitor-root:competitor.example",
            kind: "competitor_root",
            url: "https://competitor.example/",
            label: "Competitor",
          },
        ],
        contentPolicy: {
          brandConstraints: ["Use a calm, practical voice."],
          complianceConstraints: ["Qualify forward-looking statements."],
          prohibitedTerms: ["guaranteed"],
          claimRestrictions: [
            "no_guarantees",
            "no_unsupported_quantified_claims",
          ],
        },
      },
    },
    research: null,
    draft: null,
    qa: null,
  };

  it("accepts a queued run with no child projections yet", () => {
    expect(ContentShadowRunResponse.safeParse(response).success).toBe(true);
  });

  it("has no publish surface at all (Slice 2 red line D)", () => {
    expect(Object.keys(ContentShadowRunResponse.shape)).not.toContain(
      "publish",
    );
    expect(Object.keys(ContentShadowRunResponse.shape)).not.toContain(
      "publication",
    );
    expect(
      ContentShadowRunResponse.safeParse({
        ...response,
        draft: {
          artifactId: "00000000-0000-4000-8000-000000000015",
          status: "published",
          currentRevision: 1,
          contentText: null,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown top-level field", () => {
    expect(
      ContentShadowRunResponse.safeParse({ ...response, cmsUrl: "https://x" })
        .success,
    ).toBe(false);
  });

  it("rejects duplicate or empty frozen identity sets instead of normalizing them", () => {
    expect(
      ContentShadowRunResponse.safeParse({
        ...response,
        frozenInputs: {
          ...response.frozenInputs,
          searchCluster: {
            ...response.frozenInputs.searchCluster,
            keywordEntityIds: [KEYWORD, KEYWORD],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      ContentShadowRunResponse.safeParse({
        ...response,
        frozenInputs: {
          ...response.frozenInputs,
          searchCluster: {
            ...response.frozenInputs.searchCluster,
            keywordEntityIds: [],
          },
          researchContext: {
            ...response.frozenInputs.researchContext,
            searchKeywordFacts: [],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      ContentShadowRunResponse.safeParse({
        ...response,
        frozenInputs: {
          ...response.frozenInputs,
          competitorEntityIds: [COMPETITOR, COMPETITOR],
          researchContext: {
            ...response.frozenInputs.researchContext,
            competitorFacts: [
              ...response.frozenInputs.researchContext.competitorFacts,
              ...response.frozenInputs.researchContext.competitorFacts,
            ],
          },
        },
      }).success,
    ).toBe(false);
  });

  it("exposes a strict, body-free research source summary", () => {
    const source = {
      kind: "external_page" as const,
      ref: "competitor-root:competitor.example",
      label: "Competitor",
      url: "https://competitor.example/",
      availability: "partial" as const,
      authorityTier: "B" as const,
      capturedAt: "2026-07-25T00:00:00.000Z",
      contentHash: "d".repeat(64),
      contentHashMethod: "sha256_normalized_text" as const,
      contentTruncated: true,
      excerpt: "A bounded customer-readable excerpt.",
      excerptTruncated: true,
      metrics: {
        status: 200,
        contentType: "text/html",
        bodyBytes: 1234,
        wordCount: 182,
        responseMs: 245,
        redirectChain: ["https://competitor.example/"],
      },
      evidenceRefs: ["competitor-root:competitor.example"],
      limitation: null,
    };
    const parsed = ContentShadowRunResponse.parse({
      ...response,
      phase: "research",
      research: {
        packId: "00000000-0000-4000-8000-000000000040",
        sources: [source],
        limitations: [],
        generatedAt: "2026-07-25T00:00:00.000Z",
      },
    });

    expect(parsed.research?.sources[0]).toEqual(source);
    expect(parsed.research?.sources[0]).not.toHaveProperty("contentText");
    expect(
      ContentShadowRunResponse.safeParse({
        ...response,
        research: {
          packId: "00000000-0000-4000-8000-000000000040",
          sources: [{ ...source, contentText: "full retrieved page body" }],
          limitations: [],
          generatedAt: "2026-07-25T00:00:00.000Z",
        },
      }).success,
    ).toBe(false);
  });

  it("accepts the full 1,200-source pack and 100 refs per source, then rejects one over either bound", () => {
    const source = {
      kind: "external_page" as const,
      ref: "target:capacity",
      label: "Capacity source",
      url: "https://authority.example/capacity",
      availability: "available" as const,
      authorityTier: "B" as const,
      capturedAt: "2026-07-25T00:00:00.000Z",
      contentHash: "d".repeat(64),
      contentHashMethod: "sha256_normalized_text" as const,
      contentTruncated: false,
      excerpt: "Bounded excerpt.",
      excerptTruncated: true,
      metrics: null,
      evidenceRefs: Array.from({ length: 100 }, (_, index) => `ref:${index}`),
      limitation: null,
    };
    expect(ContentShadowAuthoritySource.safeParse(source).success).toBe(true);
    expect(
      ContentShadowAuthoritySource.safeParse({
        ...source,
        evidenceRefs: [...source.evidenceRefs, "ref:overflow"],
      }).success,
    ).toBe(false);

    const research = {
      packId: "00000000-0000-4000-8000-000000000040",
      limitations: [],
      generatedAt: "2026-07-25T00:00:00.000Z",
    };
    expect(
      ContentShadowRunResponse.safeParse({
        ...response,
        research: {
          ...research,
          sources: Array.from({ length: 1200 }, () => source),
        },
      }).success,
    ).toBe(true);
    expect(
      ContentShadowRunResponse.safeParse({
        ...response,
        research: {
          ...research,
          sources: Array.from({ length: 1201 }, () => source),
        },
      }).success,
    ).toBe(false);
  });

  it("rejects incoherent research hashes, truncation flags and non-HTTP(S) URLs", () => {
    const source = {
      kind: "external_page" as const,
      ref: "target:coherence",
      label: "Coherence source",
      url: "https://authority.example/report",
      availability: "partial" as const,
      authorityTier: "B" as const,
      capturedAt: "2026-07-25T00:00:00.000Z",
      contentHash: "d".repeat(64),
      contentHashMethod: "sha256_normalized_text" as const,
      contentTruncated: true,
      excerpt: "Bounded excerpt.",
      excerptTruncated: true,
      metrics: null,
      evidenceRefs: [],
      limitation: "The retained body and customer preview are bounded.",
    };

    expect(ContentShadowAuthoritySource.safeParse(source).success).toBe(true);
    expect(
      ContentShadowAuthoritySource.safeParse({
        ...source,
        contentHashMethod: null,
      }).success,
    ).toBe(false);
    expect(
      ContentShadowAuthoritySource.safeParse({
        ...source,
        contentHash: null,
      }).success,
    ).toBe(false);
    expect(
      ContentShadowAuthoritySource.safeParse({
        ...source,
        availability: "available",
      }).success,
    ).toBe(false);
    expect(
      ContentShadowAuthoritySource.safeParse({
        ...source,
        contentHash: null,
        contentHashMethod: null,
      }).success,
    ).toBe(false);
    expect(
      ContentShadowAuthoritySource.safeParse({
        ...source,
        excerpt: null,
      }).success,
    ).toBe(false);
    expect(
      ContentShadowAuthoritySource.safeParse({
        ...source,
        availability: "unavailable",
        contentTruncated: false,
      }).success,
    ).toBe(false);
    expect(
      ContentShadowAuthoritySource.safeParse({
        ...source,
        url: "ftp://authority.example/report",
      }).success,
    ).toBe(false);
    expect(
      ContentShadowAuthoritySource.safeParse({
        ...source,
        url: "https://user:secret@authority.example/report",
      }).success,
    ).toBe(false);
  });

  it("accepts a complete newest-first revision history and rejects an ambiguous order", () => {
    const revisions = [
      {
        revision: 2,
        contentHash: "e".repeat(64),
        generatedBy: "human",
        editorId: "00000000-0000-4000-8000-000000000050",
        note: "Tightened proof language.",
        validationErrorCount: 0,
        createdAt: "2026-07-25T02:00:00.000Z",
      },
      {
        revision: 1,
        contentHash: "f".repeat(64),
        generatedBy: "llm",
        editorId: null,
        note: null,
        validationErrorCount: 0,
        createdAt: "2026-07-25T01:00:00.000Z",
      },
    ];
    const draft = {
      artifactId: "00000000-0000-4000-8000-000000000015",
      status: "draft" as const,
      currentRevision: 2,
      contentText: "# Current",
      revisionHistory: revisions,
    };

    expect(
      ContentShadowRunResponse.safeParse({ ...response, draft }).success,
    ).toBe(true);
    expect(
      ContentShadowRunResponse.safeParse({
        ...response,
        draft: { ...draft, revisionHistory: [...revisions].reverse() },
      }).success,
    ).toBe(false);
    expect(
      ContentShadowRunResponse.safeParse({
        ...response,
        draft: {
          ...draft,
          revisionHistory: [revisions[0], revisions[0]],
        },
      }).success,
    ).toBe(false);
    expect(
      ContentShadowRunResponse.safeParse({
        ...response,
        draft: {
          ...draft,
          currentRevision: 3,
          revisionHistory: [
            { ...revisions[0], revision: 3 },
            revisions[1],
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      ContentShadowRunResponse.safeParse({
        ...response,
        draft: {
          ...draft,
          currentRevision: 3,
          revisionHistory: [
            { ...revisions[0], revision: 3 },
            { ...revisions[1], revision: 2 },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
