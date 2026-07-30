import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  getDb: vi.fn(),
  listConnections: vi.fn(),
  listActiveRuns: vi.fn(),
  findLatestSnapshot: vi.fn(),
}));

vi.mock("@/env", () => ({
  getEnv: () => ({ DATAFORSEO_ENABLED: "false" }),
}));

vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
}));

vi.mock("./source-connect", () => ({
  getSourceConnectionGate: mocks.gate,
}));

vi.mock("@sf/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sf/db")>();
  return {
    ...actual,
    AsyncRunsRepository: class {
      listActiveByProject = mocks.listActiveRuns;
    },
    DataSnapshotsRepository: class {
      findLatestByConnection = mocks.findLatestSnapshot;
    },
    SourceConnectionsRepository: class {
      listByProject = mocks.listConnections;
    },
  };
});

const { listProjectSources } = await import("./sources");

const scope = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
};
const projectId = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockReturnValue({ db: {} });
  mocks.listConnections.mockResolvedValue([]);
  mocks.listActiveRuns.mockResolvedValue([]);
  mocks.findLatestSnapshot.mockResolvedValue(null);
});

describe("listProjectSources Product/ICP read gate", () => {
  it("does not load source connections or snapshots for an active unconfirmed project", async () => {
    mocks.gate.mockResolvedValue("product_profile_required");

    await expect(listProjectSources(scope, projectId)).rejects.toMatchObject({
      code: "CONTEXT_INCOMPLETE",
      status: 422,
    });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.listConnections).not.toHaveBeenCalled();
    expect(mocks.listActiveRuns).not.toHaveBeenCalled();
    expect(mocks.findLatestSnapshot).not.toHaveBeenCalled();
  });

  it("keeps a missing or foreign project behind the existing 404 boundary", async () => {
    mocks.gate.mockResolvedValue("not_found");

    await expect(listProjectSources(scope, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.listConnections).not.toHaveBeenCalled();
  });

  it("loads the canonical five slots after the shared gate allows a confirmed or archived project", async () => {
    mocks.gate.mockResolvedValue("allowed");

    const result = await listProjectSources(scope, projectId);

    expect(mocks.gate).toHaveBeenCalledWith(scope, projectId);
    expect(mocks.listConnections).toHaveBeenCalledWith({
      workspaceId: scope.workspaceId,
      projectId,
    });
    expect(mocks.listActiveRuns).toHaveBeenCalledWith({
      workspaceId: scope.workspaceId,
      projectId,
    });
    expect(result.map((slot) => slot.provider)).toEqual([
      "crawl",
      "gsc",
      "ga4",
      "csv",
      "dataforseo",
    ]);
    expect(result.every((slot) => slot.latestSnapshot === null)).toBe(true);
  });
});
