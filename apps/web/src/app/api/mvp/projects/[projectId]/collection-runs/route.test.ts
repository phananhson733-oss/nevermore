import { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCollectionRun: vi.fn(),
  assertWorkspaceRateLimit: vi.fn(),
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

vi.mock("@/lib/services/collection", () => ({
  createCollectionRun: mocks.createCollectionRun,
}));

const { POST } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";
const statusUrl = `/api/mvp/projects/${projectId}/runs/${runId}`;

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST collection-runs active conflict contract (AC-019)", () => {
  it("returns current runId/statusUrl in problem body and the identical Location header", async () => {
    const options = {
      headers: { Location: statusUrl },
      current: { runId, statusUrl },
    };
    mocks.createCollectionRun.mockRejectedValueOnce(
      new ProblemError(
        "RUN_ALREADY_ACTIVE",
        "A collection run is already active.",
        options,
      ),
    );

    const response = await POST(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/collection-runs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": "ac019-route-contract",
            Origin: "http://localhost",
            "X-Request-Id": "request-ac019-route",
          },
          body: JSON.stringify({ provider: "crawl" }),
        },
      ),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(response.headers.get("Location")).toBe(statusUrl);
    expect(response.headers.get("X-Request-Id")).toBe(
      "request-ac019-route",
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      requestId: "request-ac019-route",
      current: { runId, statusUrl },
    });
  });

  it.each([
    [
      "the internal DataForSEO provider",
      { provider: "dataforseo" },
      "/provider",
      "invalid_value",
    ],
    [
      "a provider API key",
      {
        provider: "crawl",
        apiKey: "must-never-cross-the-customer-boundary",
      },
      "",
      "unrecognized_keys",
    ],
  ] as const)(
    "rejects %s at request validation without invoking the collection service",
    async (_label, body, pointer, issueCode) => {
      const response = await POST(
        new NextRequest(
          `http://localhost/api/mvp/projects/${projectId}/collection-runs`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": "public-collection-boundary",
              Origin: "http://localhost",
              "X-Request-Id": "request-public-collection-boundary",
            },
            body: JSON.stringify(body),
          },
        ),
        { params: Promise.resolve({ projectId }) },
      );

      expect(response.status).toBe(422);
      expect(response.headers.get("content-type")).toContain(
        "application/problem+json",
      );
      await expect(response.json()).resolves.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        requestId: "request-public-collection-boundary",
        errors: expect.arrayContaining([
          expect.objectContaining({ pointer, code: issueCode }),
        ]),
      });
      expect(mocks.createCollectionRun).not.toHaveBeenCalled();
    },
  );
});
