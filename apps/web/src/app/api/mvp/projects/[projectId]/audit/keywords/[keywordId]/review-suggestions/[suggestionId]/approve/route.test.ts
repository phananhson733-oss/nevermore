import { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  approveProjectAuditKeywordReviewSuggestion: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map-keywords", () => ({
  approveProjectAuditKeywordReviewSuggestion:
    mocks.approveProjectAuditKeywordReviewSuggestion,
}));

const { POST } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const keywordId = "00000000-0000-4000-8000-000000000004";
const suggestionId = "00000000-0000-4000-8000-000000000005";
const body = {
  expectedGovernanceRevision: 2,
  suggestionVersion: "keyword-governance-suggestion.v1",
} as const;

function invoke(
  requestBody: unknown = body,
  params: {
    readonly projectId: string;
    readonly keywordId: string;
    readonly suggestionId: string;
  } = { projectId, keywordId, suggestionId },
  query = "",
) {
  return POST(
    new NextRequest(
      `http://localhost/api/mvp/projects/${params.projectId}/audit/keywords/${params.keywordId}/review-suggestions/${params.suggestionId}/approve${query}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "x-request-id": "request-approve-keyword-suggestion",
        },
        body: JSON.stringify(requestBody),
      },
    ),
    { params: Promise.resolve(params) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.approveProjectAuditKeywordReviewSuggestion.mockResolvedValue({
    projectId,
    diagnosticRunId: null,
    data: { keywordId, revision: 3, pendingSuggestion: null },
  });
});

describe("POST approve one Growth Map Keyword review suggestion", () => {
  it("passes only the strict command and the server-resolved actor scope", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(
      mocks.approveProjectAuditKeywordReviewSuggestion,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "00000000-0000-4000-8000-000000000002",
        actorId: "00000000-0000-4000-8000-000000000001",
        logger: expect.objectContaining({ error: expect.any(Function) }),
      }),
      projectId,
      keywordId,
      suggestionId,
      body,
    );
    await expect(response.json()).resolves.toEqual({
      data: {
        projectId,
        diagnosticRunId: null,
        data: { keywordId, revision: 3, pendingSuggestion: null },
      },
    });
  });

  it("rejects client-authored governance, lineage, and actor fields", async () => {
    const response = await invoke({
      ...body,
      status: "approved",
      topicNodeId: "00000000-0000-4000-8000-000000000099",
      analysisInvocationId: "00000000-0000-4000-8000-000000000098",
      actorId: "00000000-0000-4000-8000-000000000097",
    });

    expect(response.status).toBe(422);
    expect(
      mocks.approveProjectAuditKeywordReviewSuggestion,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["projectId", { projectId: "private-project", keywordId, suggestionId }],
    ["keywordId", { projectId, keywordId: "private-keyword", suggestionId }],
    ["suggestionId", { projectId, keywordId, suggestionId: "private-suggestion" }],
  ])("rejects a malformed %s before service access", async (_name, params) => {
    const response = await invoke(body, params);

    expect(response.status).toBe(404);
    expect(
      mocks.approveProjectAuditKeywordReviewSuggestion,
    ).not.toHaveBeenCalled();
  });

  it("rejects every query parameter", async () => {
    const response = await invoke(body, undefined, "?diagnosticRunId=private");

    expect(response.status).toBe(422);
    expect(
      mocks.approveProjectAuditKeywordReviewSuggestion,
    ).not.toHaveBeenCalled();
  });

  it("preserves an exact stale-revision conflict", async () => {
    mocks.approveProjectAuditKeywordReviewSuggestion.mockRejectedValueOnce(
      new ProblemError(
        "STALE_REVISION",
        "Keyword review suggestion is stale.",
        {
          current: {
            kind: "revision_conflict",
            resource: "keyword_review",
            projectId,
            resourceId: keywordId,
            expectedRevision: 2,
            currentRevision: 3,
          },
        },
      ),
    );

    const response = await invoke();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "STALE_REVISION",
      current: {
        kind: "revision_conflict",
        resource: "keyword_review",
        projectId,
        resourceId: keywordId,
        expectedRevision: 2,
        currentRevision: 3,
      },
    });
  });
});
