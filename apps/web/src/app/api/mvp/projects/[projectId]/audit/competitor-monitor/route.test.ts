import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAuditCompetitorMonitor: vi.fn(),
  updateProjectAuditCompetitorMonitor: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "82000000-0000-4000-8000-000000000001",
    workspaceId: "82000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map-competitor-monitor", () => ({
  getProjectAuditCompetitorMonitor:
    mocks.getProjectAuditCompetitorMonitor,
  updateProjectAuditCompetitorMonitor:
    mocks.updateProjectAuditCompetitorMonitor,
}));

const { GET, PUT } = await import("./route");

const projectId = "82000000-0000-4000-8000-000000000003";
const config = {
  expectedRevision: 2,
  enabled: true,
  frequency: "monthly",
} as const;

function invokeGet(selectedProjectId = projectId) {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${selectedProjectId}/audit/competitor-monitor`,
      { headers: { "x-request-id": "request-competitor-monitor" } },
    ),
    { params: Promise.resolve({ projectId: selectedProjectId }) },
  );
}

function invokePut(body: unknown = config, selectedProjectId = projectId) {
  return PUT(
    new NextRequest(
      `http://localhost/api/mvp/projects/${selectedProjectId}/audit/competitor-monitor`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-request-id": "request-update-competitor-monitor",
        },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ projectId: selectedProjectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditCompetitorMonitor.mockResolvedValue({
    projectId,
    availability: "available",
  });
  mocks.updateProjectAuditCompetitorMonitor.mockResolvedValue({
    enabled: true,
    frequency: "monthly",
    revision: 3,
    updatedAt: "2026-07-28T00:00:00.000Z",
  });
});

describe("Growth Map competitor monitor API", () => {
  it("keeps GET as a workspace-scoped pure read", async () => {
    const response = await invokeGet();

    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditCompetitorMonitor).toHaveBeenCalledWith(
      { workspaceId: "82000000-0000-4000-8000-000000000002" },
      projectId,
    );
    expect(mocks.updateProjectAuditCompetitorMonitor).not.toHaveBeenCalled();
  });

  it("uses the server operator identity for the monthly settings command", async () => {
    const response = await invokePut();

    expect(response.status).toBe(200);
    expect(mocks.updateProjectAuditCompetitorMonitor).toHaveBeenCalledWith(
      { workspaceId: "82000000-0000-4000-8000-000000000002" },
      projectId,
      "82000000-0000-4000-8000-000000000001",
      config,
    );
  });

  it("rejects widened settings before service access", async () => {
    const response = await invokePut({
      ...config,
      frequency: "weekly",
      competitorId: "82000000-0000-4000-8000-000000000099",
    });

    expect(response.status).toBe(422);
    expect(mocks.updateProjectAuditCompetitorMonitor).not.toHaveBeenCalled();
  });

  it("rejects malformed project identity before service access", async () => {
    const response = await invokeGet("private-project");

    expect(response.status).toBe(404);
    expect(mocks.getProjectAuditCompetitorMonitor).not.toHaveBeenCalled();
  });
});
