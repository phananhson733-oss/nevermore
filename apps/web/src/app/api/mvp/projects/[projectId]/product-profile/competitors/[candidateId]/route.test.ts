import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reviewProductProfileCompetitor: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/services/product-profile", () => mocks);

const { PATCH } = await import("./route");
const projectId = "00000000-0000-4000-8000-000000000003";
const candidateId = "00000000-0000-4000-8000-000000000004";

describe("PATCH Product Profile competitor", () => {
  it("passes parsed project and server candidate identities separately", async () => {
    mocks.reviewProductProfileCompetitor.mockResolvedValue({ id: "profile-row" });
    const body = {
      baseVersion: 2,
      reviewStatus: "approved",
      relationship: "direct",
      analysisScope: ["keyword_gap"],
    };
    const response = await PATCH(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/product-profile/competitors/${candidateId}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
          },
          body: JSON.stringify(body),
        },
      ),
      { params: Promise.resolve({ projectId, candidateId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.reviewProductProfileCompetitor).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      candidateId,
      "00000000-0000-4000-8000-000000000001",
      body,
    );
  });
});
