import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAudit: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/audit-projection", () => ({
  getProjectAudit: mocks.getProjectAudit,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";

function invoke(uiLocaleCookie?: string) {
  const headers = new Headers({ "X-Request-Id": "request-audit" });
  if (uiLocaleCookie !== undefined) {
    headers.set("cookie", `sf_ui_locale=${uiLocaleCookie}`);
  }
  return GET(
    new NextRequest(`http://localhost/api/mvp/projects/${projectId}/audit`, {
      headers,
    }),
    { params: Promise.resolve({ projectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAudit.mockResolvedValue({ auditRunId: "audit", modules: [] });
});

describe("GET project growth audit", () => {
  it("passes the workspace scope and resolved UI locale to the service", async () => {
    const response = await invoke("en");
    expect(response.status).toBe(200);
    expect(mocks.getProjectAudit).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002", uiLocale: "en" },
      projectId,
    );
    await expect(response.json()).resolves.toEqual({
      data: { auditRunId: "audit", modules: [] },
    });
  });

  it("defaults the UI locale when the cookie is absent", async () => {
    await invoke();
    expect(mocks.getProjectAudit).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002", uiLocale: "zh-CN" },
      projectId,
    );
  });

  it("rejects a malformed project id without calling the service", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/mvp/projects/not-a-uuid/audit", {
        headers: new Headers({ "X-Request-Id": "request-audit" }),
      }),
      { params: Promise.resolve({ projectId: "not-a-uuid" }) },
    );
    expect(response.status).toBe(404);
    expect(mocks.getProjectAudit).not.toHaveBeenCalled();
  });
});
