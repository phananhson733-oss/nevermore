import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  issuePublicationRollbackPreview: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000301",
    workspaceId: "00000000-0000-4000-8000-000000000302",
  })),
}));
vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceRateLimit: mocks.assertWorkspaceRateLimit,
}));
vi.mock("@/lib/services/publication-previews", () => ({
  issuePublicationRollbackPreview:
    mocks.issuePublicationRollbackPreview,
}));

const { POST } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000303";
const destinationRef = "00000000-0000-4000-8000-000000000304";
const sourcePublicationAttemptId =
  "00000000-0000-4000-8000-000000000305";
const sourceChangeReceiptId =
  "00000000-0000-4000-8000-000000000306";
const validBody = {
  destinationRef,
  expectedDestinationRevision: 3,
  sourcePublicationAttemptId,
  sourceChangeReceiptId,
  idempotencyKey: "publication-rollback-preview-route-key",
};

function request(body: unknown, key = validBody.idempotencyKey) {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/publications/previews/rollback`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
        origin: "http://localhost",
        "x-request-id": "request-publication-rollback-preview",
      },
      body: JSON.stringify(body),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST publication rollback preview", () => {
  it("binds the route to the strict rollback selection contract", async () => {
    mocks.issuePublicationRollbackPreview.mockResolvedValueOnce({
      previewEventId: "00000000-0000-4000-8000-000000000307",
      previewRef: `prv_${"a".repeat(64)}`,
      eventKind: "issued",
      factsSchemaVersion: "publication-preview-facts.v1",
      previewKind: "rollback",
      siteId: "00000000-0000-4000-8000-000000000308",
      destinationId: "00000000-0000-4000-8000-000000000309",
      destinationRef,
      destinationRevision: 3,
      providerKind: "github",
      targetRef: "/blog/customer-onboarding/",
      actionId: "00000000-0000-4000-8000-00000000030a",
      artifactId: "00000000-0000-4000-8000-00000000030b",
      artifactRevisionId:
        "00000000-0000-4000-8000-00000000030c",
      artifactRevision: 4,
      artifactContentHash: "b".repeat(64),
      artifactApprovalEventId:
        "00000000-0000-4000-8000-00000000030d",
      sourcePublicationAttemptId,
      sourceChangeReceiptId,
      remotePrecondition: {
        kind: "must_match",
        revision: "merge-sha",
      },
      rollbackPlan: {
        providerKind: "github",
        strategy: "github_revert_pr",
        priorRemoteRevision: "base-sha",
        expectedCurrentRemoteRevision: "merge-sha",
        facts: {},
      },
      previewChecksum: "b".repeat(64),
      contentChecksum: "c".repeat(64),
      factsHash: "d".repeat(64),
      createdAt: "2026-07-28T09:00:00.000Z",
      expiresAt: "2026-07-28T09:10:00.000Z",
    });

    const response = await POST(request(validBody), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(201);
    expect(mocks.issuePublicationRollbackPreview).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000302" },
      projectId,
      "00000000-0000-4000-8000-000000000301",
      validBody.idempotencyKey,
      validBody,
    );
  });

  it("rejects browser-authored remote facts", async () => {
    const response = await POST(
      request({
        ...validBody,
        expectedCurrentRemoteRevision: "client-sha",
        rollbackPlan: { providerKind: "github" },
      }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.issuePublicationRollbackPreview).not.toHaveBeenCalled();
  });
});
