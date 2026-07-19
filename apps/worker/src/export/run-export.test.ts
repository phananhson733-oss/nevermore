import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionsRepository,
  AsyncRunsRepository,
  DataSnapshotsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  ExportBundlesRepository,
  FindingsRepository,
  ObservationsRepository,
  ProjectsRepository,
  SourceConnectionsRepository,
  type ActionRow,
  type ArtifactRevisionRow,
  type ArtifactRow,
  type AsyncRunRow,
  type DataSnapshotRow,
  type ExportBundleRow,
  type FindingRow,
  type ObservationRow,
} from "@sf/db";
import type { Logger } from "@sf/observability";
import { SupabaseStorageError } from "@sf/sources";
import type { WorkerContext } from "../context.ts";

const mocks = vi.hoisted(() => ({
  assembleBundle: vi.fn(),
  transaction: vi.fn(),
  put: vi.fn(),
  deleteObject: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@sf/artifacts", async () => {
  const actual = await vi.importActual<typeof import("@sf/artifacts")>(
    "@sf/artifacts",
  );
  return { ...actual, assembleBundle: mocks.assembleBundle };
});

const { runExport } = await import("./run-export.ts");

const scope = { workspaceId: "workspace-1", projectId: "project-1" };
const run = {
  id: "run-1",
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  kind: "export",
  status: "running",
  active_key: "export:client",
  contract_version: "0.2.0",
  request_payload: { kind: "client_bundle", outputLocale: "en" },
  progress: {},
  last_error_code: null,
  last_error_summary: null,
  result_type: null,
  result_id: null,
  attempt_count: 1,
  initiated_by: "actor-1",
  queued_at: "2026-07-19T00:00:00.000Z",
  started_at: "2026-07-19T00:00:01.000Z",
  completed_at: null,
} satisfies AsyncRunRow;
const bundle = {
  id: "bundle-1",
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  async_run_id: run.id,
  kind: "client_bundle",
  schema_version: "0.2.0",
  output_locale: "en",
  object_key: null,
  checksum: null,
  byte_size: null,
  item_counts: {},
  manifest: null,
  created_by: "actor-1",
  created_at: "2026-07-19T00:00:00.000Z",
} satisfies ExportBundleRow;

const logger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => logger,
  debug: vi.fn(),
  info: vi.fn(),
  warn: mocks.warn,
  error: mocks.error,
};
const ctx = {
  db: { transaction: mocks.transaction },
  blobStore: { put: mocks.put, delete: mocks.deleteObject },
  logger,
} as unknown as WorkerContext;

function snapshot(id: string): DataSnapshotRow {
  return {
    id,
    provider: "crawl",
    dataset_key: "crawl.site_graph.v1",
    availability: "available",
    captured_at: "2026-07-19T00:00:00.000Z",
    row_count: 1,
    checksum: `checksum-${id}`,
  } as unknown as DataSnapshotRow;
}

function observation(snapshotId: string): ObservationRow {
  return {
    id: `observation-${snapshotId}`,
    snapshot_id: snapshotId,
    metric_key: "crawl.page.v1",
    subject_ref: `https://example.test/${snapshotId}`,
    availability: "available",
    value_json: { snapshotId },
  } as unknown as ObservationRow;
}

function finding(id: string): FindingRow {
  return {
    id,
    rule_id: "CONTENT-GAP-001",
    domain: "content",
    severity: "medium",
    confidence: 0.8,
    review_state: "unreviewed",
    summary: `Finding ${id}`,
    subject_refs: [],
  } as unknown as FindingRow;
}

function action(id: string): ActionRow {
  return {
    id,
    template_id: "content_gap.v1",
    title: `Action ${id}`,
    priority_band: "P2",
    roadmap_lane: "30d",
    status: "proposed",
  } as unknown as ActionRow;
}

function artifact(id: string): ArtifactRow {
  return {
    id,
    status: "ready",
  } as unknown as ArtifactRow;
}

