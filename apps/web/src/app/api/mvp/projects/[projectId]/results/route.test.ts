import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectResults: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/recheck-results", () => ({
  getProjectResults: mocks.getProjectResults,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";

function invoke(uiLocaleCookie?: string) {
  const headers = new Headers({ "X-Request-Id": "request-results" });
  if (uiLocaleCookie !== undefined) {
    headers.set("cookie", `sf_ui_locale=${uiLocaleCookie}`);
  }
  return GET(
    new NextRequest(`http://localhost/api/mvp/projects/${projectId}/results`, {
      headers,
    }),
    { params: Promise.resolve({ projectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectResults.mockResolvedValue({
    priorRunId: "prior",
    currentRunId: "current",
    rules: [],
    limitations: [],
  });
});

describe("GET project recheck results", () => {
  it("passes the workspace scope and resolved UI locale to the service", async () => {
    const response = await invoke("en");
    expect(response.status).toBe(200);
    expect(mocks.getProjectResults).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002", uiLocale: "en" },
      projectId,
    );
    await expect(response.json()).resolves.toEqual({
      data: {
        priorRunId: "prior",
        currentRunId: "current",
        rules: [],
        limitations: [],
      },
    });
  });

  it("defaults the UI locale when the cookie is absent", async () => {
    await invoke();
    expect(mocks.getProjectResults).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002", uiLocale: "zh-CN" },
      projectId,
    );
  });

  it("rejects a malformed project id without calling the service", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/mvp/projects/not-a-uuid/results", {
        headers: new Headers({ "X-Request-Id": "request-results" }),
      }),
      { params: Promise.resolve({ projectId: "not-a-uuid" }) },
    );
    expect(response.status).toBe(404);
    expect(mocks.getProjectResults).not.toHaveBeenCalled();
  });
});
