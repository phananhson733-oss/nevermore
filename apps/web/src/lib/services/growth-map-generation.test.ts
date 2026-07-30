import {
  DataSnapshotsRepository,
  GrowthMapReadRepository,
  MAX_GROWTH_MAP_SNAPSHOT_LOOKUP,
  contentHash,
  type CanonicalValue,
  type DataSnapshotRow,
  type Executor,
  type GrowthMapReadableRunRow,
  type ProjectScope,
} from "@sf/db";
import {
  GOVERNANCE_PROJECTION_VERSION,
  RULE_SET_VERSION,
} from "@sf/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPublishedGrowthMapGeneration } from "./growth-map-generation";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  foreignProject: "10000000-0000-4000-8000-000000000003",
  site: "10000000-0000-4000-8000-000000000004",
  run: "10000000-0000-4000-8000-000000000005",
  icp: "10000000-0000-4000-8000-000000000006",
  snapshot: "10000000-0000-4000-8000-000000000007",
  collectionRun: "10000000-0000-4000-8000-000000000008",
  sourceConnection: "10000000-0000-4000-8000-000000000009",
} as const;

const capturedAt = "2026-07-21T08:00:00.000Z";
const scope: ProjectScope = {
  workspaceId: ids.workspace,
  projectId: ids.project,
};
const exec = { kind: "growth-map-generation-test" } as unknown as Executor;

function snapshot(
  overrides: Partial<DataSnapshotRow> = {},
): DataSnapshotRow {
  return {
    id: ids.snapshot,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    collection_run_id: ids.collectionRun,
    source_connection_id: ids.sourceConnection,
    provider: "crawl",
    dataset_key: "crawl.site_graph.v1",
    schema_version: "0.3.0",
    method_version: "crawl.site_graph.v2",
    captured_at: capturedAt,
    source_window: { start: null, end: null },
    availability: "available",
    limitation: "Bounded public crawl.",
    raw_object_key: null,
    row_count: 1,
    checksum: "a".repeat(64),
    summary: {},
    created_at: capturedAt,
    ...overrides,
  };
}

function snapshotManifestEntry(
  row: DataSnapshotRow,
): Record<string, unknown> {
  return {
    snapshotId: row.id,
    provider: row.provider,
    datasetKey: row.dataset_key,
    schemaVersion: row.schema_version,
    methodVersion: row.method_version,
    checksum: row.checksum,
    capturedAt: row.captured_at,
    sourceWindow: row.source_window,
    availability: row.availability,
  };
}

function fixture(options: {
  readonly snapshotEntries?: readonly Record<string, unknown>[];
  readonly governance?: unknown;
} = {}): {
  readonly run: GrowthMapReadableRunRow;
  readonly snapshots: readonly DataSnapshotRow[];
} {
  const crawl = snapshot();
  const manifest: Record<string, unknown> = {
    projectId: ids.project,
    siteId: ids.site,
    icp: { id: ids.icp, version: 2, contentHash: "c".repeat(64) },
    snapshots: options.snapshotEntries ?? [snapshotManifestEntry(crawl)],
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: "prompts.v1",
    deliveryLocale: "zh-CN",
    governance:
      options.governance ??
      {
        projectionVersion: GOVERNANCE_PROJECTION_VERSION,
        keywordClusters: [],
        competitors: [],
      },
  };
  return {
    snapshots: [crawl],
    run: {
      id: ids.run,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: ids.site,
      icp_profile_id: ids.icp,
      icp_profile_version: 2,
      rule_set_version: RULE_SET_VERSION,
      prompt_set_version: "prompts.v1",
      output_locale: "zh-CN",
      input_manifest: manifest,
      input_hash: contentHash(manifest as CanonicalValue),
      coverage: {},
      created_at: capturedAt,
      run_status: "completed",
      run_completed_at: capturedAt,
    },
  };
}

function arrange(
  run: GrowthMapReadableRunRow,
  snapshots: readonly DataSnapshotRow[],
) {
  const selectRun = vi
    .spyOn(GrowthMapReadRepository.prototype, "findLatestReadableRun")
    .mockResolvedValue(run);
  const loadSnapshots = vi
    .spyOn(DataSnapshotsRepository.prototype, "findByIds")
    .mockResolvedValue([...snapshots]);
  return { loadSnapshots, selectRun };
}