function revision(artifactId: string): ArtifactRevisionRow {
  return {
    id: `revision-${artifactId}`,
    artifact_id: artifactId,
    revision: 1,
    content_format: "markdown",
    content_text: `# ${artifactId}`,
    content_json: null,
  } as unknown as ArtifactRevisionRow;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.assembleBundle.mockReset().mockReturnValue({
    zip: Buffer.from("zip"),
    checksum: "checksum",
    itemCounts: {},
    manifest: {},
  });
  mocks.transaction.mockReset();
  mocks.put.mockReset();
  mocks.deleteObject.mockReset().mockResolvedValue(undefined);
  mocks.warn.mockReset();
  mocks.error.mockReset();

  vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
  vi.spyOn(AsyncRunsRepository.prototype, "resetToQueued").mockResolvedValue();
  vi.spyOn(AsyncRunsRepository.prototype, "setTerminal").mockResolvedValue();
  vi.spyOn(ExportBundlesRepository.prototype, "findByRun").mockResolvedValue(
    bundle,
  );
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
    id: scope.projectId,
    workspace_id: scope.workspaceId,
    client_name: "Acme",
    project_name: "Growth",
    stage: "executing",
    default_delivery_locale: "en",
    current_icp_profile_id: null,
    archived_at: null,
    created_by: "actor-1",
    created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
  });
  vi.spyOn(
    SourceConnectionsRepository.prototype,
    "listByProject",
  ).mockResolvedValue([]);
  vi.spyOn(DataSnapshotsRepository.prototype, "listByProject").mockResolvedValue(
    { rows: [], nextCursor: null },
  );
  vi.spyOn(FindingsRepository.prototype, "list").mockResolvedValue({
    rows: [],
    nextCursor: null,
  });
  vi.spyOn(EvidenceRepository.prototype, "listForFindings").mockResolvedValue(
    [],
  );
  vi.spyOn(EvidenceRepository.prototype, "findByIds").mockResolvedValue([]);
  vi.spyOn(ActionsRepository.prototype, "list").mockResolvedValue({
    rows: [],
    nextCursor: null,
  });
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "listByProject",
  ).mockResolvedValue({ rows: [], nextCursor: null });
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "listRevisions",
  ).mockResolvedValue([]);
  vi.spyOn(
    ObservationsRepository.prototype,
    "listBySnapshotIds",
  ).mockResolvedValue([]);
});

describe("runExport retry classification", () => {
  it("resets and rethrows a Supabase Storage network failure", async () => {
    const storageFailure = new SupabaseStorageError(
      "put",
      `export/${scope.projectId}/${run.id}/fixture`,
      { cause: new TypeError("fetch failed") },
    );
    mocks.put.mockRejectedValueOnce(storageFailure);

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).rejects.toBe(storageFailure);
    expect(AsyncRunsRepository.prototype.resetToQueued).toHaveBeenCalledWith(
      run.id,
    );
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith("export_transient_error", {
      runId: run.id,
      code: "STORAGE_NETWORK",
    });
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("terminalizes a permanent failure without logging arbitrary error content", async () => {
    mocks.put.mockRejectedValueOnce(
      new Error("assembler rejected customer-content-secret"),
    );

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(mocks.error).toHaveBeenCalledWith("export_failed", {
      runId: run.id,
      code: "UNAVAILABLE",
      type: "internal",
    });
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain(
      "customer-content-secret",
    );
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      run.id,
      {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "export failed",
      },
    );
  });
});

