import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  revokePublicationPreview: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000401",
    workspaceId: "00000000-0000-4000-8000-000000000402",
  })),
}));
vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceRateLimit: mocks.assertWorkspaceRateLimit,
}));
vi.mock("@/lib/services/publication-previews", () => ({
  revokePublicationPreview: mocks.revokePublicationPreview,
}));

const { POST } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000403";
const previewEventId = "00000000-0000-4000-8000-000000000404";
const previewRef = `prv_${"a".repeat(64)}`;
const validBody = {
  reason: "Customer cancelled this publication preview.",
  idempotencyKey: "publication-preview-revoke-route-key",
};

function request(body: unknown, key = validBody.idempotencyKey) {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/publications/previews/${previewEventId}/${previewRef}/revoke`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
        origin: "http://localhost",
        "x-request-id": "request-publication-preview-revoke",
      },
      body: JSON.stringify(body),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST publication preview revoke", () => {
  it("passes both opaque path identities and only body intent to the service", async () => {
    const terminal = {
      terminalEventId: "00000000-0000-4000-8000-000000000405",
      eventKind: "revoked",
      supersededPreviewEventId: previewEventId,
      previewRef,
      createdAt: "2026-07-28T09:05:00.000Z",
    };
    mocks.revokePublicationPreview.mockResolvedValueOnce(terminal);

    const response = await POST(request(validBody), {
      params: Promise.resolve({
        projectId,
        previewEventId,
        previewRef,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: terminal });
    expect(mocks.revokePublicationPreview).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000402" },
      projectId,
      previewEventId,
      previewRef,
      "00000000-0000-4000-8000-000000000401",
      validBody.idempotencyKey,
      validBody,
    );
  });

  it("rejects an invalid opaque preview path before rate limiting", async () => {
    const response = await POST(request(validBody), {
      params: Promise.resolve({
        projectId,
        previewEventId,
        previewRef: "preview://legacy/ref",
      }),
    });

    expect(response.status).toBe(404);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.revokePublicationPreview).not.toHaveBeenCalled();
  });
});
