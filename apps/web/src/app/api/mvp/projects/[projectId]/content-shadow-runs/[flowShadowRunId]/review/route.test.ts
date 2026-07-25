import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reviewContentShadowRevision: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/services/content-shadow-review", () => ({
  reviewContentShadowRevision: mocks.reviewContentShadowRevision,
}));

const { POST } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000003";
const flowShadowRunId = "00000000-0000-4000-8000-000000000007";
const artifactId = "00000000-0000-4000-8000-000000000008";
const CONTENT_HASH =
  "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

function request(bodyValue: unknown) {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/content-shadow-runs/${flowShadowRunId}/review`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "X-Request-Id": "request-content-shadow-review",
      },
      body: JSON.stringify(bodyValue),
    },
  );
}

const params = {
  params: Promise.resolve({ projectId, flowShadowRunId }),
};

const receipt = {
  flowShadowRunId,
  artifactId,
  reviewedRevision: 1,
  artifactStatus: "ready",
  verdict: "passed",
  claimCounts: { passed: 3, failed: 0, unevaluated: 4 },
  contentHash: CONTENT_HASH,
  reviewedAt: "2026-07-25T00:03:00.000Z",
  externalPublishingWrite: "none",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST content shadow review", () => {
  it("returns the receipt, and the receipt says no external write happened", async () => {
    mocks.reviewContentShadowRevision.mockResolvedValueOnce(receipt);

    const response = await POST(request({ baseRevision: 1 }), params);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: typeof receipt };
    expect(body).toEqual({ data: receipt });
    // The negative is a field, not a sentence: it cannot quietly stop being
    // true the way interface copy can.
    expect(body.data.externalPublishingWrite).toBe("none");
  });

  it("passes the reviewer's acknowledgement through unchanged", async () => {
    mocks.reviewContentShadowRevision.mockResolvedValueOnce(receipt);

    await POST(request({ baseRevision: 4, acknowledgeFindings: true }), params);

    expect(mocks.reviewContentShadowRevision).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      flowShadowRunId,
      { baseRevision: 4, acknowledgeFindings: true },
    );
  });

  it("defaults the acknowledgement to withheld rather than granted", async () => {
    mocks.reviewContentShadowRevision.mockResolvedValueOnce(receipt);

    await POST(request({ baseRevision: 4 }), params);

    expect(mocks.reviewContentShadowRevision).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
      flowShadowRunId,
      { baseRevision: 4, acknowledgeFindings: false },
    );
  });

  it("refuses a review that names no revision, before reaching the service", async () => {
    // A review that does not say what it reviewed is not a review.
    const response = await POST(request({}), params);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(mocks.reviewContentShadowRevision).not.toHaveBeenCalled();
  });

  it("refuses an unknown field rather than ignoring it", async () => {
    const response = await POST(
      request({ baseRevision: 1, decision: "publish" }),
      params,
    );

    expect(response.status).toBe(422);
    expect(mocks.reviewContentShadowRevision).not.toHaveBeenCalled();
  });

  it("refuses a revision number that cannot exist", async () => {
    const response = await POST(request({ baseRevision: 0 }), params);

    expect(response.status).toBe(422);
    expect(mocks.reviewContentShadowRevision).not.toHaveBeenCalled();
  });
});
