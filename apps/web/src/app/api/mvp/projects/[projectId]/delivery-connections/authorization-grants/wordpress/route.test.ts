import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  authorizeWordPressDeliveryConnection: vi.fn(),
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
  authorizeWordPressDeliveryConnection:
    mocks.authorizeWordPressDeliveryConnection,
}));

const { POST } = await import("./route.ts");
const projectId = "10000000-0000-4000-8000-000000000003";
const credentialInput = {
  username: "editor@example.com",
  applicationPassword: "abcd efgh ijkl mnop",
};
const body = {
  purpose: "connector_configuration",
  siteId: "10000000-0000-4000-8000-000000000004",
  destinationRef: "10000000-0000-4000-8000-000000000005",
  destinationRevision: 1,
  targetRef: "/blog/customer-onboarding/",
  requestedScope: {
    providerKind: "wordpress",
    siteBaseUrl: "https://cms.relayops.example",
    postType: "post",
    authorAllowlist: [7],
    statusAllowlist: ["draft"],
  },
  credentialInput,
  customerAcknowledgementInput: {
    acknowledged: true,
    acknowledgementScope: "connector_configuration",
  },
};

it("passes one-time credentials only to the server service and returns its redacted grant", async () => {
  mocks.authorizeWordPressDeliveryConnection.mockResolvedValue({
    status: 201,
    replayed: false,
    grant: { authorizationGrantRef: "grant-ref" },
  });
  const response = await POST(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/delivery-connections/authorization-grants/wordpress`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "wordpress-grant-1",
          origin: "http://localhost",
        },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ projectId }) },
  );

  expect(response.status).toBe(201);
  expect(mocks.authorizeWordPressDeliveryConnection).toHaveBeenCalledWith(
    { workspaceId: "10000000-0000-4000-8000-000000000002" },
    projectId,
    "10000000-0000-4000-8000-000000000001",
    "wordpress-grant-1",
    body,
  );
  expect(JSON.stringify(await response.json())).not.toContain(
    credentialInput.applicationPassword,
  );
});
