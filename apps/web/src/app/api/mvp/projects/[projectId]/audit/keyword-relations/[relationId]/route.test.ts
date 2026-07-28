import { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOperatorContext: vi.fn(),
  assertWorkspaceAttemptRateLimit: vi.fn(),
  decideProjectAuditKeywordRelation: vi.fn(),
  getProjectAuditKeywordRelation: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: mocks.getOperatorContext,
}));

vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceAttemptRateLimit:
    mocks.assertWorkspaceAttemptRateLimit,
}));

vi.mock("@/lib/services/growth-map-keyword-relations", () => ({
  decideProjectAuditKeywordRelation:
    mocks.decideProjectAuditKeywordRelation,
  getProjectAuditKeywordRelation:
    mocks.getProjectAuditKeywordRelation,
}));

const { GET, PATCH } = await import("./route");

const ids = {
  actor: "95000000-0000-4000-8000-000000000001",
  workspace: "95000000-0000-4000-8000-000000000002",
  project: "95000000-0000-4000-8000-000000000003",
  relation: "95000000-0000-4000-8000-000000000004",
  candidate: "95000000-0000-4000-8000-000000000005",
  keywordA: "95000000-0000-4000-8000-000000000006",
  keywordB: "95000000-0000-4000-8000-000000000007",
} as const;

const decisionBody = {
  expectedRelationRevision: 0,
  candidateId: ids.candidate,
  decisionKind: "primary_supporting",
  primaryKeywordId: ids.keywordA,
  supportingKeywordId: ids.keywordB,
  reason: "Use the first phrase as the primary Keyword.",
} as const;

function url(
  projectId: string = ids.project,
  relationId: string = ids.relation,
  query = "",
): string {
  return `http://localhost/api/mvp/projects/${projectId}/audit/keyword-relations/${relationId}${query}`;
}

function getRequest(
  projectId: string = ids.project,
  relationId: string = ids.relation,
  query = "",
) {
  return new NextRequest(url(projectId, relationId, query), {
    headers: {
      "x-request-id": "request-keyword-relation-detail",
    },
  });
}

function patchRequest(
  body: unknown = decisionBody,
  projectId: string = ids.project,
  relationId: string = ids.relation,
  query = "",
) {
  return new NextRequest(url(projectId, relationId, query), {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "x-request-id": "request-keyword-relation-decision",
    },
    body: JSON.stringify(body),
  });
}

function params(
  projectId: string = ids.project,
  relationId: string = ids.relation,
) {
  return { params: Promise.resolve({ projectId, relationId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOperatorContext.mockResolvedValue({
    userId: ids.actor,
    workspaceId: ids.workspace,
  });
  mocks.assertWorkspaceAttemptRateLimit.mockResolvedValue(undefined);
  mocks.getProjectAuditKeywordRelation.mockResolvedValue({
    projectId: ids.project,
    data: { relationId: ids.relation },
  });
  mocks.decideProjectAuditKeywordRelation.mockResolvedValue({
    data: { relationId: ids.relation },
    replayed: false,
  });
});

describe("GET Growth Map Keyword Relation detail", () => {
  it("uses only the server workspace and exact path identities", async () => {
    const response = await GET(getRequest(), params());

    expect(response.status).toBe(200);
    expect(
      mocks.getProjectAuditKeywordRelation,
    ).toHaveBeenCalledWith(
      { workspaceId: ids.workspace },
      ids.project,
      ids.relation,
    );
  });

  it("rejects query injection and malformed path identities before service access", async () => {
    const queryResponse = await GET(
      getRequest(
        ids.project,
        ids.relation,
        "?workspaceId=customer-private-workspace",
      ),
      params(),
    );
    expect(queryResponse.status).toBe(422);

    const malformedResponse = await GET(
      getRequest(ids.project, "customer-private-relation"),
      params(ids.project, "customer-private-relation"),
    );
    expect(malformedResponse.status).toBe(404);
    expect(
      mocks.getProjectAuditKeywordRelation,
    ).not.toHaveBeenCalled();
  });
});

describe("PATCH Growth Map Keyword Relation decision", () => {
  it("passes strict decision input with the server-resolved actor", async () => {
    const response = await PATCH(patchRequest(), params());

    expect(response.status).toBe(200);
    expect(
      mocks.assertWorkspaceAttemptRateLimit,
    ).toHaveBeenCalledWith(ids.workspace, {
      scope: `keyword-relation-mutation:${ids.project}`,
      maxAttempts: 30,
      windowMs: 60 * 1_000,
    });
    expect(
      mocks.decideProjectAuditKeywordRelation,
    ).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, actorId: ids.actor },
      ids.project,
      ids.relation,
      decisionBody,
    );
  });

  it.each([
    [
      "widened body",
      patchRequest({
        ...decisionBody,
        decidedBy: "customer-private-actor",
        decidedAt: "2026-01-01T00:00:00.000Z",
      }),
    ],
    [
      "query injection",
      patchRequest(
        decisionBody,
        ids.project,
        ids.relation,
        "?actorId=customer-private-actor",
      ),
    ],
  ])(
    "rejects %s before rate limiting or service access",
    async (_label, request) => {
      const response = await PATCH(request, params());

      expect(response.status).toBe(422);
      expect(
        mocks.assertWorkspaceAttemptRateLimit,
      ).not.toHaveBeenCalled();
      expect(
        mocks.decideProjectAuditKeywordRelation,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["project", "customer-private-project", ids.relation],
    ["relation", ids.project, "customer-private-relation"],
  ])(
    "rejects malformed %s identity before consuming an attempt",
    async (_label, projectId, relationId) => {
      const response = await PATCH(
        patchRequest(decisionBody, projectId, relationId),
        params(projectId, relationId),
      );

      expect(response.status).toBe(404);
      expect(
        mocks.assertWorkspaceAttemptRateLimit,
      ).not.toHaveBeenCalled();
      expect(
        mocks.decideProjectAuditKeywordRelation,
      ).not.toHaveBeenCalled();
    },
  );

  it("does not decide when the workspace mutation budget is exhausted", async () => {
    mocks.assertWorkspaceAttemptRateLimit.mockRejectedValueOnce(
      new ProblemError("RATE_LIMITED", "Too many relation decisions.", {
        headers: { "Retry-After": "60" },
      }),
    );

    const response = await PATCH(patchRequest(), params());

    expect(response.status).toBe(429);
    expect(
      mocks.decideProjectAuditKeywordRelation,
    ).not.toHaveBeenCalled();
  });
});