function generatedSnapshotId(index: number): string {
  return `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadPublishedGrowthMapGeneration", () => {
  it("loads the repository-selected run and validates its frozen snapshots and governance", async () => {
    const current = fixture();
    const { loadSnapshots, selectRun } = arrange(
      current.run,
      current.snapshots,
    );

    const result = await loadPublishedGrowthMapGeneration(exec, scope);

    expect(selectRun).toHaveBeenCalledWith(scope);
    expect(loadSnapshots).toHaveBeenCalledWith(scope, [ids.snapshot]);
    expect(result.run).toBe(current.run);
    expect(result.frozen).toMatchObject({
      runId: ids.run,
      siteId: ids.site,
      crawlSnapshotId: ids.snapshot,
      snapshotIds: [ids.snapshot],
    });
    expect(result.governance).toEqual({
      projectionVersion: GOVERNANCE_PROJECTION_VERSION,
      keywordClusters: [],
      competitors: [],
    });
  });

  it("loads one exact published generation without falling back to latest", async () => {
    const current = fixture();
    const selectLatest = vi
      .spyOn(GrowthMapReadRepository.prototype, "findLatestReadableRun")
      .mockResolvedValue(null);
    const selectExact = vi
      .spyOn(GrowthMapReadRepository.prototype, "findReadableRunById")
      .mockResolvedValue(current.run);
    const loadSnapshots = vi
      .spyOn(DataSnapshotsRepository.prototype, "findByIds")
      .mockResolvedValue([...current.snapshots]);

    const result = await loadPublishedGrowthMapGeneration(
      exec,
      scope,
      ids.run,
    );

    expect(selectExact).toHaveBeenCalledWith(scope, ids.run);
    expect(selectLatest).not.toHaveBeenCalled();
    expect(loadSnapshots).toHaveBeenCalledWith(scope, [ids.snapshot]);
    expect(result.run.id).toBe(ids.run);
  });

  it("does not fall back to latest when the requested generation is not publishable", async () => {
    const selectLatest = vi
      .spyOn(GrowthMapReadRepository.prototype, "findLatestReadableRun")
      .mockResolvedValue(fixture().run);
    const selectExact = vi
      .spyOn(GrowthMapReadRepository.prototype, "findReadableRunById")
      .mockResolvedValue(null);
    const loadSnapshots = vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findByIds",
    );

    await expect(
      loadPublishedGrowthMapGeneration(exec, scope, ids.run),
    ).rejects.toMatchObject({
      code: "GROWTH_MAP_AUDIT_NOT_FOUND",
      status: 404,
    });
    expect(selectExact).toHaveBeenCalledWith(scope, ids.run);
    expect(selectLatest).not.toHaveBeenCalled();
    expect(loadSnapshots).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty id", ""],
    ["a non-UUID id", "customer-private-snapshot"],
    ["a padded UUID", `${ids.snapshot} `],
    ["an uppercase UUID", "A0000000-0000-4000-8000-000000000007"],
    ["a non-string id", 42],
  ])(
    "fails closed before loading snapshots when the manifest contains %s",
    async (_label, snapshotId) => {
      const current = fixture({
        snapshotEntries: [
          {
            ...snapshotManifestEntry(snapshot()),
            snapshotId,
          },
        ],
      });
      const { loadSnapshots } = arrange(current.run, current.snapshots);

      await expect(
        loadPublishedGrowthMapGeneration(exec, scope),
      ).rejects.toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        status: 503,
      });
      expect(loadSnapshots).not.toHaveBeenCalled();
    },
  );

  it("fails closed before loading snapshots when manifest ids are duplicated", async () => {
    const entry = snapshotManifestEntry(snapshot());
    const current = fixture({ snapshotEntries: [entry, { ...entry }] });
    const { loadSnapshots } = arrange(current.run, current.snapshots);

    await expect(
      loadPublishedGrowthMapGeneration(exec, scope),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
    expect(loadSnapshots).not.toHaveBeenCalled();
  });

  it("fails closed before loading snapshots when the manifest exceeds the DB lookup cap", async () => {
    const entry = snapshotManifestEntry(snapshot());
    const snapshotEntries = Array.from(
      { length: MAX_GROWTH_MAP_SNAPSHOT_LOOKUP + 1 },
      (_, index) => ({
        ...entry,
        snapshotId: generatedSnapshotId(index),
      }),
    );
    const current = fixture({ snapshotEntries });
    const { loadSnapshots } = arrange(current.run, current.snapshots);

    await expect(
      loadPublishedGrowthMapGeneration(exec, scope),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
    expect(loadSnapshots).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", []],
    [
      "foreign",
      [
        snapshot({
          project_id: ids.foreignProject,
        }),
      ],
    ],
  ])(
    "fails closed when a frozen snapshot is %s",
    async (_label, rows) => {
      const current = fixture();
      const { loadSnapshots } = arrange(
        current.run,
        rows as readonly DataSnapshotRow[],
      );

      await expect(
        loadPublishedGrowthMapGeneration(exec, scope),
      ).rejects.toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        status: 503,
      });
      expect(loadSnapshots).toHaveBeenCalledWith(scope, [ids.snapshot]);
    },
  );

  it("fails closed when the frozen governance projection is invalid", async () => {
    const current = fixture({
      governance: {
        projectionVersion: GOVERNANCE_PROJECTION_VERSION,
        keywordClusters: [],
        competitors: [],
        unexpected: true,
      },
    });
    const { loadSnapshots } = arrange(current.run, current.snapshots);

    await expect(
      loadPublishedGrowthMapGeneration(exec, scope),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      status: 503,
    });
    expect(loadSnapshots).toHaveBeenCalledWith(scope, [ids.snapshot]);
  });
});
