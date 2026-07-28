import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicationAttempt: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/services/publication-attempts", () => ({
  getPublicationAttempt: mocks.getPublicationAttempt,
}));

const { GET } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000003";
const publicationAttemptId =
  "00000000-0000-4000-8000-000000000004";
const asyncRunId = "00000000-0000-4000-8000-000000000005";
const checksum = "a".repeat(64);
const contentChecksum = "f".repeat(64);

function request() {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/publications/attempts/${publicationAttemptId}`,
    {
      headers: {
        Origin: "http://localhost",
        "X-Request-Id": "request-publication-history",
      },
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET publication attempt history", () => {
  it("returns the customer-safe immutable timeline including both hash identities", async () => {
    const customerAttempt = {
      id: publicationAttemptId,
      attemptKind: "publish",
      sourcePublicationAttemptId: null,
      sourceChangeReceiptId: null,
      state: "pending",
      run: {
        id: asyncRunId,
        projectId,
        kind: "publication",
        status: "completed",
        progress: {
          phase: "completed",
          current: 1,
          total: 1,
          messageKey: "run.completed",
        },
        lastError: null,
        resultRef: {
          type: "publication_attempt",
          id: publicationAttemptId,
        },
        queuedAt: "2026-07-27T10:00:00.000Z",
        startedAt: "2026-07-27T10:00:01.000Z",
        completedAt: "2026-07-27T10:01:00.000Z",
      },
      siteId: "00000000-0000-4000-8000-000000000006",
      destinationRef: "00000000-0000-4000-8000-000000000007",
      destinationRevision: 3,
      providerKind: "github",
      targetRef: "/blog/customer-onboarding/",
      actionId: "00000000-0000-4000-8000-000000000008",
      artifact: {
        id: "00000000-0000-4000-8000-000000000009",
        revision: 4,
        contentHash: checksum,
      },
      preview: {
        ref: "preview://artifact/revision/4",
        artifactContentHash: checksum,
        contentChecksum,
      },
      remotePrecondition: {
        kind: "must_match",
        revision: "base-sha",
      },
      rollbackStrategy: "github_revert_pr",
      requestedAt: "2026-07-27T10:00:00.000Z",
      timeline: [
        {
          kind: "attempt_requested",
          receiptId: null,
          verificationState: "pending",
          remoteObjectKind: null,
          remoteObjectId: null,
          remoteRevision: null,
          deliveryUrl: null,
          liveCanonicalUrl: null,
          artifactContentHash: checksum,
          contentChecksum,
          limitation: null,
          occurredAt: "2026-07-27T10:00:00.000Z",
        },
      ],
    };
    mocks.getPublicationAttempt.mockResolvedValueOnce(customerAttempt);

    const response = await GET(request(), {
      params: Promise.resolve({ projectId, publicationAttemptId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: customerAttempt,
    });
    expect(mocks.getPublicationAttempt).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      publicationAttemptId,
    );
  });

  it("rejects an invalid attempt id before reading history", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({
        projectId,
        publicationAttemptId: "not-a-uuid",
      }),
    });

    expect(response.status).toBe(404);
    expect(mocks.getPublicationAttempt).not.toHaveBeenCalled();
  });
});
