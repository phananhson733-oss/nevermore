import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  getDb: vi.fn(),
  listConnections: vi.fn(),
  listActiveRuns: vi.fn(),
  findLatestSnapshot: vi.fn(),
  summarizeGscSnapshot: vi.fn(),
  summarizeGa4Snapshot: vi.fn(),
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
    ObservationsRepository: class {
      summarizeGscSnapshot = mocks.summarizeGscSnapshot;
      summarizeGa4Snapshot = mocks.summarizeGa4Snapshot;
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
  mocks.summarizeGscSnapshot.mockResolvedValue(null);
  mocks.summarizeGa4Snapshot.mockResolvedValue(null);
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
    expect(result.every((slot) => slot.latestMetricSummary === null)).toBe(true);
  });

  it("projects normalized GSC and GA4 business metrics for the exact latest snapshots", async () => {
    mocks.gate.mockResolvedValue("allowed");
    mocks.listConnections.mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-000000000011",
        provider: "gsc",
        state: "available",
        connection_type: "oauth",
        external_ref: "sc-domain:example.test",
        scopes: [],
        connected_at: "2026-08-01T00:00:00.000Z",
        limitation: "GSC fixture.",
        updated_at: "2026-08-02T00:00:00.000Z",
        created_at: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        provider: "ga4",
        state: "available",
        connection_type: "oauth",
        external_ref: "properties/123",
        scopes: [],
        connected_at: "2026-08-01T00:00:00.000Z",
        limitation: "GA4 fixture.",
        updated_at: "2026-08-02T00:00:00.000Z",
        created_at: "2026-08-01T00:00:00.000Z",
      },
    ]);
    mocks.findLatestSnapshot.mockImplementation(
      async (_scope: unknown, connectionId: string) => ({
        id:
          connectionId === "00000000-0000-4000-8000-000000000011"
            ? "00000000-0000-4000-8000-000000000021"
            : "00000000-0000-4000-8000-000000000022",
        site_id: "00000000-0000-4000-8000-000000000030",
        provider:
          connectionId === "00000000-0000-4000-8000-000000000011"
            ? "gsc"
            : "ga4",
        dataset_key:
          connectionId === "00000000-0000-4000-8000-000000000011"
            ? "gsc.page_query_daily.v1"
            : "ga4.organic_landing_daily.v1",
        schema_version: "0.2.0",
        method_version: "fixture.v1",
        captured_at: "2026-08-02T00:00:00.000Z",
        source_window: { start: "2026-07-01", end: "2026-08-01" },
        availability: "available",
        limitation: "Fixture.",
        row_count: connectionId.endsWith("11") ? 1_874 : 0,
        checksum: "a".repeat(64),
      }),
    );
    mocks.summarizeGscSnapshot.mockResolvedValue({
      landingPageCount: 63,
      clicks: "4",
      impressions: "4634",
    });
    mocks.summarizeGa4Snapshot.mockResolvedValue(null);

    const result = await listProjectSources(scope, projectId);

    expect(result.find((source) => source.provider === "gsc")?.latestMetricSummary)
      .toEqual({
        provider: "gsc",
        landingPageCount: 63,
        clicks: 4,
        impressions: 4_634,
      });
    expect(result.find((source) => source.provider === "ga4")?.latestMetricSummary)
      .toBeNull();
  });
});
