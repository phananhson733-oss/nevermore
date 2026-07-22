import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProductProfileWorkspace: vi.fn(),
  updateProductProfileDraft: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getOperatorContext: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
  })),
}));

vi.mock("@/lib/services/product-profile", () => mocks);

const { GET, PATCH } = await import("./route");

const projectId = "00000000-0000-4000-8000-000000000003";

afterEach(() => vi.clearAllMocks());

describe("Product Profile route", () => {
  it("returns the scoped review workspace", async () => {
    const workspace = {
      projectId,
      currentProfile: null,
      confirmedProfile: null,
      activeSynthesisRun: null,
    };
    mocks.getProductProfileWorkspace.mockResolvedValue(workspace);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/product-profile`,
      ),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: workspace });
    expect(mocks.getProductProfileWorkspace).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
    );
  });

  it("validates and appends only an editable Product Profile patch", async () => {
    const saved = { id: "profile-row" };
    mocks.updateProductProfileDraft.mockResolvedValue(saved);
    const response = await PATCH(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/product-profile`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
          },
          body: JSON.stringify({
            baseVersion: 2,
            patch: { productName: "RelayOps" },
          }),
        },
      ),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: saved });
    expect(mocks.updateProductProfileDraft).toHaveBeenCalledWith(
      { workspaceId: "00000000-0000-4000-8000-000000000002" },
      projectId,
      "00000000-0000-4000-8000-000000000001",
      { baseVersion: 2, patch: { productName: "RelayOps" } },
    );
  });

  it("rejects server-owned fields before calling the service", async () => {
    const response = await PATCH(
      new NextRequest(
        `http://localhost/api/mvp/projects/${projectId}/product-profile`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
          },
          body: JSON.stringify({
            baseVersion: 2,
            patch: {
              sourceSnapshotId: "00000000-0000-4000-8000-000000000004",
            },
          }),
        },
      ),
      { params: Promise.resolve({ projectId }) },
    );

    expect(response.status).toBe(422);
    expect(mocks.updateProductProfileDraft).not.toHaveBeenCalled();
  });
});
