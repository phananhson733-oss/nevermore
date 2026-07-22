import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAuditUrl: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map", () => ({
  getProjectAuditUrl: mocks.getProjectAuditUrl,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const sitePageId = "00000000-0000-4000-8000-000000000004";

function invoke(selectedSitePageId = sitePageId, uiLocaleCookie?: string) {
  const headers = new Headers({
    "X-Request-Id": "request-growth-map-url",
  });
  if (uiLocaleCookie !== undefined) {
    headers.set("cookie", `sf_ui_locale=${uiLocaleCookie}`);
  }
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/audit/urls/${selectedSitePageId}`,
      { headers },
    ),
    { params: Promise.resolve({ projectId, sitePageId: selectedSitePageId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditUrl.mockResolvedValue({
    projectId,
    siteId: "00000000-0000-4000-8000-000000000005",
    diagnosticRunId: "00000000-0000-4000-8000-000000000006",
    crawlSnapshotId: "00000000-0000-4000-8000-000000000007",
    data: { sitePageId },
  });
});

describe("GET selected Growth Map URL", () => {
  it("scopes the exact canonical SitePage lookup to the operator workspace", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditUrl).toHaveBeenCalledWith(
      {
        workspaceId: "00000000-0000-4000-8000-000000000002",
        uiLocale: "zh-CN",
      },
      projectId,
      sitePageId,
    );
    await expect(response.json()).resolves.toEqual({
      data: expect.objectContaining({ projectId, data: { sitePageId } }),
    });
  });

  it("resolves an explicit sf_ui_locale cookie into the required detail read scope", async () => {
    const response = await invoke(sitePageId, "en");

    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditUrl).toHaveBeenCalledWith(
      {
        workspaceId: "00000000-0000-4000-8000-000000000002",
        uiLocale: "en",
      },
      projectId,
      sitePageId,
    );
  });

  it("rejects a malformed SitePage id as not found before service access", async () => {
    const response = await invoke("customer-private-url");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(JSON.stringify(body)).not.toContain("customer-private-url");
    expect(mocks.getProjectAuditUrl).not.toHaveBeenCalled();
  });
});
