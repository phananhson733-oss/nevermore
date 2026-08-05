import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOpportunitiesQueryOptions,
  getProjectOpportunities,
  getProjectOpportunityDetail,
  opportunitiesQueryKey,
  opportunityDetailQueryKey,
} from "./hooks-opportunities";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const SITE_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";
const FINDING_ID = "00000000-0000-4000-8000-000000000004";
const EVIDENCE_ID = "00000000-0000-4000-8000-000000000005";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000006";
const COLLECTION_ID = "00000000-0000-4000-8000-000000000007";
const SITE_PAGE_ID = "00000000-0000-4000-8000-000000000008";
const PAGE_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000009";

const executionPreview = {
  templateId: "improve_content_coverage.v1",
  templateVersion: 1,
  artifactType: "content_brief",
  effort: "medium",
  risk: "low",
  contentLocale: "en",
  title: "Improve content coverage for priority intent",
  description:
    "Expand an existing page to cover missing questions and decision criteria.",
  expectedOutcome:
    "The page more completely satisfies the priority search intent.",
} as const;

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function reviewableOpportunity() {
  return {
    opportunityKey: "url:/customer-onboarding/:CONTENT-COVERAGE-001",
    title: "Make the onboarding page a citation-ready answer asset",
    workShape: "improve",
    primaryTarget: "url",
    targetRef: "https://example.com/customer-onboarding/",
    evidenceSummary: [
      {
        traceKind: "evidence",
        evidenceId: EVIDENCE_ID,
        diagnosticRunId: RUN_ID,
        snapshotId: SNAPSHOT_ID,
        collectionRunId: COLLECTION_ID,
        analysisInvocationId: null,
        sourceProvider: "crawl",
        availability: "available",
        support: "supports",
        observedAt: "2026-07-21T08:00:00.000Z",
        freshness: "current",
        claim: "The owned page lacks a concise answer block.",
        limitation: "Single immutable crawl snapshot.",
      },
    ],
    searchQueries: [],
    generativeQueries: [],
    competitorRefs: [],
    currentOwnedAsset: {
      sitePageId: SITE_PAGE_ID,
      snapshotId: PAGE_SNAPSHOT_ID,
      url: "https://example.com/customer-onboarding/",
      suitableForIntent: true,
    },
    supportingFindingIds: [],
    lenses: ["demand_competition"],
    coverageAndLimitations: ["Single immutable crawl snapshot."],
    readiness: "reviewable",
    primaryFindingId: FINDING_ID,
    primaryRule: { ruleId: "CONTENT-COVERAGE-001", ruleVersion: 1 },
    executionPreview,
  };
}

function listResponse() {
  return {
    projectId: PROJECT_ID,
    siteId: SITE_ID,
    diagnosticRunId: RUN_ID,
    data: [reviewableOpportunity()],
    meta: { limit: 50, nextCursor: null, hasNext: false },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opportunity query keys", () => {
  it("include the UI locale and normalized query", () => {
    expect(opportunitiesQueryKey(PROJECT_ID, "en", { limit: 25 })).toEqual([
      "opportunities",
      PROJECT_ID,
      "en",
      "list",
      { cursor: null, limit: 25 },
    ]);
    expect(opportunityDetailQueryKey(PROJECT_ID, "en", FINDING_ID)).toEqual([
      "opportunities",
      PROJECT_ID,
      "en",
      "detail",
      FINDING_ID,
    ]);
  });

  it("reject an out-of-range limit before any fetch", () => {
    expect(() =>
      buildOpportunitiesQueryOptions(PROJECT_ID, "en", { limit: 101 }),
    ).toThrow(RangeError);
  });
});

describe("opportunity fetchers", () => {
  it("re-validate every listed opportunity against the contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(listResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getProjectOpportunities(PROJECT_ID, { limit: 25 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      readiness: "reviewable",
      primaryFindingId: FINDING_ID,
      executionPreview,
    });
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain(
      "/projects/" + PROJECT_ID + "/opportunities",
    );
    expect(requestedUrl).toContain("limit=25");
  });

  it("re-validate the selected opportunity against the contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ok({
        projectId: PROJECT_ID,
        siteId: SITE_ID,
        diagnosticRunId: RUN_ID,
        data: reviewableOpportunity(),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getProjectOpportunityDetail(PROJECT_ID, FINDING_ID);
    expect(result.data.readiness).toBe("reviewable");
    if (result.data.readiness !== "reviewable") {
      throw new Error("fixture requires a reviewable Opportunity");
    }
    expect(result.data.executionPreview).toEqual(executionPreview);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/opportunities/" + FINDING_ID,
    );
  });

  it("reject a malformed listed opportunity", async () => {
    const broken = listResponse();
    const first = broken.data[0];
    if (!first) throw new Error("fixture requires one opportunity");
    first.primaryRule.ruleVersion = 2; // CONTENT rules pin to v1
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(broken)));
    await expect(getProjectOpportunities(PROJECT_ID)).rejects.toThrow();
  });
});
