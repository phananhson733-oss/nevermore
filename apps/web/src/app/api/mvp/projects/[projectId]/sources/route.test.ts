import { NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProjectSources: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/sources", () => ({
  listProjectSources: mocks.listProjectSources,
}));

const { GET } = await import("./route");

const workspaceId = "00000000-0000-4000-8000-000000000002";
const projectId = "00000000-0000-4000-8000-000000000003";
const requestId = "request-sources-product-profile-gate";

function invoke() {
  return GET(
    new NextRequest(
      `http://localhost/api/mvp/projects/${projectId}/sources`,
      { headers: { "X-Request-Id": requestId } },
    ),
    { params: Promise.resolve({ projectId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET project Sources Product/ICP gate", () => {
  it("returns a problem response without source data when Product/ICP is unconfirmed", async () => {
    mocks.listProjectSources.mockRejectedValue(
      new ProblemError(
        "CONTEXT_INCOMPLETE",
        "Confirm the Product Profile and ICP before viewing source connections.",
      ),
    );

    const response = await invoke();
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(response.headers.get("X-Request-Id")).toBe(requestId);
    expect(body).toMatchObject({
      code: "CONTEXT_INCOMPLETE",
      status: 422,
      requestId,
    });
    expect(body).not.toHaveProperty("data");
  });

  it("returns the canonical source read model for an allowed project", async () => {
    mocks.listProjectSources.mockResolvedValue([]);

    const response = await invoke();

    expect(response.status).toBe(200);
    expect(mocks.listProjectSources).toHaveBeenCalledWith(
      { workspaceId },
      projectId,
    );
    await expect(response.json()).resolves.toEqual({ data: [] });
  });
});
