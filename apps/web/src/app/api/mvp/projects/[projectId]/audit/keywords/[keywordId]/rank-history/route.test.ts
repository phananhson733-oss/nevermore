import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAuditKeywordRankHistory: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "92000000-0000-4000-8000-000000000001",
    workspaceId: "92000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map-keyword-rank-history", () => ({
  getProjectAuditKeywordRankHistory:
    mocks.getProjectAuditKeywordRankHistory,
}));

const { GET } = await import("./route");

const projectId = "92000000-0000-4000-8000-000000000003";
const keywordId = "92000000-0000-4000-8000-000000000004";

function invoke(
  selectedProjectId = projectId,
  selectedKeywordId = keywordId,
  query = "",
) {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${selectedProjectId}/audit/keywords/${selectedKeywordId}/rank-history${query}`,
      { headers: { "x-request-id": "request-keyword-rank-history" } },
    ),
    {
      params: Promise.resolve({
        projectId: selectedProjectId,
        keywordId: selectedKeywordId,
      }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditKeywordRankHistory.mockResolvedValue({
    projectId,
    keywordId,
    mappedPage: null,
    window: {
      startedAt: "2026-04-29T00:00:00.000Z",
      endedAt: "2026-07-28T00:00:00.000Z",
      days: 90,
    },
    series: [],
    changeMarkers: [],
    coverage: {
      availability: "unavailable",
      limitations: ["No canonical rank observations are available."],
    },
    generatedAt: "2026-07-28T00:00:00.000Z",
  });
});

describe("GET Growth Map Keyword rank history", () => {
  it("uses only the server-resolved workspace and exact path identities", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(
      mocks.getProjectAuditKeywordRankHistory,
    ).toHaveBeenCalledWith(
      { workspaceId: "92000000-0000-4000-8000-000000000002" },
      projectId,
      keywordId,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        projectId,
        keywordId,
        window: { days: 90 },
      },
    });
  });

  it.each([
    ["project", "customer-private-project", keywordId],
    ["Keyword", projectId, "customer-private-keyword"],
  ])(
    "rejects a malformed %s identity before service access",
    async (_label, selectedProjectId, selectedKeywordId) => {
      const response = await invoke(
        selectedProjectId,
        selectedKeywordId,
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
      expect(
        mocks.getProjectAuditKeywordRankHistory,
      ).not.toHaveBeenCalled();
    },
  );

  it("rejects caller-authored windows instead of weakening the fixed 90-day contract", async () => {
    const response = await invoke(
      projectId,
      keywordId,
      "?days=30&actorId=customer-private-actor",
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(
      mocks.getProjectAuditKeywordRankHistory,
    ).not.toHaveBeenCalled();
  });
});
