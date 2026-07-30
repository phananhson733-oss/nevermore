import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectFind: vi.fn(),
  confirmedFind: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ db: {} }),
}));

vi.mock("@sf/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sf/db")>();
  return {
    ...actual,
    ProjectsRepository: class {
      findById = mocks.projectFind;
      findConfirmedIcpProfile = mocks.confirmedFind;
    },
  };
});

const { getSourceConnectionGate } = await import("./source-connect");

const scope = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
};
const projectId = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSourceConnectionGate", () => {
  it("does not expose whether a foreign or absent project has source setup", async () => {
    mocks.projectFind.mockResolvedValue(null);

    await expect(
      getSourceConnectionGate(scope, projectId),
    ).resolves.toBe("not_found");
    expect(mocks.confirmedFind).not.toHaveBeenCalled();
  });

  it("blocks source setup while Product Profile and ICP remain unconfirmed", async () => {
    mocks.projectFind.mockResolvedValue({ id: projectId, archived_at: null });
    mocks.confirmedFind.mockResolvedValue(null);

    await expect(
      getSourceConnectionGate(scope, projectId),
    ).resolves.toBe("product_profile_required");
    expect(mocks.confirmedFind).toHaveBeenCalledWith(scope, projectId);
  });

  it("allows source setup only when the confirmed pointer resolves to a complete profile", async () => {
    mocks.projectFind.mockResolvedValue({ id: projectId, archived_at: null });
    mocks.confirmedFind.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000003",
      status: "complete",
    });

    await expect(
      getSourceConnectionGate(scope, projectId),
    ).resolves.toBe("allowed");
  });

  it("preserves retained source history for an archived legacy project", async () => {
    mocks.projectFind.mockResolvedValue({
      id: projectId,
      archived_at: "2026-07-29T00:00:00.000Z",
    });

    await expect(
      getSourceConnectionGate(scope, projectId),
    ).resolves.toBe("allowed");
    expect(mocks.confirmedFind).not.toHaveBeenCalled();
  });
});
