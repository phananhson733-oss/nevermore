import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION } from "@sf/contracts";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  createContentShadowRun: vi.fn(),
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
vi.mock("@/lib/services/content-shadow", () => ({
  createContentShadowRun: mocks.createContentShadowRun,
}));

const { POST } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000003";
const actionId = "00000000-0000-4000-8000-000000000004";
const keywordId = "00000000-0000-4000-8000-000000000005";
const runId = "00000000-0000-4000-8000-000000000006";
const flowShadowRunId = "00000000-0000-4000-8000-000000000007";
const statusUrl = `/api/mvp/projects/${projectId}/runs/${runId}`;
const IDEMPOTENCY_KEY = "content-shadow-route-key";

const validBody = {
  actionId,
  competitorEntityIds: [],
  searchCluster: { clusterKey: "onboarding", keywordEntityIds: [keywordId] },
  generativeQueryEntityIds: [],
  outputLocale: "en",
  capabilityContractVersion: CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
};

function request(bodyValue: unknown, idempotencyKey = IDEMPOTENCY_KEY) {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/content-shadow-runs`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        Origin: "http://localhost",
        "X-Request-Id": "request-content-shadow",
      },
      body: JSON.stringify(bodyValue),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST content shadow async contract", () => {
  it("returns canonical 202 polling metadata with a flow_shadow_run resource", async () => {
    mocks.createContentShadowRun.mockResolvedValueOnce({
      status: 202,
      run: {
        id: runId,
        projectId,
        kind: "content_shadow",
        status: "queued",
        progress: {
          phase: "queued",
          current: 0,
          total: null,
          messageKey: "run.queued",
        },
        lastError: null,
        resultRef: null,
        queuedAt: "2026-07-25T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
      },
      statusUrl,
      resourceRef: { type: "flow_shadow_run", id: flowShadowRunId },
      location: statusUrl,
      replayed: false,
    });

    const response = await POST(request(validBody), {
      params: Promise.resolve({ projectId }),
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("Location")).toBe(statusUrl);
    expect(response.headers.get("Retry-After")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      data: {
        run: expect.objectContaining({ id: runId, status: "queued" }),
        statusUrl,
        resourceRef: { type: "flow_shadow_run", id: flowShadowRunId },
      },
    });
    expect(mocks.assertWorkspaceRateLimit).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      {
        idempotencyKey: IDEMPOTENCY_KEY,
        scope: "content_shadow_run",
        maxAttempts: 20,
        windowMs: 15 * 60 * 1000,
      },
    );
  });

  it("rejects a foreign capabilityContractVersion before invoking the service", async () => {
    const response = await POST(
      request({
        ...validBody,
        capabilityContractVersion: "content-shadow.0.2.0",
      }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(mocks.createContentShadowRun).not.toHaveBeenCalled();
  });

  it("rejects an operator-chosen flow adapter version", async () => {
    const response = await POST(
      request({
        ...validBody,
        flowAdapterVersion: "content-shadow-adapter.9.9.9",
      }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.createContentShadowRun).not.toHaveBeenCalled();
  });

  it("rejects a request that collapses search and generative observation", async () => {
    const response = await POST(
      request({ ...validBody, generativeQueryEntityIds: [keywordId] }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.createContentShadowRun).not.toHaveBeenCalled();
  });

  it("requires an Idempotency-Key before rate limiting or invoking the service", async () => {
    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/content-shadow-runs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost",
            "X-Request-Id": "request-content-shadow-no-idem",
          },
          body: JSON.stringify(validBody),
        },
      ),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createContentShadowRun).not.toHaveBeenCalled();
  });
});
