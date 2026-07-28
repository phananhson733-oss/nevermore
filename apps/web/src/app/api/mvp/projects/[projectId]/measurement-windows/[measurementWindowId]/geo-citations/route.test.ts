import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectMeasurementGeoCitations: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "d8000000-0000-4000-8000-000000000005",
    workspaceId: "d8000000-0000-4000-8000-000000000001",
  })),
}));
vi.mock("@/lib/services/measurement-geo-citations", () => ({
  getProjectMeasurementGeoCitations:
    mocks.getProjectMeasurementGeoCitations,
}));

const { GET } = await import("./route.ts");

const IDS = {
  workspace: "d8000000-0000-4000-8000-000000000001",
  project: "d8000000-0000-4000-8000-000000000002",
  window: "d8000000-0000-4000-8000-000000000003",
  page: "d8000000-0000-4000-8000-000000000004",
} as const;

function request(search = "") {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${IDS.project}/measurement-windows/${IDS.window}/geo-citations${search}`,
    {
      headers: {
        "x-request-id": "request-measurement-geo-citations",
      },
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectMeasurementGeoCitations.mockResolvedValue({
    projectId: IDS.project,
    siteId: "d8000000-0000-4000-8000-000000000006",
    measurementWindowId: IDS.window,
    sitePageId: IDS.page,
    canonicalUrl: "https://example.com/page/",
    interpretation: "observational_non_causal",
    phases: { baseline: null, outcome: null },
    limitation: "No real GEO observations exist yet.",
  });
});

describe("GET measurement GEO citation evidence", () => {
  it("uses the stable four-module Results route and exact window identity", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({
        projectId: IDS.project,
        measurementWindowId: IDS.window,
      }),
    });

    expect(response.status).toBe(200);
    expect(
      mocks.getProjectMeasurementGeoCitations,
    ).toHaveBeenCalledWith(
      { workspaceId: IDS.workspace },
      IDS.project,
      IDS.window,
    );
  });

  it("rejects caller-selected dates, platforms, or URLs", async () => {
    const response = await GET(
      request("?platform=chatgpt"),
      {
        params: Promise.resolve({
          projectId: IDS.project,
          measurementWindowId: IDS.window,
        }),
      },
    );
    expect(response.status).toBe(422);
    expect(
      mocks.getProjectMeasurementGeoCitations,
    ).not.toHaveBeenCalled();
  });

  it("does not query evidence for malformed path identities", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({
        projectId: "not-a-uuid",
        measurementWindowId: IDS.window,
      }),
    });
    expect(response.status).toBe(404);
    expect(
      mocks.getProjectMeasurementGeoCitations,
    ).not.toHaveBeenCalled();
  });
});
