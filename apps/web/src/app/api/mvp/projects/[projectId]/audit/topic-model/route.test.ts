import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAuditTopicModelWorkspace: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "81000000-0000-4000-8000-000000000001",
    workspaceId: "81000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map-topic-model", () => ({
  getProjectAuditTopicModelWorkspace:
    mocks.getProjectAuditTopicModelWorkspace,
}));

const { GET } = await import("./route");

const projectId = "81000000-0000-4000-8000-000000000003";

function invoke(selectedProjectId = projectId) {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${selectedProjectId}/audit/topic-model`,
      { headers: { "x-request-id": "request-topic-model-workspace" } },
    ),
    { params: Promise.resolve({ projectId: selectedProjectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditTopicModelWorkspace.mockResolvedValue({
    projectId,
    latestConfirmed: null,
    draft: null,
    generatedAt: "2026-07-28T00:00:00.000Z",
  });
});

describe("GET Growth Map Topic Model workspace", () => {
  it("scopes the confirmed-and-draft projection to the operator workspace", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(
      mocks.getProjectAuditTopicModelWorkspace,
    ).toHaveBeenCalledWith(
      { workspaceId: "81000000-0000-4000-8000-000000000002" },
      projectId,
    );
    await expect(response.json()).resolves.toEqual({
      data: {
        projectId,
        latestConfirmed: null,
        draft: null,
        generatedAt: "2026-07-28T00:00:00.000Z",
      },
    });
  });

  it("rejects a malformed project identity before service access", async () => {
    const response = await invoke("customer-private-project");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(
      mocks.getProjectAuditTopicModelWorkspace,
    ).not.toHaveBeenCalled();
  });
});
