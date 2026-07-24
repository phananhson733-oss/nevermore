import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION } from "@sf/contracts";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  createGrowthAuditRun: vi.fn(),
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
vi.mock("@/lib/services/audit-runs", () => ({
  createGrowthAuditRun: mocks.createGrowthAuditRun,
}));

const { POST } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000003";
const siteId = "00000000-0000-4000-8000-000000000005";
const icpProfileId = "00000000-0000-4000-8000-000000000006";
const runId = "00000000-0000-4000-8000-000000000004";
const auditRunId = "00000000-0000-4000-8000-000000000007";
const statusUrl = `/api/mvp/projects/${projectId}/runs/${runId}`;

const validBody = {
  siteId,
  icpProfileId,
  scope: { kind: "site" },
  outputLocale: "en",
  capabilityContractVersion: GROWTH_AUDIT_CAPABILITY_CONTRACT_VERSION,
};

function request(bodyValue: unknown, idempotencyKey = "growth-audit-route-key") {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/audit-runs`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        Origin: "http://localhost",
        "X-Request-Id": "request-growth-audit",
      },
      body: JSON.stringify(bodyValue),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST growth audit async contract", () => {
  it("returns canonical 202 polling metadata with an audit_run resource", async () => {
    mocks.createGrowthAuditRun.mockResolvedValueOnce({
      status: 202,
      run: {
        id: runId,
        projectId,
        kind: "diagnostic",
        status: "queued",
        progress: { phase: "queued", current: 0, total: null, messageKey: "run.queued" },
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
      params: Promise.resolve({ projectId }),
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
        idempotencyKey: "growth-audit-route-key",
        scope: "growth_audit_run",
        maxAttempts: 20,
        windowMs: 15 * 60 * 1000,
      },
    );
    expect(mocks.createGrowthAuditRun).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      "00000000-0000-4000-8000-000000000001",
      "growth-audit-route-key",
      validBody,
    );
  });

  it("rejects an illegal capabilityContractVersion before invoking the service", async () => {
    const response = await POST(
      request({ ...validBody, capabilityContractVersion: "growth-audit.0.2.0" }),
      { params: Promise.resolve({ projectId }) },
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    expect(mocks.createGrowthAuditRun).not.toHaveBeenCalled();
  });

  it("requires an Idempotency-Key before rate limiting or invoking the service", async () => {
    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/audit-runs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost",
            "X-Request-Id": "request-growth-audit-no-idem",
          },
          body: JSON.stringify(validBody),
        },
      ),
      { params: Promise.resolve({ projectId }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createGrowthAuditRun).not.toHaveBeenCalled();
  });

  it("treats an invalid project UUID as not found before rate limiting", async () => {
    const response = await POST(
      new NextRequest(
        "http://localhost/api/mvp/projects/not-a-uuid/audit-runs",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "growth-audit-invalid-project",
            Origin: "http://localhost",
            "X-Request-Id": "request-growth-audit-invalid-project",
          },
          body: JSON.stringify(validBody),
        },
      ),
      { params: Promise.resolve({ projectId: "not-a-uuid" }) },
    );
    expect(response.status).toBe(404);
    expect(mocks.assertWorkspaceRateLimit).not.toHaveBeenCalled();
    expect(mocks.createGrowthAuditRun).not.toHaveBeenCalled();
  });
});
