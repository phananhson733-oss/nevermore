import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ confirmProductProfile: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/services/product-profile", () => mocks);

const { POST } = await import("./route");
const projectId = "00000000-0000-4000-8000-000000000003";

describe("POST Product Profile confirmation", () => {
  it("confirms without requiring idempotency or queuing an Audit", async () => {
    const confirmed = { id: "confirmed-profile", status: "complete" };
    mocks.confirmProductProfile.mockResolvedValue(confirmed);
    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/product-profile/confirm`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
          },
          body: JSON.stringify({ baseVersion: 2 }),
        },
      ),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: confirmed });
    expect(mocks.confirmProductProfile).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      "00000000-0000-4000-8000-000000000001",
      { baseVersion: 2 },
    );
  });
});
