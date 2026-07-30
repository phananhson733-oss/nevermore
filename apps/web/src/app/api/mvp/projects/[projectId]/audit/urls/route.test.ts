import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProjectAuditUrls: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map", () => ({
  MAX_GROWTH_MAP_SEARCH_LENGTH: 256,
  listProjectAuditUrls: mocks.listProjectAuditUrls,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const diagnosticRunId = "a0000000-0000-7000-8000-000000000006";
const cursor = Buffer.from(
  "2026-07-21T00:00:00.000Z 00000000-0000-4000-8000-000000000004",
).toString("base64url");

function invoke(query = "", uiLocaleCookie?: string) {
  const headers = new Headers({
    "X-Request-Id": "request-growth-map-urls",
  });
  if (uiLocaleCookie !== undefined) {
    headers.set("cookie", `sf_ui_locale=${uiLocaleCookie}`);
  }
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/audit/urls${query}`,
      { headers },
    ),
    { params: Promise.resolve({ projectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listProjectAuditUrls.mockResolvedValue({
    projectId,
    siteId: "00000000-0000-4000-8000-000000000005",
    diagnosticRunId,
    crawlSnapshotId: "00000000-0000-4000-8000-000000000007",
    data: [],
    meta: {
      limit: 50,
      nextCursor: null,
      hasNext: false,
      coverage: { availability: "available", limitations: [] },
    },
  });
});

describe("GET project Growth Map URLs", () => {
  it("passes a canonical UUIDv7 pin with only validated bounded list options and workspace scope", async () => {
    const response = await invoke(
      `?limit=25&cursor=${cursor}&search=${encodeURIComponent("  onboarding / setup  ")}&diagnosticRunId=${diagnosticRunId}`,
    );

    expect(response.status).toBe(200);
    expect(mocks.listProjectAuditUrls).toHaveBeenCalledWith(
      {
        workspaceId: "00000000-0000-4000-8000-000000000002",
        uiLocale: "zh-CN",
      },
      projectId,
      {
        limit: 25,
        cursor,
        search: "onboarding / setup",
        diagnosticRunId,
      },
    );
    await expect(response.json()).resolves.toEqual({
      data: expect.objectContaining({ projectId, data: [] }),
    });
  });

  it("uses documented defaults only when optional query params are absent", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.listProjectAuditUrls).toHaveBeenCalledWith(
      {
        workspaceId: "00000000-0000-4000-8000-000000000002",
        uiLocale: "zh-CN",
      },
      projectId,
      {
        limit: 50,
        cursor: null,
        search: null,
        diagnosticRunId: null,
      },
    );
  });

  it("resolves an explicit sf_ui_locale cookie into the required service read scope", async () => {
    const response = await invoke("", "en");

    expect(response.status).toBe(200);
    expect(mocks.listProjectAuditUrls).toHaveBeenCalledWith(
      {
        workspaceId: "00000000-0000-4000-8000-000000000002",
        uiLocale: "en",
      },
      projectId,
      {
        limit: 50,
        cursor: null,
        search: null,
        diagnosticRunId: null,
      },
    );
  });

  it.each([
    ["limit", "0"],
    ["limit", "101"],
    ["cursor", "customer+private+cursor"],
    ["search", "   "],
    ["search", "x".repeat(257)],
    ["diagnosticRunId", "customer-private-run"],
    ["diagnosticRunId", diagnosticRunId.toUpperCase()],
  ])("rejects invalid %s without calling the service", async (name, value) => {
    const response = await invoke(`?${name}=${encodeURIComponent(value)}`);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      errors: [{ pointer: `/${name}`, code: "invalid_query_value" }],
    });
    expect(JSON.stringify(body)).not.toContain(value);
    expect(mocks.listProjectAuditUrls).not.toHaveBeenCalled();
  });

  it.each([
    ["limit", "25", "50"],
    ["cursor", cursor, cursor],
    ["search", "onboarding", "pricing"],
    ["diagnosticRunId", diagnosticRunId, diagnosticRunId],
  ])("rejects duplicate %s instead of choosing one value", async (name, first, second) => {
    const response = await invoke(
      `?${name}=${encodeURIComponent(first)}&${name}=${encodeURIComponent(second)}`,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      errors: [{ pointer: `/${name}`, code: "duplicate_query_parameter" }],
    });
    expect(mocks.listProjectAuditUrls).not.toHaveBeenCalled();
  });

  it("rejects unknown query parameters instead of silently widening the generation read", async () => {
    const response = await invoke(
      `?diagnosticRunId=${diagnosticRunId}&unexpected=customer-private-value`,
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      errors: [
        {
          pointer: "/unexpected",
          code: "unknown_query_parameter",
          message: "Unknown query parameter.",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("customer-private-value");
    expect(mocks.listProjectAuditUrls).not.toHaveBeenCalled();
  });
});
