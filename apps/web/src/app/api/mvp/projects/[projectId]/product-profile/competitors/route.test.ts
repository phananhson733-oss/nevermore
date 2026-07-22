import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ addProductProfileCompetitor: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/services/product-profile", () => mocks);

const { POST } = await import("./route");
const projectId = "00000000-0000-4000-8000-000000000003";

describe("POST Product Profile competitor", () => {
  it("adds a contract-valid customer-declared competitor without idempotency", async () => {
    mocks.addProductProfileCompetitor.mockResolvedValue({ id: "profile-row" });
    const body = {
      baseVersion: 2,
      name: "Competitor",
      domain: "competitor.example",
      relationship: "direct",
      analysisScope: ["positioning"],
    };
    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/product-profile/competitors`,
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

    expect(response.status).toBe(200);
    expect(mocks.addProductProfileCompetitor).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      "00000000-0000-4000-8000-000000000001",
      body,
    );
  });
});
