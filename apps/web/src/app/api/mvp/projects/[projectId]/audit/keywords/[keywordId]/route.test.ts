import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectAuditKeyword: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map-keywords", () => ({
  getProjectAuditKeyword: mocks.getProjectAuditKeyword,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const keywordId = "00000000-0000-4000-8000-000000000004";

function invoke(selectedKeywordId = keywordId) {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/audit/keywords/${selectedKeywordId}`,
      { headers: { "X-Request-Id": "request-growth-map-keyword" } },
    ),
    {
      params: Promise.resolve({ projectId, keywordId: selectedKeywordId }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectAuditKeyword.mockResolvedValue({
    projectId,
    data: { keywordId },
  });
});

describe("GET selected Growth Map Keyword", () => {
  it("scopes the exact Keyword lookup to the operator workspace", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.getProjectAuditKeyword).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      keywordId,
    );
    await expect(response.json()).resolves.toEqual({
      data: { projectId, data: { keywordId } },
    });
  });

  it("rejects a malformed Keyword id as not found before service access", async () => {
    const response = await invoke("customer-private-keyword");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(JSON.stringify(body)).not.toContain("customer-private-keyword");
    expect(mocks.getProjectAuditKeyword).not.toHaveBeenCalled();
  });
});
