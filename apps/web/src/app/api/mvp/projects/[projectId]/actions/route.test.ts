import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProjectActions: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/actions-service", () => ({
  listProjectActions: mocks.listProjectActions,
}));

const { GET } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const validCursor = Buffer.from(
  "2026-07-19T00:00:00.000Z 00000000-0000-4000-8000-000000000004",
).toString("base64url");

function request(query = ""): NextRequest {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/actions${query}`,
    { headers: { "X-Request-Id": "request-actions-list" } },
  );
}

async function invoke(query = "") {
  return GET(request(query), { params: Promise.resolve({ projectId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listProjectActions.mockResolvedValue({
    data: [],
    nextCursor: null,
    limit: 50,
  });
});

describe("GET project actions query contract", () => {
  it("passes validated lane/status/cursor/limit filters to the service", async () => {
    mocks.listProjectActions.mockResolvedValueOnce({
      data: [],
      nextCursor: validCursor,
      limit: 25,
    });

    const response = await invoke(
      `?lane=next&status=blocked&cursor=${validCursor}&limit=25`,
    );

    expect(response.status).toBe(200);
    expect(mocks.listProjectActions).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      {
        lane: "next",
        status: "blocked",
        cursor: validCursor,
        limit: 25,
      },
    );
    await expect(response.json()).resolves.toMatchObject({
      meta: { nextCursor: validCursor, hasNext: true, limit: 25 },
    });
  });

  it("uses documented defaults only when optional query params are absent", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.listProjectActions).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      { lane: null, status: null, cursor: null, limit: 50 },
    );
  });

  it.each([
    ["lane", "customer-private-lane"],
    ["status", "customer-private-status"],
    ["cursor", "customer+private+cursor"],
    ["limit", "customer-private-limit"],
  ])("rejects invalid %s with a stable non-reflective 422", async (name, value) => {
    const response = await invoke(`?${name}=${encodeURIComponent(value)}`);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(body).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      errors: [{ pointer: `/${name}`, code: "invalid_query_value" }],
    });
    expect(JSON.stringify(body)).not.toContain(value);
    expect(mocks.listProjectActions).not.toHaveBeenCalled();
  });

  it.each([
    ["lane", "now", "later"],
    ["status", "planned", "done"],
    ["cursor", validCursor, validCursor],
    ["limit", "25", "50"],
  ])("rejects duplicate %s instead of choosing one value", async (name, first, second) => {
    const response = await invoke(
      `?${name}=${encodeURIComponent(first)}&${name}=${encodeURIComponent(second)}`,
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      errors: [
        { pointer: `/${name}`, code: "duplicate_query_parameter" },
      ],
    });
    expect(mocks.listProjectActions).not.toHaveBeenCalled();
  });
});
