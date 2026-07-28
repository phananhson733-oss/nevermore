import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAuditInternalLinkMap: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "94000000-0000-4000-8000-000000000001",
    workspaceId: "94000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map-internal-link-map", () => ({
  getProjectAuditInternalLinkMap:
    mocks.getProjectAuditInternalLinkMap,
}));

const { GET } = await import("./route");

const projectId = "94000000-0000-4000-8000-000000000003";
const sitePageId = "94000000-0000-4000-8000-000000000004";

function invoke(selectedProjectId = projectId, query = "") {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${selectedProjectId}/audit/internal-link-map${query}`,
      {
        headers: {
          "x-request-id": "request-internal-link-map",
        },
      },
    ),
    { params: Promise.resolve({ projectId: selectedProjectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditInternalLinkMap.mockResolvedValue({
    projectId,
    diagnosticRunId: null,
    crawlSnapshot: null,
    coverage: {
      availability: "unavailable",
      crawlCompleteness: "unavailable",
      limitations: ["当前项目没有可读取的已完成诊断。"],
    },
    graph: {
      nodes: [],
      edges: [],
      totalEdgeCount: 0,
      edgesTruncated: false,
    },
    selectedPage: null,
    generatedAt: "2026-07-28T12:00:00.000Z",
  });
});

describe("GET Growth Map Internal Link Map", () => {
  it("uses server workspace scope and an optional selected SitePage", async () => {
    const response = await invoke(
      projectId,
      `?sitePageId=${sitePageId}`,
    );

    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditInternalLinkMap).toHaveBeenCalledWith(
      { workspaceId: "94000000-0000-4000-8000-000000000002" },
      projectId,
      sitePageId,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        projectId,
        coverage: { availability: "unavailable" },
      },
    });
  });

  it("returns the graph overview without a selected page", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditInternalLinkMap).toHaveBeenCalledWith(
      { workspaceId: "94000000-0000-4000-8000-000000000002" },
      projectId,
      null,
    );
  });

  it("rejects a malformed project identity before service access", async () => {
    const response = await invoke("customer-private-project");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(mocks.getProjectAuditInternalLinkMap).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown", "?actorId=customer-private-actor"],
    [
      "duplicate",
      `?sitePageId=${sitePageId}&sitePageId=94000000-0000-4000-8000-000000000099`,
    ],
    ["malformed", "?sitePageId=customer-private-site-page"],
  ])(
    "rejects %s query input before service access",
    async (_label, query) => {
      const response = await invoke(projectId, query);

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
      });
      expect(
        mocks.getProjectAuditInternalLinkMap,
      ).not.toHaveBeenCalled();
    },
  );
});
