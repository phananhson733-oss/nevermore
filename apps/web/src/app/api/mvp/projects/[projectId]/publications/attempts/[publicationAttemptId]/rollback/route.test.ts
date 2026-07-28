import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  createPublicationRollbackAttempt: vi.fn(),
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
  createPublicationRollbackAttempt:
    mocks.createPublicationRollbackAttempt,
}));

const { POST } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000003";
const sourcePublicationAttemptId =
  "00000000-0000-4000-8000-000000000004";
const authorizationGrantRef =
  "00000000-0000-4000-8000-000000000005";
const sourceChangeReceiptId =
  "00000000-0000-4000-8000-000000000006";
const rollbackAttemptId = "00000000-0000-4000-8000-000000000007";
const asyncRunId = "00000000-0000-4000-8000-000000000008";
const statusUrl = `/api/mvp/projects/${projectId}/runs/${asyncRunId}`;

const validBody = {
  authorizationGrantRef,
  sourceChangeReceiptId,
  previewRef: "preview://rollback/source-attempt",
  expectedCurrentRemoteRevision: "merge-sha",
  customerAcknowledgementInput: {
    acknowledged: true as const,
    acknowledgementScope: "rollback_preview" as const,
  },
  reason: "客户确认撤销本次发布",
  idempotencyKey: "rollback-route-key",
};

function request(body: unknown, key = "rollback-route-key") {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/publications/attempts/${sourcePublicationAttemptId}/rollback`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        Origin: "http://localhost",
        "X-Request-Id": "request-publication-rollback",
      },
      body: JSON.stringify(body),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST publication rollback", () => {
  it("queues a new authorized rollback attempt bound to the source path", async () => {
    mocks.createPublicationRollbackAttempt.mockResolvedValueOnce({
      publicationAttemptId: rollbackAttemptId,
      asyncRunId,
      state: "pending",
      replayed: false,
      location: statusUrl,
    });

    const response = await POST(request(validBody), {
      params: Promise.resolve({
        projectId,
        publicationAttemptId: sourcePublicationAttemptId,
      }),
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("Location")).toBe(statusUrl);
    await expect(response.json()).resolves.toEqual({
      data: {
        publicationAttemptId: rollbackAttemptId,
        asyncRunId,
        state: "pending",
        replayed: false,
      },
    });
    expect(mocks.assertWorkspaceRateLimit).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      {
        idempotencyKey: "rollback-route-key",
        scope: "publication_rollback",
        maxAttempts: 10,
        windowMs: 15 * 60 * 1000,
      },
    );
    expect(mocks.createPublicationRollbackAttempt).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      sourcePublicationAttemptId,
      "00000000-0000-4000-8000-000000000001",
      "rollback-route-key",
      validBody,
    );
  });

  it("rejects browser-supplied source content checksums", async () => {
    const response = await POST(
      request({
        ...validBody,
        artifactContentHash: "a".repeat(64),
        contentChecksum: "f".repeat(64),
      }),
      {
        params: Promise.resolve({
          projectId,
          publicationAttemptId: sourcePublicationAttemptId,
        }),
      },
    );

    expect(response.status).toBe(422);
    expect(mocks.createPublicationRollbackAttempt).not.toHaveBeenCalled();
  });

  it("requires an idempotency key before rate limiting", async () => {
    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/publications/attempts/${sourcePublicationAttemptId}/rollback`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost",
          },
          body: JSON.stringify(validBody),
        },
      ),
      {
        params: Promise.resolve({
          projectId,
          publicationAttemptId: sourcePublicationAttemptId,
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
  });

  it("rejects an invalid source attempt id before rate limiting", async () => {
    const response = await POST(request(validBody), {
      params: Promise.resolve({
        projectId,
        publicationAttemptId: "not-a-uuid",
      }),
    });

    expect(response.status).toBe(404);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createPublicationRollbackAttempt).not.toHaveBeenCalled();
  });
});