describe("runExport bundle completeness", () => {
  it("reads every cursor page and chunks observations for every snapshot", async () => {
    const serviceRun = {
      ...run,
      request_payload: { kind: "service_bundle", outputLocale: "en" },
    } satisfies AsyncRunRow;
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce(
      serviceRun,
    );

    const snapshots = Array.from({ length: 101 }, (_, index) =>
      snapshot(`snapshot-${String(index + 1).padStart(3, "0")}`),
    );
    const snapshotList = vi.mocked(
      DataSnapshotsRepository.prototype.listByProject,
    );
    snapshotList.mockImplementation(async (_scope, options) => {
      if (options.cursor === null) {
        return { rows: snapshots.slice(0, 100), nextCursor: "snapshots-2" };
      }
      if (options.cursor === "snapshots-2") {
        return { rows: snapshots.slice(100), nextCursor: null };
      }
      throw new Error("unexpected snapshot cursor");
    });

    const listObservations = vi.mocked(
      ObservationsRepository.prototype.listBySnapshotIds,
    );
    listObservations.mockImplementation(async (_scope, ids) =>
      ids.map(observation),
    );

    const findings = [finding("finding-1"), finding("finding-2")];
    const findingList = vi.mocked(FindingsRepository.prototype.list);
    findingList.mockImplementation(async (_scope, options) =>
      options.cursor === null
        ? { rows: [findings[0]!], nextCursor: "findings-2" }
        : { rows: [findings[1]!], nextCursor: null },
    );
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockImplementation(
      async (_scope, ids) =>
        ids.map((id) => ({
          finding_id: id,
          evidence_id: `evidence-${id}`,
          role: "primary",
        })),
    );
    vi.mocked(EvidenceRepository.prototype.findByIds).mockImplementation(
      async (_scope, ids) =>
        ids.map((id) => ({
          id,
          source_provider: "crawl",
          origin: "observed",
          method: "observed",
          grade: "A",
          availability: "available",
          support: "direct",
          subject_refs: [],
          claim: `Evidence ${id}`,
          observed_at: "2026-07-19T00:00:00.000Z",
          limitation: "fixture",
          snapshot_id: snapshots[0]!.id,
          analysis_invocation_id: null,
        })),
    );

    const actions = [action("action-1"), action("action-2")];
    vi.mocked(ActionsRepository.prototype.list).mockImplementation(
      async (_scope, options) =>
        options.cursor === null
          ? { rows: [actions[0]!], nextCursor: "actions-2" }
          : { rows: [actions[1]!], nextCursor: null },
    );

    const artifacts = [artifact("artifact-1"), artifact("artifact-2")];
    vi.mocked(
      ExecutionArtifactsRepository.prototype.listByProject,
    ).mockImplementation(async (_scope, options) =>
      options.cursor === null
        ? { rows: [artifacts[0]!], nextCursor: "artifacts-2" }
        : { rows: [artifacts[1]!], nextCursor: null },
    );
    vi.mocked(
      ExecutionArtifactsRepository.prototype.listRevisions,
    ).mockImplementation(async (_scope, artifactId) => [revision(artifactId)]);

    mocks.put.mockRejectedValueOnce(new Error("stop after assembly"));

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(snapshotList).toHaveBeenNthCalledWith(1, scope, {
      limit: 100,
      cursor: null,
    });
    expect(snapshotList).toHaveBeenNthCalledWith(2, scope, {
      limit: 100,
      cursor: "snapshots-2",
    });
    expect(listObservations).toHaveBeenNthCalledWith(
      1,
      scope,
      snapshots.slice(0, 100).map((row) => row.id),
    );
    expect(listObservations).toHaveBeenNthCalledWith(2, scope, [
      snapshots[100]!.id,
    ]);
    expect(findingList).toHaveBeenCalledTimes(2);
    expect(ActionsRepository.prototype.list).toHaveBeenCalledTimes(2);
    expect(
      ExecutionArtifactsRepository.prototype.listByProject,
    ).toHaveBeenCalledTimes(2);

    const assembledInput = mocks.assembleBundle.mock.calls[0]![0] as {
      sourceSnapshotIds: string[];
      snapshots: unknown[];
      observations: unknown[];
      findings: unknown[];
      evidence: unknown[];
      actions: unknown[];
      artifacts: unknown[];
    };
    expect(assembledInput.sourceSnapshotIds).toHaveLength(101);
    expect(assembledInput.snapshots).toHaveLength(101);
    expect(assembledInput.observations).toHaveLength(101);
    expect(assembledInput.findings).toHaveLength(2);
    expect(assembledInput.evidence).toHaveLength(2);
    expect(assembledInput.actions).toHaveLength(2);
    expect(assembledInput.artifacts).toHaveLength(2);
  });
});

describe("runExport orphan cleanup", () => {
  const uploadedKey = `export/${scope.projectId}/${run.id}/uploaded`;

  it("best-effort deletes an uploaded bundle when the finalize transaction fails", async () => {
    const databaseFailure = Object.assign(new Error("database unavailable"), {
      code: "08006",
    });
    mocks.put.mockResolvedValueOnce({
      key: uploadedKey,
      sha256: "sha256",
      bytes: 3,
    });
    mocks.transaction.mockRejectedValueOnce(databaseFailure);

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).rejects.toBe(databaseFailure);

    expect(mocks.deleteObject).toHaveBeenCalledOnce();
    expect(mocks.deleteObject).toHaveBeenCalledWith(uploadedKey);
    expect(AsyncRunsRepository.prototype.resetToQueued).toHaveBeenCalledWith(
      run.id,
    );
  });

  it("keeps the transaction failure primary and logs no object key when cleanup fails", async () => {
    const databaseFailure = Object.assign(new Error("database unavailable"), {
      code: "08006",
    });
    const cleanupFailure = new Error(`could not delete ${uploadedKey}`);
    mocks.put.mockResolvedValueOnce({
      key: uploadedKey,
      sha256: "sha256",
      bytes: 3,
    });
    mocks.transaction.mockRejectedValueOnce(databaseFailure);
    mocks.deleteObject.mockRejectedValueOnce(cleanupFailure);

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).rejects.toBe(databaseFailure);

    expect(mocks.error).toHaveBeenCalledWith(
      "export_orphan_cleanup_failed",
      { runId: run.id, code: "STORAGE_DELETE_FAILED" },
    );
    const logged = JSON.stringify(mocks.error.mock.calls);
    expect(logged).not.toContain(uploadedKey);
    expect(logged).not.toContain(cleanupFailure.message);
  });
});
