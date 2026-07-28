import { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceAttemptRateLimit: vi.fn(),
  beginProjectAuditTopicModelDraft: vi.fn(),
  patchProjectAuditTopicModelDraft: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "82000000-0000-4000-8000-000000000001",
    workspaceId: "82000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceAttemptRateLimit:
    mocks.assertWorkspaceAttemptRateLimit,
}));

vi.mock("@/lib/services/growth-map-topic-model", () => ({
  beginProjectAuditTopicModelDraft:
    mocks.beginProjectAuditTopicModelDraft,
  patchProjectAuditTopicModelDraft:
    mocks.patchProjectAuditTopicModelDraft,
}));

const { PATCH, POST } = await import("./route");

const projectId = "82000000-0000-4000-8000-000000000003";
const topicNodeId = "82000000-0000-4000-8000-000000000004";
const scope = {
  workspaceId: "82000000-0000-4000-8000-000000000002",
  actorId: "82000000-0000-4000-8000-000000000001",
};
const rateLimitPolicy = {
  scope: `topic-model-mutation:${projectId}`,
  maxAttempts: 30,
  windowMs: 60 * 1_000,
};
const beginBody = {
  expectedLatestConfirmedRevision: 0,
  reason: "Create the initial customer-reviewed Topic Model.",
};
const patchBody = {
  topicModelRevision: 1,
  expectedEditRevision: 0,
  reason: "Add the initial customer onboarding topic.",
  intents: [
    {
      kind: "create",
      parentTopicNodeId: null,
      label: "Customer onboarding",
      description: null,
      intentEnvelope: ["commercial"],
    },
  ],
} as const;
const retireBody = {
  topicModelRevision: 2,
  expectedEditRevision: 4,
  reason: "Delete an obsolete leaf Topic from the customer map.",
  intents: [
    {
      kind: "retire",
      topicNodeId,
      affectedKeywordReviewState: "unreviewed",
    },
  ],
} as const;

function request(
  method: "POST" | "PATCH",
  body: unknown,
  selectedProjectId = projectId,
) {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${selectedProjectId}/audit/topic-model/draft`,
    {
      method,
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        "x-request-id": `request-topic-model-${method.toLowerCase()}`,
      },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertWorkspaceAttemptRateLimit.mockResolvedValue(undefined);
  mocks.beginProjectAuditTopicModelDraft.mockResolvedValue({
    projectId,
    topicModelRevision: 1,
    state: "draft",
  });
  mocks.patchProjectAuditTopicModelDraft.mockResolvedValue({
    projectId,
    topicModelRevision: 1,
    editRevision: 1,
    state: "draft",
  });
});

describe("POST Growth Map Topic Model draft", () => {
  it("passes only validated input and the server-resolved actor scope", async () => {
    const response = await POST(request("POST", beginBody), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.assertWorkspaceAttemptRateLimit).toHaveBeenCalledWith(
      scope.workspaceId,
      rateLimitPolicy,
    );
    expect(mocks.beginProjectAuditTopicModelDraft).toHaveBeenCalledWith(
      scope,
      projectId,
      beginBody,
    );
    expect(
      mocks.assertWorkspaceAttemptRateLimit.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.beginProjectAuditTopicModelDraft.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    );
  });

  it("rejects widened or malformed input without consuming an attempt", async () => {
    const response = await POST(
      request("POST", {
        ...beginBody,
        actorId: scope.actorId,
        generationBasis: "client-authored",
      }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(422);
    expect(
      mocks.assertWorkspaceAttemptRateLimit,
    ).not.toHaveBeenCalled();
    expect(
      mocks.beginProjectAuditTopicModelDraft,
    ).not.toHaveBeenCalled();
  });

  it("rejects malformed project identity without consuming an attempt", async () => {
    const response = await POST(
      request("POST", beginBody, "customer-private-project"),
      {
        params: Promise.resolve({
          projectId: "customer-private-project",
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(
      mocks.assertWorkspaceAttemptRateLimit,
    ).not.toHaveBeenCalled();
    expect(
      mocks.beginProjectAuditTopicModelDraft,
    ).not.toHaveBeenCalled();
  });

  it("does not call the service when the workspace is rate limited", async () => {
    mocks.assertWorkspaceAttemptRateLimit.mockRejectedValueOnce(
      new ProblemError("RATE_LIMITED", "Too many Topic Model edits.", {
        headers: { "Retry-After": "60" },
      }),
    );

    const response = await POST(request("POST", beginBody), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(
      mocks.beginProjectAuditTopicModelDraft,
    ).not.toHaveBeenCalled();
  });
});

describe("PATCH Growth Map Topic Model draft", () => {
  it("passes revision-checked intents and the server-resolved actor scope", async () => {
    const response = await PATCH(request("PATCH", patchBody), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.assertWorkspaceAttemptRateLimit).toHaveBeenCalledWith(
      scope.workspaceId,
      rateLimitPolicy,
    );
    expect(mocks.patchProjectAuditTopicModelDraft).toHaveBeenCalledWith(
      scope,
      projectId,
      patchBody,
    );
  });

  it("passes customer delete as a strict history-preserving retire intent", async () => {
    const response = await PATCH(request("PATCH", retireBody), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.patchProjectAuditTopicModelDraft).toHaveBeenCalledWith(
      scope,
      projectId,
      retireBody,
    );
  });

  it("rejects retirement without the mandatory Keyword re-review state", async () => {
    const response = await PATCH(
      request("PATCH", {
        ...retireBody,
        intents: [
          {
            kind: "retire",
            topicNodeId,
          },
        ],
      }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(422);
    expect(
      mocks.assertWorkspaceAttemptRateLimit,
    ).not.toHaveBeenCalled();
    expect(
      mocks.patchProjectAuditTopicModelDraft,
    ).not.toHaveBeenCalled();
  });

  it("rejects client-authored node identity without consuming an attempt", async () => {
    const response = await PATCH(
      request("PATCH", {
        ...patchBody,
        intents: [
          {
            ...patchBody.intents[0],
            topicNodeId,
          },
        ],
      }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(422);
    expect(
      mocks.assertWorkspaceAttemptRateLimit,
    ).not.toHaveBeenCalled();
    expect(
      mocks.patchProjectAuditTopicModelDraft,
    ).not.toHaveBeenCalled();
  });

  it("does not call the service when the workspace is rate limited", async () => {
    mocks.assertWorkspaceAttemptRateLimit.mockRejectedValueOnce(
      new ProblemError("RATE_LIMITED", "Too many Topic Model edits.", {
        headers: { "Retry-After": "60" },
      }),
    );

    const response = await PATCH(request("PATCH", patchBody), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(429);
    expect(
      mocks.patchProjectAuditTopicModelDraft,
    ).not.toHaveBeenCalled();
  });
});
