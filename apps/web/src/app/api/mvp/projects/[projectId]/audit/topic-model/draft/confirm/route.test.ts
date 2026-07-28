import { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceAttemptRateLimit: vi.fn(),
  confirmProjectAuditTopicModelDraft: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "83000000-0000-4000-8000-000000000001",
    workspaceId: "83000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceAttemptRateLimit:
    mocks.assertWorkspaceAttemptRateLimit,
}));

vi.mock("@/lib/services/growth-map-topic-model", () => ({
  confirmProjectAuditTopicModelDraft:
    mocks.confirmProjectAuditTopicModelDraft,
}));

const { POST } = await import("./route");

const projectId = "83000000-0000-4000-8000-000000000003";
const confirmBody = {
  topicModelRevision: 1,
  expectedEditRevision: 2,
  reason: "Customer approved the reviewed Topic Model.",
};

function invoke(
  body: unknown = confirmBody,
  selectedProjectId = projectId,
) {
  return POST(
    new NextRequest(
      `http://localhost/api/mvp/projects/${selectedProjectId}/audit/topic-model/draft/confirm`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "x-request-id": "request-confirm-topic-model",
        },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ projectId: selectedProjectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertWorkspaceAttemptRateLimit.mockResolvedValue(undefined);
  mocks.confirmProjectAuditTopicModelDraft.mockResolvedValue({
    projectId,
    topicModelRevision: 1,
    state: "confirmed",
  });
});

describe("POST confirm Growth Map Topic Model draft", () => {
  it("passes only the confirmed revision and server-resolved actor scope", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.assertWorkspaceAttemptRateLimit).toHaveBeenCalledWith(
      "83000000-0000-4000-8000-000000000002",
      {
        scope: `topic-model-mutation:${projectId}`,
        maxAttempts: 30,
        windowMs: 60 * 1_000,
      },
    );
    expect(
      mocks.confirmProjectAuditTopicModelDraft,
    ).toHaveBeenCalledWith(
      {
        workspaceId: "83000000-0000-4000-8000-000000000002",
        actorId: "83000000-0000-4000-8000-000000000001",
      },
      projectId,
      confirmBody,
    );
  });

  it("rejects widened input without consuming an attempt", async () => {
    const response = await invoke({
      ...confirmBody,
      actorId: "83000000-0000-4000-8000-000000000099",
      contentHash: "client-authored",
    });

    expect(response.status).toBe(422);
    expect(
      mocks.assertWorkspaceAttemptRateLimit,
    ).not.toHaveBeenCalled();
    expect(
      mocks.confirmProjectAuditTopicModelDraft,
    ).not.toHaveBeenCalled();
  });

  it("rejects malformed project identity without consuming an attempt", async () => {
    const response = await invoke(
      confirmBody,
      "customer-private-project",
    );

    expect(response.status).toBe(404);
    expect(
      mocks.assertWorkspaceAttemptRateLimit,
    ).not.toHaveBeenCalled();
    expect(
      mocks.confirmProjectAuditTopicModelDraft,
    ).not.toHaveBeenCalled();
  });

  it("does not call the service when the workspace is rate limited", async () => {
    mocks.assertWorkspaceAttemptRateLimit.mockRejectedValueOnce(
      new ProblemError("RATE_LIMITED", "Too many Topic Model edits.", {
        headers: { "Retry-After": "60" },
      }),
    );

    const response = await invoke();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(
      mocks.confirmProjectAuditTopicModelDraft,
    ).not.toHaveBeenCalled();
  });
});
