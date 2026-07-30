import { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  createProductProfileSynthesisRun: vi.fn(),
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
vi.mock("@/lib/services/product-profile-synthesis", () => ({
  createProductProfileSynthesisRun: mocks.createProductProfileSynthesisRun,
}));

const { POST } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";
const statusUrl = `/api/mvp/projects/${projectId}/runs/${runId}`;
const sourcePageUrl = "https://relayops.com/customer-onboarding/";

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST Product Profile synthesis async contract", () => {
  it("returns a safely adoptable active-run pointer on conflict", async () => {
    mocks.createProductProfileSynthesisRun.mockRejectedValueOnce(
      new ProblemError(
        "RUN_ALREADY_ACTIVE",
        "A Product Profile synthesis run is already active.",
        {
          headers: { Location: statusUrl },
          current: { runId, statusUrl },
        },
      ),
    );

    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/product-profile/synthesis-runs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "profile-synthesis-active-winner",
            Origin: "http://localhost",
            "X-Request-Id": "request-profile-synthesis-active",
          },
          body: JSON.stringify({ baseVersion: 1 }),
        },
      ),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("Location")).toBe(statusUrl);
    await expect(response.json()).resolves.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      requestId: "request-profile-synthesis-active",
      current: { runId, statusUrl },
    });
  });

  it("validates, rate-limits and returns canonical 202 polling metadata", async () => {
    mocks.createProductProfileSynthesisRun.mockResolvedValueOnce({
      status: 202,
      run: {
        id: runId,
        projectId,
        kind: "product_profile_synthesis",
        status: "queued",
        progress: {
          phase: "queued",
          current: 0,
          total: null,
          messageKey: "run.queued",
        },
        lastError: null,
        resultRef: null,
        queuedAt: "2026-07-22T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
      },
      statusUrl,
      resourceRef: { type: "product_profile_run", id: runId },
      location: statusUrl,
      replayed: false,
    });

    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/product-profile/synthesis-runs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "profile-synthesis-route-key",
            Origin: "http://localhost",
            "X-Request-Id": "request-profile-synthesis",
          },
          body: JSON.stringify({ baseVersion: 1 }),
        },
      ),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("Location")).toBe(statusUrl);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(response.headers.get("X-Request-Id")).toBe(
      "request-profile-synthesis",
    );
    await expect(response.json()).resolves.toEqual({
      data: {
        run: expect.objectContaining({ id: runId, status: "queued" }),
        statusUrl,
        resourceRef: { type: "product_profile_run", id: runId },
      },
    });
    expect(mocks.assertWorkspaceRateLimit).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      {
        idempotencyKey: "profile-synthesis-route-key",
        scope: "product_profile_synthesis",
        maxAttempts: 20,
        windowMs: 15 * 60 * 1000,
      },
    );
    expect(mocks.createProductProfileSynthesisRun).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      "00000000-0000-4000-8000-000000000001",
      "profile-synthesis-route-key",
      { baseVersion: 1 },
    );
  });

  it("rejects a stale/extra client field before invoking the service", async () => {
    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/product-profile/synthesis-runs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "profile-synthesis-invalid-body",
            Origin: "http://localhost",
            "X-Request-Id": "request-profile-synthesis-invalid",
          },
          body: JSON.stringify({ baseVersion: 1, productUrl: sourcePageUrl }),
        },
      ),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      requestId: "request-profile-synthesis-invalid",
    });
    expect(mocks.createProductProfileSynthesisRun).not.toHaveBeenCalled();
  });

  it("requires an Idempotency-Key before rate limiting or invoking the service", async () => {
    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/product-profile/synthesis-runs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost",
            "X-Request-Id": "request-profile-synthesis-no-idem",
          },
          body: JSON.stringify({ baseVersion: 1 }),
        },
      ),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
      requestId: "request-profile-synthesis-no-idem",
    });
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createProductProfileSynthesisRun).not.toHaveBeenCalled();
  });

  it("rejects an invalid Idempotency-Key before rate limiting or invoking the service", async () => {
    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/product-profile/synthesis-runs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "x".repeat(129),
            Origin: "http://localhost",
            "X-Request-Id": "request-profile-synthesis-bad-idem",
          },
          body: JSON.stringify({ baseVersion: 1 }),
        },
      ),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
      requestId: "request-profile-synthesis-bad-idem",
    });
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createProductProfileSynthesisRun).not.toHaveBeenCalled();
  });

  it("treats an invalid project UUID as not found before rate limiting", async () => {
    const response = await POST(
      new NextRequest(
        "http://localhost/api/mvp/projects/not-a-uuid/product-profile/synthesis-runs",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "profile-synthesis-invalid-project",
            Origin: "http://localhost",
            "X-Request-Id": "request-profile-synthesis-invalid-project",
          },
          body: JSON.stringify({ baseVersion: 1 }),
        },
      ),
      { params: Promise.resolve({ projectId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      requestId: "request-profile-synthesis-invalid-project",
    });
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createProductProfileSynthesisRun).not.toHaveBeenCalled();
  });
});
