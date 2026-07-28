import { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  reconcilePublicationAttempt: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceRateLimit: mocks.assertWorkspaceRateLimit,
}));
vi.mock("@/lib/services/publication-attempts", () => ({
  reconcilePublicationAttempt: mocks.reconcilePublicationAttempt,
}));

const { POST } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000003";
const publicationAttemptId =
  "00000000-0000-4000-8000-000000000004";

function request(body: unknown = {}, key = "reconcile-route-key") {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/publications/attempts/${publicationAttemptId}/reconcile`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        Origin: "http://localhost",
        "X-Request-Id": "request-publication-reconcile",
      },
      body: JSON.stringify(body),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST publication reconciliation", () => {
  it("returns a deterministic unavailable boundary and never claims a queued run", async () => {
    mocks.reconcilePublicationAttempt.mockRejectedValueOnce(
      new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "发布结果自动核验尚未启用；当前不会创建或排队任何核验任务。",
      ),
    );

    const response = await POST(request(), {
      params: Promise.resolve({ projectId, publicationAttemptId }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Location")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
    expect(mocks.reconcilePublicationAttempt).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      publicationAttemptId,
      "00000000-0000-4000-8000-000000000001",
      "reconcile-route-key",
      {},
    );
    expect(mocks.assertWorkspaceRateLimit).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      {
        idempotencyKey: "reconcile-route-key",
        scope: "publication_reconcile",
        maxAttempts: 20,
        windowMs: 15 * 60 * 1000,
      },
    );
  });

  it("rejects browser-supplied provider observations before the unsupported boundary", async () => {
    const response = await POST(
      request({ remoteRevision: "browser-asserted-success" }),
      {
        params: Promise.resolve({ projectId, publicationAttemptId }),
      },
    );

    expect(response.status).toBe(422);
    expect(mocks.reconcilePublicationAttempt).not.toHaveBeenCalled();
  });

  it("requires Idempotency-Key before rate limiting", async () => {
    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/publications/attempts/${publicationAttemptId}/reconcile`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost",
          },
          body: "{}",
        },
      ),
      { params: Promise.resolve({ projectId, publicationAttemptId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.reconcilePublicationAttempt).not.toHaveBeenCalled();
  });
});
