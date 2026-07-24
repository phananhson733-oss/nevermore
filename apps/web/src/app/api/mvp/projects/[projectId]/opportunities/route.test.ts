import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProjectOpportunities: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/opportunities", () => ({
  DEFAULT_OPPORTUNITY_PAGE_SIZE: 50,
  listProjectOpportunities: mocks.listProjectOpportunities,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const cursor = Buffer.from(
  "2026-07-21T00:00:00.000Z 00000000-0000-4000-8000-000000000004",
).toString("base64url");

function invoke(query = "") {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/opportunities${query}`,
      { headers: new Headers({ "X-Request-Id": "request-opportunities" }) },
    ),
    { params: Promise.resolve({ projectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listProjectOpportunities.mockResolvedValue({
    projectId,
    siteId: "00000000-0000-4000-8000-000000000005",
    diagnosticRunId: "00000000-0000-4000-8000-000000000006",
    data: [],
    meta: { limit: 50, nextCursor: null, hasNext: false },
  });
});

describe("GET project opportunities", () => {
  it("passes validated bounded list options and workspace scope", async () => {
    const response = await invoke(`?limit=25&cursor=${cursor}`);
    expect(response.status).toBe(200);
    expect(mocks.listProjectOpportunities).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002", uiLocale: "zh-CN" },
      projectId,
      { limit: 25, cursor },
    );
    await expect(response.json()).resolves.toEqual({
      data: expect.objectContaining({ projectId, data: [] }),
    });
  });

  it("uses the documented default when limit is absent", async () => {
    await invoke();
    expect(mocks.listProjectOpportunities).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002", uiLocale: "zh-CN" },
      projectId,
      { limit: 50, cursor: null },
    );
  });

  it.each([
    ["limit", "0"],
    ["limit", "101"],
    ["cursor", "customer+private+cursor"],
  ])("rejects invalid %s without calling the service", async (name, value) => {
    const response = await invoke(`?${name}=${encodeURIComponent(value)}`);
    expect(response.status).toBe(422);
    expect(mocks.listProjectOpportunities).not.toHaveBeenCalled();
  });
});
