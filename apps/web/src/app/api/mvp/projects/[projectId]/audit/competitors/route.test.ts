import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProjectAuditCompetitors: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/growth-map-competitors", () => ({
  listProjectAuditCompetitors: mocks.listProjectAuditCompetitors,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const cursor = Buffer.from(
  "2026-07-22T00:00:00.000Z 00000000-0000-4000-8000-000000000004",
).toString("base64url");

function invoke(query = "", selectedProjectId = projectId) {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${selectedProjectId}/audit/competitors${query}`,
      { headers: { "X-Request-Id": "request-growth-map-competitors" } },
    ),
    { params: Promise.resolve({ projectId: selectedProjectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listProjectAuditCompetitors.mockResolvedValue({
    projectId,
    data: [],
    meta: {
      limit: 50,
      nextCursor: null,
      hasNext: false,
      coverage: {
        availability: "unavailable",
        limitations: ["No canonical Competitor Library entries are available."],
      },
    },
  });
});

describe("GET project Growth Map Competitor Library", () => {
  it("passes only a validated bounded cursor page and operator workspace scope", async () => {
    const response = await invoke(`?limit=25&cursor=${cursor}`);

    expect(response.status).toBe(200);
    expect(mocks.listProjectAuditCompetitors).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      { limit: 25, cursor },
    );
    await expect(response.json()).resolves.toEqual({
      data: expect.objectContaining({ projectId, data: [] }),
    });
  });

  it("uses documented defaults only when optional query params are absent", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.listProjectAuditCompetitors).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
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
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      errors: [{ pointer: `/${name}`, code: "invalid_query_value" }],
    });
    expect(JSON.stringify(body)).not.toContain(value);
    expect(mocks.listProjectAuditCompetitors).not.toHaveBeenCalled();
  });

  it.each([
    ["limit", "25", "50"],
    ["cursor", cursor, cursor],
  ])("rejects duplicate %s rather than choosing one value", async (name, first, second) => {
    const response = await invoke(
      `?${name}=${encodeURIComponent(first)}&${name}=${encodeURIComponent(second)}`,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      errors: [{ pointer: `/${name}`, code: "duplicate_query_parameter" }],
    });
    expect(mocks.listProjectAuditCompetitors).not.toHaveBeenCalled();
  });

  it("treats a malformed project id as not found before service access", async () => {
    const response = await invoke("", "customer-private-project");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(mocks.listProjectAuditCompetitors).not.toHaveBeenCalled();
  });
});
