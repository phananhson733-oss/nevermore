import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAuditBacklinks: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "c1000000-0000-4000-8000-000000000001",
    workspaceId: "c1000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map-backlinks", () => ({
  getProjectAuditBacklinks: mocks.getProjectAuditBacklinks,
}));

const { GET } = await import("./route");
const projectId = "c1000000-0000-4000-8000-000000000003";

function invoke(
  selectedProjectId = projectId,
  uiLocaleCookie?: string,
) {
  const headers = new Headers({
    "x-request-id": "request-growth-map-backlinks",
  });
  if (uiLocaleCookie !== undefined) {
    headers.set("cookie", `sf_ui_locale=${uiLocaleCookie}`);
  }
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${selectedProjectId}/audit/backlinks`,
      { headers },
    ),
    { params: Promise.resolve({ projectId: selectedProjectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditBacklinks.mockResolvedValue({
    projectId,
    generatedAt: "2026-07-28T12:00:00.000Z",
    coverage: {
      availability: "unavailable",
      indexScope: "unavailable",
      limitations: ["尚无可读取的外链数据快照。"],
    },
    sources: [],
    primarySite: null,
    approvedCompetitors: [],
    comparison: {
      state: "unavailable",
      provider: null,
      primarySiteSnapshotId: null,
      competitorSnapshotIds: [],
      limitation: "尚无可读取的外链数据快照。",
    },
    pages: [],
    referringDomains: [],
    opportunities: [],
  });
});

describe("GET Growth Map Backlinks", () => {
  it("uses the server-owned workspace scope and remains a pure read", async () => {
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditBacklinks).toHaveBeenCalledWith(
      {
        workspaceId: "c1000000-0000-4000-8000-000000000002",
        uiLocale: "zh-CN",
      },
      projectId,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        projectId,
        coverage: { availability: "unavailable" },
      },
    });
  });

  it("passes the validated request UI locale into customer-facing projection copy", async () => {
    const response = await invoke(projectId, "en");
    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditBacklinks).toHaveBeenCalledWith(
      {
        workspaceId: "c1000000-0000-4000-8000-000000000002",
        uiLocale: "en",
      },
      projectId,
    );
  });

  it("rejects a malformed project identity before service access", async () => {
    const response = await invoke("private-project");
    expect(response.status).toBe(404);
    expect(mocks.getProjectAuditBacklinks).not.toHaveBeenCalled();
  });
});
