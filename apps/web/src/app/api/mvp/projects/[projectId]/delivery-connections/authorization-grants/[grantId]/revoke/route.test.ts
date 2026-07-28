import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  revokeDeliveryAuthorizationGrant: vi.fn(),
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
  revokeDeliveryAuthorizationGrant:
    mocks.revokeDeliveryAuthorizationGrant,
}));

const { POST } = await import("./route.ts");
const projectId = "10000000-0000-4000-8000-000000000003";
const grantId = "10000000-0000-4000-8000-000000000004";

function request(body: unknown) {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/delivery-connections/authorization-grants/${grantId}/revoke`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "revoke-grant-1",
        origin: "http://localhost",
      },
      body: JSON.stringify(body),
    },
  );
}

it("requires the body grant ref to equal the path ref", async () => {
  const valid = {
    authorizationGrantRef: grantId,
    reason: "Customer revoked connector setup.",
  };
  mocks.revokeDeliveryAuthorizationGrant.mockResolvedValue({
    status: 200,
    replayed: false,
    grant: { authorizationGrantRef: grantId, state: "revoked" },
  });
  const response = await POST(request(valid), {
    params: Promise.resolve({ projectId, grantId }),
  });
  expect(response.status).toBe(200);
  expect(mocks.revokeDeliveryAuthorizationGrant).toHaveBeenCalledWith(
    { workspaceId: "10000000-0000-4000-8000-000000000002" },
    projectId,
    "10000000-0000-4000-8000-000000000001",
    "revoke-grant-1",
    valid,
  );

  const mismatch = await POST(
    request({
      ...valid,
      authorizationGrantRef:
        "10000000-0000-4000-8000-000000000099",
    }),
    { params: Promise.resolve({ projectId, grantId }) },
  );
  expect(mismatch.status).toBe(422);
  expect(mocks.revokeDeliveryAuthorizationGrant).toHaveBeenCalledTimes(1);
});
