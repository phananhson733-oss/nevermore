import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectOpportunity: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/opportunities", () => ({
  getProjectOpportunity: mocks.getProjectOpportunity,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const opportunityId = "00000000-0000-4000-8000-000000000007";

function invoke(id: string) {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/opportunities/${id}`,
      { headers: new Headers({ "X-Request-Id": "request-opportunity" }) },
    ),
    { params: Promise.resolve({ projectId, opportunityId: id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectOpportunity.mockResolvedValue({
    projectId,
    siteId: "00000000-0000-4000-8000-000000000005",
    diagnosticRunId: "00000000-0000-4000-8000-000000000006",
    data: { readiness: "reviewable" },
  });
});

describe("GET project opportunity detail", () => {
  it("passes the validated opportunity id (primary finding) to the service", async () => {
    const response = await invoke(opportunityId);
    expect(response.status).toBe(200);
    expect(mocks.getProjectOpportunity).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002", uiLocale: "zh-CN" },
      projectId,
      opportunityId,
    );
  });

  it("rejects a malformed opportunity id without calling the service", async () => {
    const response = await invoke("not-a-uuid");
    expect(response.status).toBe(404);
    expect(mocks.getProjectOpportunity).not.toHaveBeenCalled();
  });
});
