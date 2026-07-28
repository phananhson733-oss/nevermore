import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  createMeasurementWindow: vi.fn(),
  listProjectMeasurementWindowHistory: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "93000000-0000-4000-8000-000000000001",
    workspaceId: "93000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/measurement", () => ({
  DEFAULT_MEASUREMENT_WINDOW_HISTORY_LIMIT: 50,
  createMeasurementWindow: mocks.createMeasurementWindow,
  listProjectMeasurementWindowHistory:
    mocks.listProjectMeasurementWindowHistory,
}));
vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceRateLimit: mocks.assertWorkspaceRateLimit,
}));

const route = await import("./route");
const { GET, POST } = route;

const projectId = "93000000-0000-4000-8000-000000000003";
const sitePageId = "93000000-0000-4000-8000-000000000004";
const targetRef = `site-page://${sitePageId}`;
const changeReceiptId =
  "93000000-0000-4000-8000-000000000005";
const measurementWindowId =
  "93000000-0000-4000-8000-000000000006";
const asyncRunId = "93000000-0000-4000-8000-000000000007";
const createBody = {
  changeReceiptId,
  idempotencyKey: "measurement-window-route-1",
};

function query(overrides?: {
  readonly sitePageId?: string;
  readonly targetRef?: string;
  readonly limit?: string;
}): string {
  const params = new URLSearchParams();
  if (overrides?.sitePageId !== "") {
    params.set("sitePageId", overrides?.sitePageId ?? sitePageId);
  }
  if (overrides?.targetRef !== "") {
    params.set("targetRef", overrides?.targetRef ?? targetRef);
  }
  if (overrides?.limit !== undefined) {
    params.set("limit", overrides.limit);
  }
  return `?${params.toString()}`;
}

function invoke(search = query(), selectedProjectId = projectId) {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${selectedProjectId}/measurement-windows${search}`,
      { headers: { "X-Request-Id": "request-measurement-history" } },
    ),
    { params: Promise.resolve({ projectId: selectedProjectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createMeasurementWindow.mockResolvedValue({
    measurementWindowId,
    asyncRunId,
    state: "pending",
    replayed: false,
    location: `/api/mvp/projects/${projectId}/runs/${asyncRunId}`,
  });
  mocks.listProjectMeasurementWindowHistory.mockResolvedValue({
    projectId,
    target: { kind: "url", targetRef, sitePageId },
    windows: [],
    generatedAt: "2026-07-28T08:09:10.123Z",
  });
});

describe("GET project Measurement Window history", () => {
  it("passes only a validated exact target, bounded limit, and operator scope", async () => {
    const response = await invoke(query({ limit: "25" }));

    expect(response.status).toBe(200);
    expect(mocks.listProjectMeasurementWindowHistory).toHaveBeenCalledWith(
      { workspaceId: "93000000-0000-4000-8000-000000000002" },
      projectId,
      { kind: "url", targetRef, sitePageId },
      { limit: 25 },
    );
    await expect(response.json()).resolves.toEqual({
      data: {
        projectId,
        target: { kind: "url", targetRef, sitePageId },
        windows: [],
        generatedAt: "2026-07-28T08:09:10.123Z",
      },
    });
  });

  it("uses the bounded default only when limit is absent", async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.listProjectMeasurementWindowHistory).toHaveBeenCalledWith(
      { workspaceId: "93000000-0000-4000-8000-000000000002" },
      projectId,
      { kind: "url", targetRef, sitePageId },
      { limit: 50 },
    );
  });

  it.each([
    {
      name: "missing sitePageId",
      search: query({ sitePageId: "" }),
      pointer: "/sitePageId",
    },
    {
      name: "missing targetRef",
      search: query({ targetRef: "" }),
      pointer: "/targetRef",
    },
    {
      name: "invalid sitePageId",
      search: query({ sitePageId: "customer-private-page" }),
      pointer: "/sitePageId",
    },
    {
      name: "empty targetRef",
      search: query({ targetRef: " " }),
      pointer: "/targetRef",
    },
    {
      name: "zero limit",
      search: query({ limit: "0" }),
      pointer: "/limit",
    },
    {
      name: "oversized limit",
      search: query({ limit: "101" }),
      pointer: "/limit",
    },
  ])(
    "rejects $name without calling the service",
    async ({ search, pointer }) => {
      const response = await invoke(search);

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        errors: [{ pointer }],
      });
      expect(
        mocks.listProjectMeasurementWindowHistory,
      ).not.toHaveBeenCalled();
    },
  );

  it.each(["sitePageId", "targetRef", "limit"])(
    "rejects a duplicate %s rather than choosing one value",
    async (name) => {
      const search = `${query({ limit: "25" })}&${name}=${encodeURIComponent(
        name === "sitePageId"
          ? sitePageId
          : name === "targetRef"
            ? targetRef
            : "25",
      )}`;
      const response = await invoke(search);

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
        errors: [
          {
            pointer: `/${name}`,
            code: "duplicate_query_parameter",
          },
        ],
      });
      expect(
        mocks.listProjectMeasurementWindowHistory,
      ).not.toHaveBeenCalled();
    },
  );

  it("treats a malformed project id as not found before service access", async () => {
    const response = await invoke(query(), "customer-private-project");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(mocks.listProjectMeasurementWindowHistory).not.toHaveBeenCalled();
  });

});

function createRequest(
  body: unknown = createBody,
  key: string | null = createBody.idempotencyKey,
) {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/measurement-windows`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key === null ? {} : { "idempotency-key": key }),
        origin: "http://localhost",
        "x-request-id": "request-measurement-window",
      },
      body: JSON.stringify(body),
    },
  );
}

describe("POST project Measurement Window", () => {
  it("returns strict 202 polling metadata for the server-frozen measurement run", async () => {
    const response = await POST(createRequest(), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("Location")).toBe(
      `/api/mvp/projects/${projectId}/runs/${asyncRunId}`,
    );
    expect(response.headers.get("Retry-After")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      data: {
        measurementWindowId,
        asyncRunId,
        state: "pending",
        replayed: false,
      },
    });
    expect(mocks.assertWorkspaceRateLimit).toHaveBeenCalledWith(
      "93000000-0000-4000-8000-000000000002",
      {
        idempotencyKey: createBody.idempotencyKey,
        scope: "measurement_window",
        maxAttempts: 20,
        windowMs: 15 * 60 * 1_000,
      },
    );
    expect(mocks.createMeasurementWindow).toHaveBeenCalledWith(
      { workspaceId: "93000000-0000-4000-8000-000000000002" },
      projectId,
      "93000000-0000-4000-8000-000000000001",
      createBody.idempotencyKey,
      createBody,
    );
  });

  it("rejects browser-authored target, windows, delivery receipt, or result facts", async () => {
    const response = await POST(
      createRequest({
        ...createBody,
        deliveryReceiptId: changeReceiptId,
        target: { kind: "url", targetRef, sitePageId },
        afterWindow: {
          startAt: "2026-07-01T00:00:00.000Z",
          endAt: "2026-07-29T00:00:00.000Z",
        },
        state: "observed",
      }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.createMeasurementWindow).not.toHaveBeenCalled();
  });

  it("requires Idempotency-Key before rate limiting or service access", async () => {
    const response = await POST(createRequest(createBody, null), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(400);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createMeasurementWindow).not.toHaveBeenCalled();
  });

  it("rejects malformed project identity before rate limiting", async () => {
    const response = await POST(createRequest(), {
      params: Promise.resolve({ projectId: "foreign-private-project" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createMeasurementWindow).not.toHaveBeenCalled();
  });
});
