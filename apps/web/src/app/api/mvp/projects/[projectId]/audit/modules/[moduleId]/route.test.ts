import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAuditModule: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/audit-projection", () => ({
  getProjectAuditModule: mocks.getProjectAuditModule,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";

function invoke(moduleId: string) {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/audit/modules/${moduleId}`,
      { headers: new Headers({ "X-Request-Id": "request-module" }) },
    ),
    { params: Promise.resolve({ projectId, moduleId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditModule.mockResolvedValue({
    moduleId: "technical_search",
    coverageState: "no_data",
  });
});

describe("GET project audit module", () => {
  it("passes a valid module id from the canonical taxonomy", async () => {
    const response = await invoke("technical_search");
    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditModule).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002", uiLocale: "zh-CN" },
      projectId,
      "technical_search",
    );
  });

  it("rejects an unknown module id without calling the service", async () => {
    const response = await invoke("not_a_module");
    expect(response.status).toBe(404);
    expect(mocks.getProjectAuditModule).not.toHaveBeenCalled();
  });
});
