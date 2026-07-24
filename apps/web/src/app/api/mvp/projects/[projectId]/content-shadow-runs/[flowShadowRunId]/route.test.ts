import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProblemError } from "@sf/observability";

const mocks = vi.hoisted(() => ({ getContentShadowRun: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/services/content-shadow", () => ({
  getContentShadowRun: mocks.getContentShadowRun,
}));

const { GET } = await import("./route.ts");

const projectId = "00000000-0000-4000-8000-000000000003";
const flowShadowRunId = "00000000-0000-4000-8000-000000000007";

function request(runId = flowShadowRunId) {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${projectId}/content-shadow-runs/${runId}`,
    { headers: { "X-Request-Id": "request-content-shadow-get" } },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET content shadow run", () => {
  it("returns the read-only projection inside the success envelope", async () => {
    const projection = { flowShadowRunId, phase: "queued", qa: null };
    mocks.getContentShadowRun.mockResolvedValueOnce(projection);

    const response = await GET(request(), {
      params: Promise.resolve({ projectId, flowShadowRunId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: projection });
    expect(mocks.getContentShadowRun).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      flowShadowRunId,
    );
  });

  it("reports an absent or foreign run as 404, never 403", async () => {
    mocks.getContentShadowRun.mockRejectedValueOnce(
      new ProblemError("NOT_FOUND", "Content Shadow run not found."),
    );

    const response = await GET(request(), {
      params: Promise.resolve({ projectId, flowShadowRunId }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("treats a malformed run id as absent without invoking the service", async () => {
    const response = await GET(request("not-a-uuid"), {
      params: Promise.resolve({ projectId, flowShadowRunId: "not-a-uuid" }),
    });

    // A malformed path id is 404, not 400: the shared param guard refuses to
    // leak whether any such resource could exist.
    expect(response.status).toBe(404);
    expect(mocks.getContentShadowRun).not.toHaveBeenCalled();
  });
});
