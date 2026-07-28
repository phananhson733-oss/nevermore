import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOperatorContext: vi.fn(),
  getArtifactExecutionStateBatch: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: mocks.getOperatorContext,
}));
vi.mock("@/lib/services/action-execution-state", () => ({
  getArtifactExecutionStateBatch:
    mocks.getArtifactExecutionStateBatch,
}));

const { GET } = await import("./route.ts");

const ids = {
  workspace: "b3000000-0000-4000-8000-000000000001",
  project: "b3000000-0000-4000-8000-000000000002",
  artifact: "b3000000-0000-4000-8000-000000000003",
  artifactTwo: "b3000000-0000-4000-8000-000000000004",
} as const;
const params = {
  params: Promise.resolve({ projectId: ids.project }),
};
const batch = {
  projectId: ids.project,
  items: [
    {
      actionId: "b3000000-0000-4000-8000-000000000005",
      artifactId: ids.artifact,
      current: null,
    },
    {
      actionId: "b3000000-0000-4000-8000-000000000006",
      artifactId: ids.artifactTwo,
      current: null,
    },
  ],
};

function request(query: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/mvp/projects/${ids.project}/artifacts/execution-states${query}`,
    {
      headers: {
        Origin: "http://localhost",
        "X-Request-Id": "request-execution-batch-get",
      },
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.getOperatorContext.mockResolvedValue({
    userId: "b3000000-0000-4000-8000-000000000009",
    workspaceId: ids.workspace,
  });
  mocks.getArtifactExecutionStateBatch.mockResolvedValue(batch);
});

mocks.getOperatorContext.mockResolvedValue({
  userId: "b3000000-0000-4000-8000-000000000009",
  workspaceId: ids.workspace,
});
mocks.getArtifactExecutionStateBatch.mockResolvedValue(batch);

describe("Artifact execution state batch route", () => {
  it("reads a unique project-scoped Artifact batch in one service call", async () => {
    const response = await GET(
      request(
        `?artifactId=${ids.artifact}&artifactId=${ids.artifactTwo}`,
      ),
      params,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: batch });
    expect(mocks.getArtifactExecutionStateBatch).toHaveBeenCalledWith(
      { workspaceId: ids.workspace },
      ids.project,
      [ids.artifact, ids.artifactTwo],
    );
  });

  it.each([
    "",
    "?artifactId=not-a-uuid",
    `?artifactId=${ids.artifact}&artifactId=${ids.artifact}`,
    `?artifactId=${ids.artifact}&target=all`,
  ])("rejects missing, ambiguous, or undeclared scope %s", async (query) => {
    const response = await GET(request(query), params);
    expect(response.status).toBe(422);
    expect(mocks.getArtifactExecutionStateBatch).not.toHaveBeenCalled();
  });
});
