import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  authorizeGitHubDeliveryConnection: vi.fn(),
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
  authorizeGitHubDeliveryConnection:
    mocks.authorizeGitHubDeliveryConnection,
}));

const { POST } = await import("./route.ts");
const projectId = "10000000-0000-4000-8000-000000000003";
const body = {
  purpose: "connector_configuration",
  siteId: "10000000-0000-4000-8000-000000000004",
  destinationRef: "10000000-0000-4000-8000-000000000005",
  destinationRevision: 1,
  targetRef: "/blog/customer-onboarding/",
  callback: {
    providerKind: "github",
    installationId: 201,
    setupAction: "install",
    callbackState: "opaque-callback-state",
  },
  probeIntent: {
    providerKind: "github",
    installationId: 201,
    requestedScope: {
      providerKind: "github",
      repositoryId: 101,
      baseBranch: "main",
      branchPrefix: "gengrowth/",
      contentPath: "content/blog/customer-onboarding.md",
    },
  },
  customerAcknowledgementInput: {
    acknowledged: true,
    acknowledgementScope: "connector_configuration",
  },
};

it("accepts callback intent but not client permission/token facts", async () => {
  mocks.authorizeGitHubDeliveryConnection.mockResolvedValue({
    status: 201,
    replayed: false,
    grant: { authorizationGrantRef: "grant-ref" },
  });
  const response = await POST(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/delivery-connections/authorization-grants/github`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "github-grant-1",
          origin: "http://localhost",
        },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ projectId }) },
  );

  expect(response.status).toBe(201);
  expect(mocks.authorizeGitHubDeliveryConnection).toHaveBeenCalledWith(
    { workspaceId: "10000000-0000-4000-8000-000000000002" },
    projectId,
    "10000000-0000-4000-8000-000000000001",
    "github-grant-1",
    body,
  );

  const forged = await POST(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/delivery-connections/authorization-grants/github`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "github-grant-2",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          ...body,
          token: "ghs_client_forged",
          grantedPermissions: ["contents_write"],
        }),
      },
    ),
    { params: Promise.resolve({ projectId }) },
  );
  expect(forged.status).toBe(422);
  expect(mocks.authorizeGitHubDeliveryConnection).toHaveBeenCalledTimes(1);
});
