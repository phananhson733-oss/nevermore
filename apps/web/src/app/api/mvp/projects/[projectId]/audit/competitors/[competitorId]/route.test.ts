import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAuditCompetitor: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map-competitors", () => ({
  getProjectAuditCompetitor: mocks.getProjectAuditCompetitor,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const competitorId = "00000000-0000-4000-8000-000000000004";

function invoke(selectedCompetitorId = competitorId) {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/audit/competitors/${selectedCompetitorId}`,
      { headers: { "X-Request-Id": "request-growth-map-competitor" } },
    ),
    {
      params: Promise.resolve({
        projectId,
        competitorId: selectedCompetitorId,
      }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditCompetitor.mockResolvedValue({
    projectId,
    data: { competitorId },
  });
});

describe("GET selected Growth Map Competitor", () => {
  it("scopes the exact Competitor lookup to the operator workspace", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditCompetitor).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      competitorId,
    );
    await expect(response.json()).resolves.toEqual({
      data: { projectId, data: { competitorId } },
    });
  });

  it("rejects a malformed Competitor id as not found before service access", async () => {
    const response = await invoke("customer-private-competitor");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(JSON.stringify(body)).not.toContain("customer-private-competitor");
    expect(mocks.getProjectAuditCompetitor).not.toHaveBeenCalled();
  });
});
