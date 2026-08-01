import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveProject: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));
vi.mock("@/lib/services/projects", () => mocks);

const { DELETE } = await import("./route");
const projectId = "00000000-0000-4000-8000-000000000003";

describe("DELETE /api/mvp/projects/:projectId", () => {
  it("archives the workspace-scoped product and returns an empty 204", async () => {
    mocks.archiveProject.mockResolvedValue(undefined);

    const response = await DELETE(
      new NextRequest(`http://localhost/api/mvp/projects/${projectId}`, {
        method: "DELETE",
        headers: { Origin: "http://localhost" },
      }),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
    expect(response.headers.get("X-Request-Id")).toEqual(expect.any(String));
    expect(mocks.archiveProject).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
    );
  });
});
