import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  revokeDeliveryConnection: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceRateLimit: mocks.assertWorkspaceRateLimit,
}));
vi.mock("@/lib/services/delivery-connections", () => ({
  revokeDeliveryConnection: mocks.revokeDeliveryConnection,
}));

const { POST } = await import("./route.ts");
const projectId = "10000000-0000-4000-8000-000000000003";
const destinationRef = "10000000-0000-4000-8000-000000000004";

it("passes the exact path ref, base revision, authenticated actor, and idempotency key", async () => {
  const body = {
    baseRevision: 2,
    reason: "Customer revoked repository access.",
  };
  mocks.revokeDeliveryConnection.mockResolvedValue({
    status: 201,
    replayed: false,
    destination: { destinationRef, revision: 3, state: "revoked" },
  });
  const response = await POST(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/delivery-connections/${destinationRef}/revoke`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "revoke-connection-1",
          origin: "http://localhost",
        },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ projectId, destinationRef }) },
  );

  expect(response.status).toBe(201);
  expect(mocks.revokeDeliveryConnection).toHaveBeenCalledWith(
    { workspaceId: "10000000-0000-4000-8000-000000000002" },
    projectId,
    "10000000-0000-4000-8000-000000000001",
    destinationRef,
    "revoke-connection-1",
    body,
  );
});
