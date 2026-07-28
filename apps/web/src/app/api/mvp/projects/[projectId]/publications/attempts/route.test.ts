import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  createPublicationAttempt: vi.fn(),
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
  createPublicationAttempt: mocks.createPublicationAttempt,
}));

const { POST } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000003";
const destinationRef = "00000000-0000-4000-8000-000000000004";
const authorizationGrantRef =
  "00000000-0000-4000-8000-000000000005";
const approvalEventId = "00000000-0000-4000-8000-000000000006";
const publicationAttemptId =
  "00000000-0000-4000-8000-000000000007";
const asyncRunId = "00000000-0000-4000-8000-000000000008";
const statusUrl = `/api/mvp/projects/${projectId}/runs/${asyncRunId}`;

const validBody = {
  destinationRef,
  expectedDestinationRevision: 3,
  authorizationGrantRef,
  approvalEventId,
  previewRef: "preview://artifact/revision/4",
  rollbackPlanRef: "rollback-plan://artifact/revision/4",
  remotePrecondition: {
    kind: "must_match" as const,
    revision: "base-sha",
  },
  idempotencyKey: "publish-route-key",
};

function request(body: unknown, key = "publish-route-key") {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/publications/attempts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        Origin: "http://localhost",
        "X-Request-Id": "request-publication-publish",
      },
      body: JSON.stringify(body),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST publication attempt", () => {
  it("returns canonical 202 polling metadata for the frozen publication attempt", async () => {
    mocks.createPublicationAttempt.mockResolvedValueOnce({
      publicationAttemptId,
      asyncRunId,
      state: "pending",
      replayed: false,
      location: statusUrl,
    });

    const response = await POST(request(validBody), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("Location")).toBe(statusUrl);
    expect(response.headers.get("Retry-After")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      data: {
        publicationAttemptId,
        asyncRunId,
        state: "pending",
        replayed: false,
      },
    });
    expect(mocks.assertWorkspaceRateLimit).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      {
        idempotencyKey: "publish-route-key",
        scope: "publication_attempt",
        maxAttempts: 20,
        windowMs: 15 * 60 * 1000,
      },
    );
    expect(mocks.createPublicationAttempt).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      "00000000-0000-4000-8000-000000000001",
      "publish-route-key",
      validBody,
    );
  });

  it("rejects browser-supplied checksum or plan authority", async () => {
    const response = await POST(
      request({
        ...validBody,
        contentChecksum: "f".repeat(64),
        rollbackPlan: { providerKind: "github" },
      }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.createPublicationAttempt).not.toHaveBeenCalled();
  });

  it("requires Idempotency-Key before rate limiting", async () => {
    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/publications/attempts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost",
          },
          body: JSON.stringify(validBody),
        },
      ),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createPublicationAttempt).not.toHaveBeenCalled();
  });

  it("treats an invalid project id as not found before rate limiting", async () => {
    const response = await POST(request(validBody), {
      params: Promise.resolve({ projectId: "not-a-uuid" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createPublicationAttempt).not.toHaveBeenCalled();
  });
});
