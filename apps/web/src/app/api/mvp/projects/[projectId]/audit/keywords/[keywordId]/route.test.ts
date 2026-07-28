import { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAuditKeyword: vi.fn(),
  reviewProjectAuditKeyword: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map-keywords", () => ({
  getProjectAuditKeyword: mocks.getProjectAuditKeyword,
  reviewProjectAuditKeyword: mocks.reviewProjectAuditKeyword,
}));

const { GET, PATCH } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const keywordId = "00000000-0000-4000-8000-000000000004";

function invoke(selectedKeywordId = keywordId) {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/audit/keywords/${selectedKeywordId}`,
      { headers: { "X-Request-Id": "request-growth-map-keyword" } },
    ),
    {
      params: Promise.resolve({ projectId, keywordId: selectedKeywordId }),
    },
  );
}

const review = {
  expectedGovernanceRevision: 2,
  status: "approved",
  intent: "commercial",
  buyerStage: "consideration",
  topicNodeId: "00000000-0000-4000-8000-000000000005",
  topicModelRevision: 3,
  mappingDecision: "existing_page",
  mappedSitePageId: "00000000-0000-4000-8000-000000000006",
  reason: "Confirmed against the current Topic Model.",
} as const;

function invokePatch(
  body: unknown = review,
  selectedKeywordId = keywordId,
) {
  return PATCH(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/audit/keywords/${selectedKeywordId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "X-Request-Id": "request-review-growth-map-keyword",
        },
        body: JSON.stringify(body),
      },
    ),
    {
      params: Promise.resolve({ projectId, keywordId: selectedKeywordId }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditKeyword.mockResolvedValue({
    projectId,
    data: { keywordId },
  });
  mocks.reviewProjectAuditKeyword.mockResolvedValue({
    projectId,
    data: { keywordId, mapping: { revision: 3 } },
  });
});

describe("GET selected Growth Map Keyword", () => {
  it("scopes the exact Keyword lookup to the operator workspace", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditKeyword).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      keywordId,
    );
    await expect(response.json()).resolves.toEqual({
      data: { projectId, data: { keywordId } },
    });
  });

  it("rejects a malformed Keyword id as not found before service access", async () => {
    const response = await invoke("customer-private-keyword");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(JSON.stringify(body)).not.toContain("customer-private-keyword");
    expect(mocks.getProjectAuditKeyword).not.toHaveBeenCalled();
  });
});

describe("PATCH selected Growth Map Keyword review", () => {
  it("passes strict governance fields and server-resolved actor scope", async () => {
    const response = await invokePatch();

    expect(response.status).toBe(200);
    expect(mocks.reviewProjectAuditKeyword).toHaveBeenCalledWith(
      {
        workspaceId: "00000000-0000-4000-8000-000000000002",
        actorId: "00000000-0000-4000-8000-000000000001",
      },
      projectId,
      keywordId,
      review,
    );
    await expect(response.json()).resolves.toEqual({
      data: {
        projectId,
        data: { keywordId, mapping: { revision: 3 } },
      },
    });
  });

  it("rejects client-authored labels, actors, and widened fields", async () => {
    const response = await invokePatch({
      ...review,
      clusterKey: "client-authored-topic",
      actorId: "00000000-0000-4000-8000-000000000099",
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(mocks.reviewProjectAuditKeyword).not.toHaveBeenCalled();
  });

  it("rejects malformed Keyword identity before service access", async () => {
    const response = await invokePatch(review, "customer-private-keyword");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(mocks.reviewProjectAuditKeyword).not.toHaveBeenCalled();
  });

  it("preserves structured revision conflicts", async () => {
    mocks.reviewProjectAuditKeyword.mockRejectedValueOnce(
      new ProblemError(
        "STALE_REVISION",
        "Keyword review revision is stale.",
        {
          current: {
            kind: "revision_conflict",
            resource: "keyword_review",
            projectId,
            resourceId: keywordId,
            expectedRevision: 2,
            currentRevision: 4,
          },
        },
      ),
    );

    const response = await invokePatch();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "STALE_REVISION",
      status: 409,
      current: {
        kind: "revision_conflict",
        resource: "keyword_review",
        projectId,
        resourceId: keywordId,
        expectedRevision: 2,
        currentRevision: 4,
      },
    });
  });
});
