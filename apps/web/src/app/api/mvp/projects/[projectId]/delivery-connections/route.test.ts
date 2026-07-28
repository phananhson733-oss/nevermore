import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  appendDeliveryConnectionRevision: vi.fn(),
  listDeliveryConnections: vi.fn(),
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
  appendDeliveryConnectionRevision:
    mocks.appendDeliveryConnectionRevision,
  listDeliveryConnections: mocks.listDeliveryConnections,
}));

const { GET, POST } = await import("./route.ts");

const projectId = "10000000-0000-4000-8000-000000000003";
const siteId = "10000000-0000-4000-8000-000000000004";
const destinationRef = "10000000-0000-4000-8000-000000000005";
const grantRef = "10000000-0000-4000-8000-000000000006";

const body = {
  siteId,
  destinationRef,
  baseRevision: 0,
  targetRef: "/blog/customer-onboarding/",
  providerKind: "github" as const,
  requestedScope: {
    providerKind: "github" as const,
    repositoryId: 101,
    baseBranch: "main",
    branchPrefix: "gengrowth/",
    contentPath: "content/blog/customer-onboarding.md",
  },
  authorizationGrantRef: grantRef,
};

function request(
  method: "GET" | "POST",
  value?: unknown,
  idempotencyKey = "delivery-connection-route-1",
) {
  if (method === "GET") {
    return new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/delivery-connections`,
    );
  }
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/delivery-connections`,
    {
      method,
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        origin: "http://localhost",
      },
      body: JSON.stringify(value),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listDeliveryConnections.mockResolvedValue([]);
  mocks.appendDeliveryConnectionRevision.mockResolvedValue({
    status: 201,
    replayed: false,
    destination: { id: "destination-row" },
  });
});

describe("delivery connection collection route", () => {
  it("lists only the authenticated workspace project projection", async () => {
    const response = await GET(request("GET"), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.listDeliveryConnections).toHaveBeenCalledWith(
      { workspaceId: "10000000-0000-4000-8000-000000000002" },
      projectId,
    );
    await expect(response.json()).resolves.toEqual({ data: [] });
  });

  it("parses an opaque grant-only append command and returns 201", async () => {
    const response = await POST(request("POST", body), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(201);
    expect(mocks.assertWorkspaceRateLimit).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000002",
      {
        idempotencyKey: "delivery-connection-route-1",
        scope: "delivery_connection_revision",
        maxAttempts: 30,
        windowMs: 15 * 60 * 1000,
      },
    );
    expect(
      mocks.appendDeliveryConnectionRevision,
    ).toHaveBeenCalledWith(
      { workspaceId: "10000000-0000-4000-8000-000000000002" },
      projectId,
      "10000000-0000-4000-8000-000000000001",
      "delivery-connection-route-1",
      body,
    );
    await expect(response.json()).resolves.toEqual({
      data: { id: "destination-row" },
    });
  });

  it.each([
    ["authorizationSnapshot", { actorId: "client-forged" }],
    ["probeFacts", { contentsWrite: true }],
    ["encryptedPayload", "ciphertext"],
    ["actorId", "10000000-0000-4000-8000-000000000099"],
    ["createdAt", "2026-07-27T10:00:00.000Z"],
  ])("rejects client-owned %s before service access", async (field, value) => {
    const response = await POST(
      request("POST", { ...body, [field]: value }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(422);
    expect(
      mocks.appendDeliveryConnectionRevision,
    ).not.toHaveBeenCalled();
  });

  it("requires a valid idempotency key before rate limiting", async () => {
    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/delivery-connections`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
          },
          body: JSON.stringify(body),
        },
      ),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(
      mocks.appendDeliveryConnectionRevision,
    ).not.toHaveBeenCalled();
  });
});
