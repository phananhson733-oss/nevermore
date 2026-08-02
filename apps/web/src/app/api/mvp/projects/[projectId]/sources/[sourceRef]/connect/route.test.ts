import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceAttemptRateLimit: vi.fn(),
  connectProjectSource: vi.fn(),
  createCollectionRun: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceAttemptRateLimit: mocks.assertWorkspaceAttemptRateLimit,
}));
vi.mock("@/lib/services/source-connect", () => ({
  connectProjectSource: mocks.connectProjectSource,
}));
vi.mock("@/lib/services/collection", () => ({
  createCollectionRun: mocks.createCollectionRun,
}));

const { POST } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000003";
const sourceConnectionId = "00000000-0000-4000-8000-000000000004";

function selectPropertyRequest(provider: "gsc" | "ga4") {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/sources/${provider}/connect`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "X-Request-Id": `connect-${provider}`,
      },
      body: JSON.stringify({
        phase: "select_property",
        oauthIntentId: "00000000-0000-4000-8000-000000000005",
        externalPropertyId:
          provider === "gsc" ? "sc-domain:example.com" : "properties/123",
      }),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST OAuth connection initial collection", () => {
  it.each(["gsc", "ga4"] as const)(
    "queues the first %s collection on the server before reporting the source connected",
    async (provider) => {
      mocks.connectProjectSource.mockResolvedValueOnce({
        phase: "connected",
        source: { id: sourceConnectionId, provider },
      });
      mocks.createCollectionRun.mockResolvedValueOnce({
        status: 202,
        run: { id: "00000000-0000-4000-8000-000000000006" },
      });

      const response = await POST(selectPropertyRequest(provider), {
        params: Promise.resolve({ projectId, sourceRef: provider }),
      });

      expect(response.status).toBe(200);
      expect(mocks.createCollectionRun).toHaveBeenCalledTimes(1);
      expect(mocks.createCollectionRun).toHaveBeenCalledWith(
        { workspaceId: "00000000-0000-4000-8000-000000000002" },
        projectId,
        "00000000-0000-4000-8000-000000000001",
        `oauth-initial-collection:${sourceConnectionId}`,
        { provider, sourceConnectionId },
      );
    },
  );

  it("keeps the durable connection successful when its automatic queue hand-off fails", async () => {
    mocks.connectProjectSource.mockResolvedValueOnce({
      phase: "connected",
      source: { id: sourceConnectionId, provider: "gsc" },
    });
    mocks.createCollectionRun.mockRejectedValueOnce(
      new Error("queue is temporarily unavailable"),
    );

    const response = await POST(selectPropertyRequest("gsc"), {
      params: Promise.resolve({ projectId, sourceRef: "gsc" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        phase: "connected",
        source: { id: sourceConnectionId, provider: "gsc" },
      },
    });
  });
});
