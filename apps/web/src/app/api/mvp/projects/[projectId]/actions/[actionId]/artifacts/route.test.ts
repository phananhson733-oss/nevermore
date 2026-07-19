import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkspaceRateLimit: vi.fn(),
  createActionArtifact: vi.fn(),
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

vi.mock("@/lib/services/artifacts", () => ({
  createActionArtifact: mocks.createActionArtifact,
}));

const { POST } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const actionId = "00000000-0000-4000-8000-000000000004";
const runId = "00000000-0000-4000-8000-000000000005";
const artifactId = "00000000-0000-4000-8000-000000000006";
const statusUrl = `/api/mvp/projects/${projectId}/runs/${runId}`;

const artifactTypes = [
  "technical_ticket",
  "metadata_rewrite",
  "content_brief",
] as const;

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST action artifact async contract (AC-031)", () => {
  it.each(artifactTypes)(
    "%s always responds 202 with the canonical statusUrl and polling headers",
    async (artifactType) => {
      mocks.createActionArtifact.mockResolvedValueOnce({
        status: 202,
        run: {
          id: runId,
          projectId,
          kind: "artifact_generation",
          status: "queued",
          progress: {
            phase: "queued",
            current: 0,
            total: null,
            messageKey: "run.queued",
          },
          lastError: null,
          resultRef: null,
          queuedAt: "2026-07-18T00:00:00.000Z",
          startedAt: null,
          completedAt: null,
        },
        statusUrl,
        resourceRef: { type: "artifact", id: artifactId },
        location: statusUrl,
      });

      const requestId = `request-ac031-${artifactType}`;
      const idempotencyKey = `idem-ac031-${artifactType}`;
      const response = await POST(
        new NextRequest(
          `http://localhost/api/mvp/projects/${projectId}/actions/${actionId}/artifacts`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey,
              Origin: "http://localhost",
              "X-Request-Id": requestId,
            },
            body: JSON.stringify({
              artifactType,
              generationMode: "template",
              outputLocale: "en",
              operatorInstructions: null,
            }),
          },
        ),
        { params: Promise.resolve({ projectId, actionId }) },
      );

      expect(response.status).toBe(202);
      expect(response.headers.get("Location")).toBe(statusUrl);
      expect(response.headers.get("Retry-After")).toBe("1");
      expect(response.headers.get("X-Request-Id")).toBe(requestId);
      await expect(response.json()).resolves.toEqual({
        data: {
          run: expect.objectContaining({ id: runId, status: "queued" }),
          statusUrl,
          resourceRef: { type: "artifact", id: artifactId },
        },
      });
      expect(mocks.assertWorkspaceRateLimit).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000002",
        expect.objectContaining({
          idempotencyKey,
          scope: "artifact_generation",
        }),
      );
      expect(mocks.createActionArtifact).toHaveBeenCalledWith(
        { workspaceId: "00000000-0000-4000-8000-000000000002" },
        projectId,
        actionId,
        "00000000-0000-4000-8000-000000000001",
        idempotencyKey,
        expect.objectContaining({ artifactType }),
      );
    },
  );
});
