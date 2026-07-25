import { describe, expect, it } from "vitest";
import {
  CONTENT_SHADOW_ADAPTER_CONTRACT_VERSION,
  CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
  ContentShadowRunResponse,
  CreateContentShadowRunRequest,
} from "./content-shadow.ts";

const KEYWORD = "00000000-0000-4000-8000-00000000000a";
const GENERATIVE = "00000000-0000-4000-8000-00000000001a";
const ACTION = "00000000-0000-4000-8000-000000000002";

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
        body({ capabilityContractVersion: "content-shadow.0.4.0" }),
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
      competitorEntityIds: [],
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
    },
    research: null,
    draft: null,
    qa: null,
  };

  it("accepts a queued run with no child projections yet", () => {
    expect(ContentShadowRunResponse.safeParse(response).success).toBe(true);
  });

  it("has no publish surface at all (Slice 2 red line D)", () => {
    expect(JSON.stringify(ContentShadowRunResponse.shape)).not.toMatch(
      /publish/i,
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
});
