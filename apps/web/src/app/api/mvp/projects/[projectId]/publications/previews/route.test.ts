import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  issuePublicationPreview: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000201",
    workspaceId: "00000000-0000-4000-8000-000000000202",
  })),
}));
vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceRateLimit: mocks.assertWorkspaceRateLimit,
}));
vi.mock("@/lib/services/publication-previews", () => ({
  issuePublicationPreview: mocks.issuePublicationPreview,
}));

const { POST } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000203";
const destinationRef = "00000000-0000-4000-8000-000000000204";
const approvalEventId = "00000000-0000-4000-8000-000000000205";
const validBody = {
  destinationRef,
  expectedDestinationRevision: 3,
  approvalEventId,
  idempotencyKey: "publication-preview-route-key",
};

function request(body: unknown, key = validBody.idempotencyKey) {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/publications/previews`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
        origin: "http://localhost",
        "x-request-id": "request-publication-preview",
      },
      body: JSON.stringify(body),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST publication publish preview", () => {
  it("returns the strict customer-safe issued lineage", async () => {
    const issued = {
      previewEventId: "00000000-0000-4000-8000-000000000206",
      previewRef: `prv_${"a".repeat(64)}`,
      eventKind: "issued",
      factsSchemaVersion: "publication-preview-facts.v1",
      previewKind: "publish",
      siteId: "00000000-0000-4000-8000-000000000207",
      destinationId: "00000000-0000-4000-8000-000000000208",
      destinationRef,
      destinationRevision: 3,
      providerKind: "github",
      targetRef: "/blog/customer-onboarding/",
      actionId: "00000000-0000-4000-8000-000000000209",
      artifactId: "00000000-0000-4000-8000-00000000020a",
      artifactRevisionId:
        "00000000-0000-4000-8000-00000000020b",
      artifactRevision: 4,
      artifactContentHash: "b".repeat(64),
      artifactApprovalEventId: approvalEventId,
      sourcePublicationAttemptId: null,
      sourceChangeReceiptId: null,
      remotePrecondition: {
        kind: "must_match",
        revision: "base-sha",
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
    };
    mocks.issuePublicationPreview.mockResolvedValueOnce(issued);

    const response = await POST(request(validBody), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: issued });
    expect(mocks.assertWorkspaceRateLimit).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000202",
      {
        idempotencyKey: validBody.idempotencyKey,
        scope: "publication_preview_issue",
        maxAttempts: 20,
        windowMs: 15 * 60 * 1_000,
      },
    );
    expect(mocks.issuePublicationPreview).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000202" },
      projectId,
      "00000000-0000-4000-8000-000000000201",
      validBody.idempotencyKey,
      validBody,
    );
  });

  it("rejects client-authored provider plans and checksums", async () => {
    const response = await POST(
      request({
        ...validBody,
        providerPlan: { providerKind: "github" },
        previewChecksum: "b".repeat(64),
      }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.issuePublicationPreview).not.toHaveBeenCalled();
  });
});
