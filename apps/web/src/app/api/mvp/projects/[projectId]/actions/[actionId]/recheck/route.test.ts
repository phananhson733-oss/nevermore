import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  createActionRecheck: vi.fn(),
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
vi.mock("@/lib/services/action-recheck", () => ({
  createActionRecheck: mocks.createActionRecheck,
}));

const { POST } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000003";
const actionId = "00000000-0000-4000-8000-000000000004";
const priorRunId = "00000000-0000-4000-8000-000000000005";
const runId = "00000000-0000-4000-8000-000000000006";
const auditRunId = "00000000-0000-4000-8000-000000000007";
const statusUrl = `/api/mvp/projects/${projectId}/runs/${runId}`;

const validBody = {
  actionId,
  priorRunId,
  targetScope: { kind: "http_status", ref: "404" },
  capabilityContractVersion: "growth-audit.0.3.0",
} as const;

function request(bodyValue: unknown, key = "recheck-route-key", path = actionId) {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/actions/${path}/recheck`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        Origin: "http://localhost",
        "X-Request-Id": "request-recheck",
      },
      body: JSON.stringify(bodyValue),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST action recheck async contract", () => {
  it("returns canonical 202 polling metadata with an audit_run resource", async () => {
    mocks.createActionRecheck.mockResolvedValueOnce({
      status: 202,
      run: {
        id: runId,
        projectId,
        kind: "diagnostic",
        status: "queued",
        progress: {
          phase: "queued",
          current: 0,
          total: null,
          messageKey: "run.queued",
        },
        lastError: null,
        resultRef: null,
        queuedAt: "2026-07-24T00:00:00.000Z",
        startedAt: null,
        completedAt: null,
      },
      statusUrl,
      resourceRef: { type: "audit_run", id: auditRunId },
      location: statusUrl,
      replayed: false,
    });

    const response = await POST(request(validBody), {
      params: Promise.resolve({ projectId, actionId }),
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("Location")).toBe(statusUrl);
    expect(response.headers.get("Retry-After")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      data: {
        run: expect.objectContaining({ id: runId, status: "queued" }),
        statusUrl,
        resourceRef: { type: "audit_run", id: auditRunId },
      },
    });
    expect(mocks.assertWorkspaceRateLimit).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      {
        idempotencyKey: "recheck-route-key",
        scope: "growth_audit_recheck",
        maxAttempts: 20,
        windowMs: 15 * 60 * 1000,
      },
    );
    expect(mocks.createActionRecheck).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      "00000000-0000-4000-8000-000000000001",
      "recheck-route-key",
      validBody,
    );
  });

  it("rejects an illegal capabilityContractVersion before invoking the service", async () => {
    const response = await POST(
      request({ ...validBody, capabilityContractVersion: "growth-audit.0.2.0" }),
      { params: Promise.resolve({ projectId, actionId }) },
    );
    expect(response.status).toBe(422);
    expect(mocks.createActionRecheck).not.toHaveBeenCalled();
  });

  it("rejects a body actionId that does not match the path", async () => {
    const response = await POST(
      request({
        ...validBody,
        actionId: "00000000-0000-4000-8000-0000000000ee",
      }),
      { params: Promise.resolve({ projectId, actionId }) },
    );
    expect(response.status).toBe(422);
    expect(mocks.createActionRecheck).not.toHaveBeenCalled();
  });

  it("requires an Idempotency-Key before rate limiting or invoking the service", async () => {
    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/actions/${actionId}/recheck`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost",
            "X-Request-Id": "request-recheck-no-idem",
          },
          body: JSON.stringify(validBody),
        },
      ),
      { params: Promise.resolve({ projectId, actionId }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createActionRecheck).not.toHaveBeenCalled();
  });

  it("treats an invalid project UUID as not found before rate limiting", async () => {
    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/not-a-uuid/actions/${actionId}/recheck`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "recheck-invalid-project",
            Origin: "http://localhost",
            "X-Request-Id": "request-recheck-invalid-project",
          },
          body: JSON.stringify(validBody),
        },
      ),
      { params: Promise.resolve({ projectId: "not-a-uuid", actionId }) },
    );
    expect(response.status).toBe(404);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createActionRecheck).not.toHaveBeenCalled();
  });
});
