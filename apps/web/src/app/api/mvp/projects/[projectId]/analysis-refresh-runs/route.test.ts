import { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  createAnalysisRefreshRun: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/http/rate-limit", () => ({
  assertWorkspaceRateLimit: mocks.assertWorkspaceRateLimit,
}));
vi.mock("@/lib/services/analysis-refresh", () => ({
  createAnalysisRefreshRun: mocks.createAnalysisRefreshRun,
}));

const { POST } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";
const statusUrl = `/api/mvp/projects/${projectId}/runs/${runId}`;

function request(
  body: unknown,
  options: { readonly idempotencyKey?: string; readonly includeBody?: boolean } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: "http://localhost",
    "X-Request-Id": "request-analysis-refresh",
  };
  if (options.idempotencyKey !== "") {
    headers["Idempotency-Key"] =
      options.idempotencyKey ?? "analysis-refresh-route-key";
  }
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/analysis-refresh-runs`,
    {
      method: "POST",
      headers,
      ...(options.includeBody === false
        ? {}
        : { body: JSON.stringify(body) }),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST analysis refresh async contract", () => {
  it("accepts an explicit empty object and returns canonical polling metadata", async () => {
    mocks.createAnalysisRefreshRun.mockResolvedValueOnce({
      status: 202,
      run: {
        id: runId,
        projectId,
        kind: "analysis_refresh",
        status: "queued",
        progress: {
          phase: "queued",
          current: 0,
          total: null,
          messageKey: "run.queued",
        },
        lastError: null,
        resultRef: { type: "analysis_refresh_run", id: runId },
        queuedAt: "2026-07-29T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
      },
      statusUrl,
      resourceRef: { type: "analysis_refresh_run", id: runId },
      location: statusUrl,
      replayed: false,
    });

    const response = await POST(request({}), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("Location")).toBe(statusUrl);
    expect(response.headers.get("Retry-After")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      data: {
        run: expect.objectContaining({
          id: runId,
          kind: "analysis_refresh",
          status: "queued",
        }),
        statusUrl,
        resourceRef: { type: "analysis_refresh_run", id: runId },
      },
    });
    expect(mocks.assertWorkspaceRateLimit).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      {
        idempotencyKey: "analysis-refresh-route-key",
        scope: "analysis_refresh_run",
        maxAttempts: 20,
        windowMs: 15 * 60 * 1000,
      },
    );
    expect(mocks.createAnalysisRefreshRun).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      "00000000-0000-4000-8000-000000000001",
      "analysis-refresh-route-key",
      {},
    );
  });

  it.each([
    ["unknown members", { siteId: runId }],
    ["a null body", null],
    ["an array body", []],
  ])("rejects %s under the strict empty-object contract", async (_name, body) => {
    const response = await POST(request(body), {
      params: Promise.resolve({ projectId }),
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(mocks.createAnalysisRefreshRun).not.toHaveBeenCalled();
  });

  it("also accepts an omitted optional request body as the same empty command", async () => {
    mocks.createAnalysisRefreshRun.mockResolvedValueOnce({
      status: 202,
      run: {
        id: runId,
        projectId,
        kind: "analysis_refresh",
        status: "queued",
        progress: {
          phase: "queued",
          current: 0,
          total: null,
          messageKey: "run.queued",
        },
        lastError: null,
        resultRef: { type: "analysis_refresh_run", id: runId },
        queuedAt: "2026-07-29T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
      },
      statusUrl,
      resourceRef: { type: "analysis_refresh_run", id: runId },
      location: statusUrl,
      replayed: false,
    });
    const response = await POST(request({}, { includeBody: false }), {
      params: Promise.resolve({ projectId }),
    });
    expect(response.status).toBe(202);
    expect(mocks.createAnalysisRefreshRun).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
      expect.any(String),
      "analysis-refresh-route-key",
      {},
    );
  });

  it("requires Idempotency-Key before rate limiting", async () => {
    const response = await POST(request({}, { idempotencyKey: "" }), {
      params: Promise.resolve({ projectId }),
    });
    expect(response.status).toBe(400);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createAnalysisRefreshRun).not.toHaveBeenCalled();
  });

  it("preserves the active run pointer in both Location and the problem body", async () => {
    mocks.createAnalysisRefreshRun.mockRejectedValueOnce(
      new ProblemError(
        "RUN_ALREADY_ACTIVE",
        "An Analysis Refresh run is already active.",
        {
          headers: { Location: statusUrl },
          current: { runId, statusUrl },
        },
      ),
    );

    const response = await POST(request({}), {
      params: Promise.resolve({ projectId }),
    });
    expect(response.status).toBe(409);
    expect(response.headers.get("Location")).toBe(statusUrl);
    await expect(response.json()).resolves.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      current: { runId, statusUrl },
    });
  });
});
