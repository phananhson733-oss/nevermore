import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAuditTopicModelInsights: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "96000000-0000-4000-8000-000000000001",
    workspaceId: "96000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map-topic-model-insights", () => ({
  getProjectAuditTopicModelInsights:
    mocks.getProjectAuditTopicModelInsights,
}));

const { GET } = await import("./route");
const projectId = "96000000-0000-4000-8000-000000000003";

function invoke(
  selectedProjectId = projectId,
  query = "",
) {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${selectedProjectId}/audit/topic-model/insights${query}`,
      { headers: { "x-request-id": "request-topic-insights" } },
    ),
    { params: Promise.resolve({ projectId: selectedProjectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditTopicModelInsights.mockResolvedValue({
    projectId,
    topicModelRevision: null,
    nodes: [],
    coverage: {
      availability: "unavailable",
      limitations: ["尚无已确认的 Topic Model。"],
    },
    generatedAt: "2026-07-28T06:00:00.000Z",
  });
});

describe("GET confirmed Topic Model insights", () => {
  it("scopes the read to the server-resolved operator workspace", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(
      mocks.getProjectAuditTopicModelInsights,
    ).toHaveBeenCalledWith(
      { workspaceId: "96000000-0000-4000-8000-000000000002" },
      projectId,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        projectId,
        topicModelRevision: null,
        nodes: [],
      },
    });
  });

  it("rejects malformed project identity before service access", async () => {
    const response = await invoke("customer-private-project");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(
      mocks.getProjectAuditTopicModelInsights,
    ).not.toHaveBeenCalled();
  });

  it("rejects client-authored revision, draft, or filter state", async () => {
    const response = await invoke(
      projectId,
      "?revision=99&includeDraft=true&actorId=customer-private-actor",
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(
      mocks.getProjectAuditTopicModelInsights,
    ).not.toHaveBeenCalled();
  });
});
