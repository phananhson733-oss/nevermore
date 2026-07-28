import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectMeasurementTargetKeywordRanks: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "d5000000-0000-4000-8000-000000000005",
    workspaceId: "d5000000-0000-4000-8000-000000000001",
  })),
}));
vi.mock("@/lib/services/measurement-keyword-ranks", () => ({
  getProjectMeasurementTargetKeywordRanks:
    mocks.getProjectMeasurementTargetKeywordRanks,
}));

const { GET } = await import("./route.ts");

const IDS = {
  workspace: "d5000000-0000-4000-8000-000000000001",
  project: "d5000000-0000-4000-8000-000000000002",
  window: "d5000000-0000-4000-8000-000000000003",
  page: "d5000000-0000-4000-8000-000000000004",
} as const;

function request(search = "") {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${IDS.project}/measurement-windows/${IDS.window}/keyword-ranks${search}`,
    {
      headers: {
        "x-request-id": "request-measurement-keyword-ranks",
      },
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectMeasurementTargetKeywordRanks.mockResolvedValue({
    projectId: IDS.project,
    measurementWindowId: IDS.window,
    sitePageId: IDS.page,
    canonicalUrl: "https://example.com/page/",
    beforeWindow: {
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-29T00:00:00.000Z",
    },
    afterWindow: {
      startAt: "2026-06-29T00:00:00.000Z",
      endAt: "2026-07-27T00:00:00.000Z",
    },
    interpretation:
      "dataforseo_absolute_rank_observational_non_causal",
    keywords: [],
    coverage: {
      availability: "unavailable",
      limitations: ["No confirmed target Keywords exist."],
    },
    generatedAt: "2026-07-27T12:00:00.000Z",
  });
});

describe("GET measurement target Keyword ranks", () => {
  it("uses the stable project route and exact Measurement Window identity", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({
        projectId: IDS.project,
        measurementWindowId: IDS.window,
      }),
    });

    expect(response.status).toBe(200);
    expect(
      mocks.getProjectMeasurementTargetKeywordRanks,
    ).toHaveBeenCalledWith(
      { workspaceId: IDS.workspace },
      IDS.project,
      IDS.window,
    );
  });

  it("rejects caller-selected dates or any other query", async () => {
    const response = await GET(request("?days=30"), {
      params: Promise.resolve({
        projectId: IDS.project,
        measurementWindowId: IDS.window,
      }),
    });
    expect(response.status).toBe(422);
    expect(
      mocks.getProjectMeasurementTargetKeywordRanks,
    ).not.toHaveBeenCalled();
  });

  it("does not invoke the service for malformed path identities", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({
        projectId: "not-a-uuid",
        measurementWindowId: IDS.window,
      }),
    });
    expect(response.status).toBe(404);
    expect(
      mocks.getProjectMeasurementTargetKeywordRanks,
    ).not.toHaveBeenCalled();
  });
});
