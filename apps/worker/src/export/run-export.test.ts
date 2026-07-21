import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionsRepository,
  AsyncRunsRepository,
  DataSnapshotsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  ExportBundlesRepository,
  FindingsRepository,
  IcpProfilesRepository,
  ObservationsRepository,
  ProjectsRepository,
  SourceConnectionsRepository,
  StorageObjectReferencesRepository,
  TelemetryRepository,
  toRunAttempt,
  type ActionRow,
  type ArtifactRevisionRow,
  type ArtifactRow,
  type AsyncRunRow,
  type DataSnapshotRow,
  type ExportBundleRow,
  type FindingRow,
  type ObservationRow,
} from "@sf/db";
import {
  DEFAULT_BUNDLE_ASSEMBLY_LIMITS,
  ExportBundleLimitError,
  type BundleInput,
} from "@sf/artifacts";
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
  contract_version: "2026-07-21",
  request_payload: {
    kind: "client_bundle",
    outputLocale: "en",
    confirmedIcpProfileId: null,
  },
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
const attempt = toRunAttempt(run);
const bundle = {
  id: "bundle-1",
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
  async_run_id: run.id,
  kind: "client_bundle",
  schema_version: "signalframe.service-bundle.0.3.0",
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

function observation(
  snapshotId: string,
  id = `observation-${snapshotId}`,
  valueJson: unknown = { snapshotId },
): ObservationRow {
  return {
    id,
    snapshot_id: snapshotId,
    metric_key: "crawl.page.v1",
    subject_ref: `https://example.test/${snapshotId}`,
    availability: "available",
    value_json: valueJson,
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

function revision(
  artifactId: string,
  revisionNumber = 1,
  contentText = `# ${artifactId}`,
): ArtifactRevisionRow {
  return {
    id: `revision-${artifactId}-${revisionNumber}`,
    artifact_id: artifactId,
    revision: revisionNumber,
    content_format: "markdown",
    content_text: contentText,
    content_json: null,
  } as unknown as ArtifactRevisionRow;
}

function evidenceRow(id: string, claim = `Evidence ${id}`) {
  return {
    id,
    source_provider: "crawl",
    origin: "observed",
    method: "observed",
    grade: "A",
    availability: "available",
    support: "direct",
    subject_refs: [],
    claim,
    observed_at: "2026-07-19T00:00:00.000Z",
    limitation: "fixture",
    snapshot_id: null,
    analysis_invocation_id: null,
  };
}

function mappedEvidenceBytes(row: ReturnType<typeof evidenceRow>): number {
  return Buffer.byteLength(
    JSON.stringify({
      id: row.id,
      sourceProvider: row.source_provider,
      grade: row.grade,
      claim: row.claim,
      subjectRefs: row.subject_refs,
      observedAt: row.observed_at,
    }),
    "utf8",
  ) + 1;
}

function mockEvidenceExportPages(
  rows: readonly ReturnType<typeof evidenceRow>[],
): void {
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  const pageIds = (
    ids: readonly string[],
    cursor: string | null,
    limit: number,
  ) => {
    const matching = [...new Set(ids)]
      .sort()
      .filter((id) => byId.has(id) && (cursor === null || id > cursor));
    const page = matching.slice(0, limit);
    return {
      page,
      nextCursor: matching.length > limit ? (page.at(-1) ?? null) : null,
    };
  };
  vi.mocked(
    EvidenceRepository.prototype.listExportByteSizesByIdsPage,
  ).mockImplementation(async (_scope, ids, options) => {
    const { page, nextCursor } = pageIds(ids, options.cursor, options.limit);
    return {
      rows: page.map((id) => {
        const row = byId.get(id)!;
        return { id, estimated_bytes: mappedEvidenceBytes(row) };
      }),
      nextCursor,
    };
  });
  vi.mocked(
    EvidenceRepository.prototype.listExportByIdsPage,
  ).mockImplementation(async (_scope, ids, options) => {
    const { page, nextCursor } = pageIds(ids, options.cursor, options.limit);
    return {
      rows: page.map((id) => byId.get(id)!),
      nextCursor,
    };
  });
}

async function withBundleReadLimits<T>(
  limits: Partial<{ maxItems: number; maxEstimatedBytes: number }>,
  callback: () => Promise<T>,
): Promise<T> {
  const mutableLimits = DEFAULT_BUNDLE_ASSEMBLY_LIMITS as {
    maxItems: number;
    maxEstimatedBytes: number;
  };
  const previous = {
    maxItems: mutableLimits.maxItems,
    maxEstimatedBytes: mutableLimits.maxEstimatedBytes,
  };
  Object.assign(mutableLimits, limits);
  try {
    return await callback();
  } finally {
    Object.assign(mutableLimits, previous);
  }
}

const EXPORT_SECRET_FIXTURES = {
  oauthToken: `ya29.${"O".repeat(40)}`,
  apiKey: `sk-${"A".repeat(32)}`,
  cookie: `Cookie: sf_session=${"C".repeat(32)}`,
  bearer: "Bearer FAKE-export-bearer-not-real",
  clientSecretAssignment:
    "client_secret=FAKE-export-client-secret-not-real",
  ciphertext: `token_cipher=${Buffer.from(
    "run-export-redaction-fixture",
  ).toString("base64")}`,
} as const;

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.assembleBundle.mockReset().mockReturnValue({
    zip: Buffer.from("zip"),
    checksum: "checksum",
    itemCounts: {},
    manifest: {},
  });
  mocks.transaction
    .mockReset()
    .mockImplementation(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );
  mocks.put.mockReset();
  mocks.deleteObject.mockReset().mockResolvedValue(undefined);
  mocks.warn.mockReset();
  mocks.error.mockReset();

  vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
  vi.spyOn(
    AsyncRunsRepository.prototype,
    "lockAttemptForUpdate",
  ).mockResolvedValue(run);
  vi.spyOn(AsyncRunsRepository.prototype, "resetToQueued").mockResolvedValue(true);
  vi.spyOn(AsyncRunsRepository.prototype, "setTerminal").mockResolvedValue(true);
  vi.spyOn(ExportBundlesRepository.prototype, "findByRun").mockResolvedValue(
    bundle,
  );
  vi.spyOn(ExportBundlesRepository.prototype, "finalize").mockResolvedValue();
  vi.spyOn(
    StorageObjectReferencesRepository.prototype,
    "lockObjectKeysForTransaction",
  ).mockResolvedValue();
  vi.spyOn(ProjectsRepository.prototype, "setStage").mockResolvedValue(true);
  vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue({
    id: scope.projectId,
    workspace_id: scope.workspaceId,
    archived_at: null,
  } as never);
  vi.spyOn(TelemetryRepository.prototype, "emit").mockResolvedValue();
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
    id: scope.projectId,
    workspace_id: scope.workspaceId,
    client_name: "Acme",
    project_name: "Growth",
    stage: "executing",
    default_delivery_locale: "en",
    current_icp_profile_id: null,
    confirmed_icp_profile_id: null,
    archived_at: null,
    created_by: "actor-1",
    created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
  });
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(null);
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
  vi.spyOn(
    EvidenceRepository.prototype,
    "listExportByteSizesByIdsPage",
  ).mockResolvedValue({ rows: [], nextCursor: null });
  vi.spyOn(
    EvidenceRepository.prototype,
    "listExportByIdsPage",
  ).mockResolvedValue({ rows: [], nextCursor: null });
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
    ExecutionArtifactsRepository.prototype,
    "listRevisionsPage",
  ).mockResolvedValue({ rows: [], nextCursor: null });
  vi.spyOn(
    ExecutionArtifactsRepository.prototype,
    "findRevision",
  ).mockResolvedValue(null);
  vi.spyOn(
    ObservationsRepository.prototype,
    "listBySnapshotIds",
  ).mockResolvedValue([]);
  vi.spyOn(
    ObservationsRepository.prototype,
    "listBySnapshotIdsPage",
  ).mockResolvedValue({ rows: [], nextCursor: null });
});

describe("runExport entry and snapshot guards", () => {
  it("returns without reading a bundle when the run claim is stale", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce(null);

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(ExportBundlesRepository.prototype.findByRun).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("terminalizes a claimed run whose export bundle row is missing", async () => {
    vi.mocked(ExportBundlesRepository.prototype.findByRun).mockResolvedValueOnce(
      null,
    );

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      {
        status: "failed",
        lastErrorCode: "NOT_FOUND",
        lastErrorSummary: "export bundle missing",
      },
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("fails closed when the project disappears before the export snapshot", async () => {
    vi.mocked(ProjectsRepository.prototype.findById).mockResolvedValueOnce(null);

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(mocks.assembleBundle).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "export failed",
      },
    );
  });

  it("rejects a repository page larger than its requested limit", async () => {
    const oversizedPage = Array.from({ length: 101 }, (_, index) =>
      snapshot(`snapshot-${index}`),
    );
    vi.mocked(
      DataSnapshotsRepository.prototype.listByProject,
    ).mockResolvedValueOnce({ rows: oversizedPage, nextCursor: null });

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(DataSnapshotsRepository.prototype.listByProject).toHaveBeenCalledWith(
      scope,
      { limit: 100, cursor: null },
    );
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
  });

  it("rejects a paginator that repeats a non-empty cursor", async () => {
    vi.mocked(DataSnapshotsRepository.prototype.listByProject)
      .mockResolvedValueOnce({
        rows: [snapshot("snapshot-first")],
        nextCursor: "repeated-cursor",
      })
      .mockResolvedValueOnce({
        rows: [snapshot("snapshot-second")],
        nextCursor: "repeated-cursor",
      });

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(DataSnapshotsRepository.prototype.listByProject).toHaveBeenCalledTimes(
      2,
    );
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
  });

  it("rejects an invalid SQL-computed evidence byte estimate", async () => {
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValueOnce({
      rows: [finding("finding-invalid-size")],
      nextCursor: null,
    });
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValueOnce([
      {
        finding_id: "finding-invalid-size",
        evidence_id: "evidence-invalid-size",
        role: "primary",
      },
    ]);
    vi.mocked(
      EvidenceRepository.prototype.listExportByteSizesByIdsPage,
    ).mockResolvedValueOnce({
      rows: [{ id: "evidence-invalid-size", estimated_bytes: -1 }],
      nextCursor: null,
    });

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(EvidenceRepository.prototype.listExportByIdsPage).not.toHaveBeenCalled();
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
  });

  it("fails closed when evidence preflight does not cover the requested ids", async () => {
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValueOnce({
      rows: [finding("finding-preflight-gap")],
      nextCursor: null,
    });
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValueOnce([
      {
        finding_id: "finding-preflight-gap",
        evidence_id: "evidence-expected",
        role: "primary",
      },
    ]);
    vi.mocked(
      EvidenceRepository.prototype.listExportByteSizesByIdsPage,
    ).mockResolvedValueOnce({
      rows: [{ id: "evidence-unexpected", estimated_bytes: 1 }],
      nextCursor: null,
    });

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(EvidenceRepository.prototype.listExportByIdsPage).not.toHaveBeenCalled();
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
  });

  it("fails closed when evidence bodies differ from the approved preflight", async () => {
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValueOnce({
      rows: [finding("finding-body-gap")],
      nextCursor: null,
    });
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValueOnce([
      {
        finding_id: "finding-body-gap",
        evidence_id: "evidence-expected",
        role: "primary",
      },
    ]);
    vi.mocked(
      EvidenceRepository.prototype.listExportByteSizesByIdsPage,
    ).mockResolvedValueOnce({
      rows: [{ id: "evidence-expected", estimated_bytes: 1 }],
      nextCursor: null,
    });
    vi.mocked(
      EvidenceRepository.prototype.listExportByIdsPage,
    ).mockResolvedValueOnce({
      rows: [evidenceRow("evidence-unexpected")],
      nextCursor: null,
    });

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(mocks.assembleBundle).not.toHaveBeenCalled();
  });

  it("fails closed when a ready client artifact loses its current revision", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.listByProject,
    ).mockResolvedValueOnce({
      rows: [{ ...artifact("artifact-missing-current"), current_revision: 2 }],
      nextCursor: null,
    } as never);

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).toHaveBeenCalledWith(scope, "artifact-missing-current", 2);
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
  });

  it("preserves JSON revision content for client and service bundles", async () => {
    const jsonRevision = {
      ...revision("artifact-json", 1),
      content_format: "json",
      content_text: null,
      content_json: { title: "Structured revision" },
    } as ArtifactRevisionRow;
    vi.mocked(ExecutionArtifactsRepository.prototype.listByProject)
      .mockResolvedValueOnce({
        rows: [{ ...artifact("artifact-json"), current_revision: 1 }],
        nextCursor: null,
      } as never)
      .mockResolvedValueOnce({
        rows: [{ ...artifact("artifact-json"), current_revision: 1 }],
        nextCursor: null,
      } as never);
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).mockResolvedValueOnce(jsonRevision);
    vi.mocked(
      ExecutionArtifactsRepository.prototype.listRevisionsPage,
    ).mockResolvedValueOnce({ rows: [jsonRevision], nextCursor: null });
    vi.mocked(AsyncRunsRepository.prototype.claim)
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({
        ...run,
        request_payload: { kind: "service_bundle", outputLocale: "en" },
      });
    mocks.put
      .mockRejectedValueOnce(new Error("stop after client assembly"))
      .mockRejectedValueOnce(new Error("stop after service assembly"));

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();
    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    const clientInput = mocks.assembleBundle.mock.calls[0]![0] as BundleInput;
    const serviceInput = mocks.assembleBundle.mock.calls[1]![0] as BundleInput;
    expect(clientInput.artifacts[0]?.revisions[0]?.content).toEqual({
      title: "Structured revision",
    });
    expect(serviceInput.artifacts[0]?.revisions[0]?.content).toEqual({
      title: "Structured revision",
    });
  });
});

describe("runExport storage reference protocol", () => {
  const uploadedKey = `export/${scope.projectId}/${run.id}/uploaded`;

  it("locks the minted key before upload and holds the write transaction through canonical commit", async () => {
    const events: string[] = [];
    const readTx = { role: "read" };
    const writeTx = { role: "write" };

    mocks.transaction.mockImplementation(
      async (
        callback: (tx: object) => Promise<unknown>,
        config?: { isolationLevel?: string },
      ) => {
        if (config?.isolationLevel === "repeatable read") {
          return callback(readTx);
        }
        events.push("write-transaction-started");
        const result = await callback(writeTx);
        events.push("callback-completed");
        events.push("commit-completed");
        return result;
      },
    );
    vi.mocked(
      StorageObjectReferencesRepository.prototype.lockObjectKeysForTransaction,
    ).mockImplementationOnce(async () => {
      events.push("key-locked");
    });
    mocks.put.mockImplementationOnce(async () => {
      events.push("put");
      return { key: uploadedKey, sha256: "sha256", bytes: 3 };
    });
    vi.mocked(ExportBundlesRepository.prototype.finalize).mockImplementationOnce(
      async () => {
        events.push("bundle-finalized");
      },
    );
    vi.mocked(AsyncRunsRepository.prototype.setTerminal).mockImplementationOnce(
      async () => {
        events.push("run-terminalized");
        return true;
      },
    );
    vi.mocked(ProjectsRepository.prototype.setStage).mockImplementationOnce(
      async () => {
        events.push("project-stage-updated");
        return true;
      },
    );
    vi.mocked(TelemetryRepository.prototype.emit).mockImplementationOnce(
      async () => {
        events.push("telemetry-emitted");
      },
    );

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(events).toEqual([
      "write-transaction-started",
      "key-locked",
      "put",
      "bundle-finalized",
      "run-terminalized",
      "project-stage-updated",
      "telemetry-emitted",
      "callback-completed",
      "commit-completed",
    ]);
    const mintedKey = mocks.put.mock.calls[0]![0].key;
    expect(
      StorageObjectReferencesRepository.prototype
        .lockObjectKeysForTransaction,
    ).toHaveBeenCalledWith([mintedKey]);
    expect(
      vi.mocked(
        StorageObjectReferencesRepository.prototype
          .lockObjectKeysForTransaction,
      ).mock.contexts[0],
    ).toMatchObject({ exec: writeTx });
  });

  it("does not upload when the write transaction cannot start", async () => {
    const databaseFailure = Object.assign(
      new Error("write transaction unavailable"),
      { code: "08006" },
    );
    mocks.transaction
      .mockImplementationOnce(
        async (callback: (tx: object) => Promise<unknown>) =>
          callback({ role: "read" }),
      )
      .mockRejectedValueOnce(databaseFailure);
    mocks.put.mockResolvedValueOnce({
      key: uploadedKey,
      sha256: "sha256",
      bytes: 3,
    });

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).rejects.toBe(databaseFailure);

    expect(
      StorageObjectReferencesRepository.prototype
        .lockObjectKeysForTransaction,
    ).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("does not upload when the key advisory lock times out", async () => {
    const lockTimeout = Object.assign(new Error("key lock timeout"), {
      code: "55P03",
    });
    vi.mocked(
      StorageObjectReferencesRepository.prototype.lockObjectKeysForTransaction,
    ).mockRejectedValueOnce(lockTimeout);
    mocks.put.mockResolvedValueOnce({
      key: uploadedKey,
      sha256: "sha256",
      bytes: 3,
    });

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).rejects.toBe(lockTimeout);

    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });
});

describe("runExport retry classification", () => {
  it("fails an over-budget bundle deterministically before upload", async () => {
    const limitError = new ExportBundleLimitError();
    mocks.assembleBundle.mockImplementationOnce(() => {
      throw limitError;
    });

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(mocks.put).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.resetToQueued).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      {
        status: "failed",
        lastErrorCode: "EXPORT_BUNDLE_LIMIT_EXCEEDED",
        lastErrorSummary: "export bundle exceeds the supported size limit",
      },
    );
  });

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
      attempt,
    );
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith("export_transient_error", {
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
      code: "UNAVAILABLE",
      type: "internal",
    });
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain(
      "customer-content-secret",
    );
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "export failed",
      },
    );
  });

  it("does not emit failure alerts after a newer export attempt wins", async () => {
    const storageFailure = new SupabaseStorageError(
      "put",
      `export/${scope.projectId}/${run.id}/stale`,
      { cause: new TypeError("fetch failed") },
    );
    mocks.put.mockRejectedValueOnce(storageFailure);
    vi.mocked(
      AsyncRunsRepository.prototype.resetToQueued,
    ).mockResolvedValueOnce(false);

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(mocks.warn).not.toHaveBeenCalledWith(
      "export_transient_error",
      expect.anything(),
    );
    expect(logger.info).toHaveBeenCalledWith("export_skip_stale_attempt", {
      code: "STORAGE_NETWORK",
    });

    vi.mocked(AsyncRunsRepository.prototype.setTerminal).mockResolvedValueOnce(
      false,
    );
    mocks.put.mockRejectedValueOnce(new Error("permanent stale failure"));
    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();
    expect(mocks.error).not.toHaveBeenCalledWith(
      "export_failed",
      expect.anything(),
    );
    expect(logger.info).toHaveBeenCalledWith("export_skip_stale_attempt", {
      code: "UNAVAILABLE",
    });
  });
});

describe("runExport bundle completeness", () => {
  it("fails closed when a paginator advances without returning a row", async () => {
    const snapshotList = vi.mocked(
      DataSnapshotsRepository.prototype.listByProject,
    );
    snapshotList.mockResolvedValueOnce({
      rows: [],
      nextCursor: "invalid-empty-page",
    });

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(snapshotList).toHaveBeenCalledOnce();
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "export failed",
      },
    );
  });

  it("loads every bundle section from one read-only repeatable-read transaction", async () => {
    const readTx = { role: "export-snapshot" };
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { kind: "service_bundle", outputLocale: "en" },
    });
    vi.mocked(DataSnapshotsRepository.prototype.listByProject).mockResolvedValueOnce({
      rows: [snapshot("snapshot-read-executor")],
      nextCursor: null,
    });
    vi.mocked(
      ObservationsRepository.prototype.listBySnapshotIdsPage,
    ).mockResolvedValueOnce({
      rows: [observation("snapshot-read-executor")],
      nextCursor: null,
    });
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValueOnce({
      rows: [finding("finding-snapshot")],
      nextCursor: null,
    });
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValueOnce([
      {
        finding_id: "finding-snapshot",
        evidence_id: "evidence-snapshot",
        role: "primary",
      },
    ]);
    mockEvidenceExportPages([
      evidenceRow("evidence-snapshot", "snapshot fixture"),
    ]);
    vi.mocked(
      ExecutionArtifactsRepository.prototype.listByProject,
    ).mockResolvedValueOnce({
      rows: [{ ...artifact("artifact-read-executor"), current_revision: 1 }],
      nextCursor: null,
    } as never);
    vi.mocked(
      ExecutionArtifactsRepository.prototype.listRevisionsPage,
    ).mockResolvedValueOnce({
      rows: [revision("artifact-read-executor")],
      nextCursor: null,
    });
    mocks.transaction.mockImplementationOnce(
      async (
        callback: (tx: object) => Promise<unknown>,
        config?: { isolationLevel?: string; accessMode?: string },
      ) => {
        expect(config).toEqual({
          isolationLevel: "repeatable read",
          accessMode: "read only",
        });
        return callback(readTx);
      },
    );
    mocks.put.mockRejectedValueOnce(new Error("stop after snapshot read"));

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    const repositoryCalls = [
      vi.mocked(ProjectsRepository.prototype.findById),
      vi.mocked(SourceConnectionsRepository.prototype.listByProject),
      vi.mocked(DataSnapshotsRepository.prototype.listByProject),
      vi.mocked(ObservationsRepository.prototype.listBySnapshotIdsPage),
      vi.mocked(FindingsRepository.prototype.list),
      vi.mocked(EvidenceRepository.prototype.listForFindings),
      vi.mocked(EvidenceRepository.prototype.listExportByteSizesByIdsPage),
      vi.mocked(EvidenceRepository.prototype.listExportByIdsPage),
      vi.mocked(ActionsRepository.prototype.list),
      vi.mocked(ExecutionArtifactsRepository.prototype.listByProject),
      vi.mocked(ExecutionArtifactsRepository.prototype.listRevisionsPage),
    ];
    for (const repositoryCall of repositoryCalls) {
      expect(repositoryCall.mock.contexts[0]).toMatchObject({ exec: readTx });
    }
    expect(EvidenceRepository.prototype.findByIds).not.toHaveBeenCalled();
  });

  it("counts the project item before any section rows", async () => {
    vi.mocked(
      SourceConnectionsRepository.prototype.listByProject,
    ).mockResolvedValueOnce([
      {
        id: "source-overflow",
        provider: "crawl",
        connection_type: "public",
        state: "available",
        limitation: "fixture",
      },
    ] as never);

    await withBundleReadLimits({ maxItems: 1 }, async () => {
      await expect(
        runExport(ctx, { runId: run.id, ...scope }),
      ).resolves.toBeUndefined();
    });

    expect(SourceConnectionsRepository.prototype.listByProject).toHaveBeenCalledOnce();
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        lastErrorCode: "EXPORT_BUNDLE_LIMIT_EXCEEDED",
      }),
    );
  });

  it("counts a non-null context item but not a null context item", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: {
        kind: "client_bundle",
        outputLocale: "en",
        confirmedIcpProfileId: "icp-1",
      },
    });
    vi.mocked(ProjectsRepository.prototype.findById).mockResolvedValueOnce({
      id: scope.projectId,
      workspace_id: scope.workspaceId,
      client_name: "Acme",
      project_name: "Growth",
      stage: "executing",
      default_delivery_locale: "en",
      current_icp_profile_id: "later-draft-2",
      confirmed_icp_profile_id: "later-confirmed-3",
      archived_at: null,
      created_by: "actor-1",
      created_at: "2026-07-19T00:00:00.000Z",
      updated_at: "2026-07-19T00:00:00.000Z",
    });
    vi.mocked(IcpProfilesRepository.prototype.findById).mockResolvedValueOnce({
      id: "icp-1",
      version: 1,
      status: "complete",
      profile: { audience: "operators" },
    } as never);

    await withBundleReadLimits({ maxItems: 1 }, async () => {
      await expect(
        runExport(ctx, { runId: run.id, ...scope }),
      ).resolves.toBeUndefined();
    });

    expect(IcpProfilesRepository.prototype.findById).toHaveBeenCalledWith(
      scope,
      "icp-1",
    );
    expect(SourceConnectionsRepository.prototype.listByProject).not.toHaveBeenCalled();
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
  });

  it("fails closed when the frozen confirmed ICP cannot be resolved", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: {
        kind: "client_bundle",
        outputLocale: "en",
        confirmedIcpProfileId: "missing-confirmed-icp",
      },
    });
    vi.mocked(IcpProfilesRepository.prototype.findById).mockResolvedValueOnce(null);

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(IcpProfilesRepository.prototype.findById).toHaveBeenCalledWith(
      scope,
      "missing-confirmed-icp",
    );
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "export failed",
      },
    );
  });

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
      ObservationsRepository.prototype.listBySnapshotIdsPage,
    );
    listObservations.mockImplementation(async (_scope, ids) => ({
      rows: ids.map((snapshotId) => observation(snapshotId)),
      nextCursor: null,
    }));

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
    mockEvidenceExportPages([
      evidenceRow("evidence-finding-1"),
      evidenceRow("evidence-finding-2"),
    ]);

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
      ExecutionArtifactsRepository.prototype.listRevisionsPage,
    ).mockImplementation(async (_scope, artifactId) => ({
      rows: [revision(artifactId)],
      nextCursor: null,
    }));

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
      { limit: 500, cursor: null },
    );
    expect(listObservations).toHaveBeenNthCalledWith(
      2,
      scope,
      [snapshots[100]!.id],
      { limit: 500, cursor: null },
    );
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

  it("reads observation and artifact revision inputs across bounded keyset pages", async () => {
    const serviceRun = {
      ...run,
      request_payload: { kind: "service_bundle", outputLocale: "en" },
    } satisfies AsyncRunRow;
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce(
      serviceRun,
    );
    vi.mocked(DataSnapshotsRepository.prototype.listByProject).mockResolvedValueOnce({
      rows: [snapshot("snapshot-paged")],
      nextCursor: null,
    });

    const observationPages = vi.mocked(
      ObservationsRepository.prototype.listBySnapshotIdsPage,
    );
    observationPages.mockImplementation(async (_scope, _ids, options) => {
      if (options.cursor === null) {
        return {
          rows: [observation("snapshot-paged", "observation-1")],
          nextCursor: "observation-1",
        };
      }
      if (options.cursor === "observation-1") {
        return {
          rows: [observation("snapshot-paged", "observation-2")],
          nextCursor: null,
        };
      }
      throw new Error("unexpected observation cursor");
    });
    vi.mocked(
      ExecutionArtifactsRepository.prototype.listByProject,
    ).mockResolvedValueOnce({
      rows: [{ ...artifact("artifact-paged"), current_revision: 2 }],
      nextCursor: null,
    } as never);
    const revisionPages = vi.mocked(
      ExecutionArtifactsRepository.prototype.listRevisionsPage,
    );
    revisionPages.mockImplementation(async (_scope, artifactId, options) => {
      if (options.cursor === null) {
        return {
          rows: [revision(artifactId, 2)],
          nextCursor: 2,
        };
      }
      if (options.cursor === 2) {
        return {
          rows: [revision(artifactId, 1)],
          nextCursor: null,
        };
      }
      throw new Error("unexpected revision cursor");
    });
    mocks.put.mockRejectedValueOnce(new Error("stop after assembly"));

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(observationPages).toHaveBeenNthCalledWith(
      1,
      scope,
      ["snapshot-paged"],
      { limit: 500, cursor: null },
    );
    expect(observationPages).toHaveBeenNthCalledWith(
      2,
      scope,
      ["snapshot-paged"],
      { limit: 500, cursor: "observation-1" },
    );
    expect(revisionPages).toHaveBeenNthCalledWith(
      1,
      scope,
      "artifact-paged",
      { limit: 100, cursor: null },
    );
    expect(revisionPages).toHaveBeenNthCalledWith(
      2,
      scope,
      "artifact-paged",
      { limit: 100, cursor: 2 },
    );
    expect(
      ExecutionArtifactsRepository.prototype.listRevisions,
    ).not.toHaveBeenCalled();
    const assembledInput = mocks.assembleBundle.mock.calls[0]![0] as BundleInput;
    expect(assembledInput.observations.map((row) => row["subjectRef"])).toEqual([
      "https://example.test/snapshot-paged",
      "https://example.test/snapshot-paged",
    ]);
    expect(assembledInput.artifacts[0]?.revisions.map((row) => row.revision)).toEqual([
      2,
      1,
    ]);
  });

  it("stops after the second observation page crosses the item budget", async () => {
    const serviceRun = {
      ...run,
      request_payload: { kind: "service_bundle", outputLocale: "en" },
    } satisfies AsyncRunRow;
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce(
      serviceRun,
    );
    vi.mocked(DataSnapshotsRepository.prototype.listByProject).mockResolvedValueOnce({
      rows: [snapshot("snapshot-item-budget")],
      nextCursor: null,
    });
    const observationPages = vi.mocked(
      ObservationsRepository.prototype.listBySnapshotIdsPage,
    );
    observationPages.mockImplementation(async (_scope, _ids, options) => {
      if (options.cursor === null) {
        return {
          rows: [observation("snapshot-item-budget", "observation-1")],
          nextCursor: "observation-1",
        };
      }
      if (options.cursor === "observation-1") {
        return {
          rows: [observation("snapshot-item-budget", "observation-2")],
          nextCursor: "observation-2",
        };
      }
      throw new Error("third observation page must not be requested");
    });

    // project + snapshot + first observation exactly fill three items; the
    // first row on page two is the overflow sentinel.
    await withBundleReadLimits({ maxItems: 3 }, async () => {
      await expect(
        runExport(ctx, { runId: run.id, ...scope }),
      ).resolves.toBeUndefined();
    });

    expect(observationPages).toHaveBeenCalledTimes(2);
    expect(observationPages.mock.calls[0]?.[2]).toEqual({
      limit: 2,
      cursor: null,
    });
    expect(observationPages.mock.calls[1]?.[2]).toEqual({
      limit: 1,
      cursor: "observation-1",
    });
    expect(FindingsRepository.prototype.list).not.toHaveBeenCalled();
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        lastErrorCode: "EXPORT_BUNDLE_LIMIT_EXCEEDED",
      }),
    );
  });

  it("stops after the second observation page crosses the UTF-8 byte budget", async () => {
    const serviceRun = {
      ...run,
      request_payload: { kind: "service_bundle", outputLocale: "en" },
    } satisfies AsyncRunRow;
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce(
      serviceRun,
    );
    vi.mocked(DataSnapshotsRepository.prototype.listByProject).mockResolvedValueOnce({
      rows: [snapshot("snapshot-byte-budget")],
      nextCursor: null,
    });
    const observationPages = vi.mocked(
      ObservationsRepository.prototype.listBySnapshotIdsPage,
    );
    observationPages.mockImplementation(async (_scope, _ids, options) => {
      if (options.cursor === null) {
        return {
          rows: [observation("snapshot-byte-budget", "observation-1")],
          nextCursor: "observation-1",
        };
      }
      if (options.cursor === "observation-1") {
        return {
          rows: [
            observation("snapshot-byte-budget", "observation-2", {
              payload: "界".repeat(4_000),
            }),
          ],
          nextCursor: "observation-2",
        };
      }
      throw new Error("third observation page must not be requested");
    });

    await withBundleReadLimits({ maxEstimatedBytes: 8 * 1024 }, async () => {
      await expect(
        runExport(ctx, { runId: run.id, ...scope }),
      ).resolves.toBeUndefined();
    });

    expect(observationPages).toHaveBeenCalledTimes(2);
    expect(FindingsRepository.prototype.list).not.toHaveBeenCalled();
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
  });

  it("stops after the second revision page crosses the UTF-8 byte budget", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce({
      ...run,
      request_payload: { kind: "service_bundle", outputLocale: "en" },
    });
    vi.mocked(
      ExecutionArtifactsRepository.prototype.listByProject,
    ).mockResolvedValueOnce({
      rows: [{ ...artifact("artifact-byte-budget"), current_revision: 3 }],
      nextCursor: null,
    } as never);
    const revisionPages = vi.mocked(
      ExecutionArtifactsRepository.prototype.listRevisionsPage,
    );
    revisionPages.mockImplementation(async (_scope, artifactId, options) => {
      if (options.cursor === null) {
        return {
          rows: [revision(artifactId, 3, "small")],
          nextCursor: 3,
        };
      }
      if (options.cursor === 3) {
        return {
          rows: [revision(artifactId, 2, "界".repeat(4_000))],
          nextCursor: 2,
        };
      }
      throw new Error("third revision page must not be requested");
    });

    await withBundleReadLimits({ maxEstimatedBytes: 8 * 1024 }, async () => {
      await expect(
        runExport(ctx, { runId: run.id, ...scope }),
      ).resolves.toBeUndefined();
    });

    expect(revisionPages).toHaveBeenCalledTimes(2);
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
  });

  it("does not charge revision columns that are absent from the mapped bundle payload", async () => {
    vi.mocked(
      ExecutionArtifactsRepository.prototype.listByProject,
    ).mockResolvedValueOnce({
      rows: [{ ...artifact("artifact-mapped-budget"), current_revision: 1 }],
      nextCursor: null,
    } as never);
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).mockResolvedValueOnce({
      ...revision("artifact-mapped-budget", 1, "small mapped content"),
      note: "界".repeat(10_000),
      content_hash: "h".repeat(10_000),
      validation_errors: ["界".repeat(10_000)],
    } as ArtifactRevisionRow);
    mocks.put.mockRejectedValueOnce(new Error("stop after assembly"));

    await withBundleReadLimits({ maxEstimatedBytes: 1024 }, async () => {
      await expect(
        runExport(ctx, { runId: run.id, ...scope }),
      ).resolves.toBeUndefined();
    });

    expect(mocks.assembleBundle).toHaveBeenCalledOnce();
    const input = mocks.assembleBundle.mock.calls[0]![0] as BundleInput;
    expect(input.artifacts[0]?.revisions[0]?.content).toBe(
      "small mapped content",
    );
  });

  it("bounds finding-link reads independently and keeps one reachability representative", async () => {
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValueOnce({
      rows: [finding("finding-link-budget")],
      nextCursor: null,
    });
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValueOnce([
      {
        finding_id: "finding-link-budget",
        evidence_id: "evidence-1",
        role: "primary",
      },
      {
        finding_id: "finding-link-budget",
        evidence_id: "evidence-1",
        role: "supporting",
      },
    ]);
    mockEvidenceExportPages([evidenceRow("evidence-1")]);
    mocks.put.mockRejectedValueOnce(new Error("stop after assembly"));

    // project + finding + evidence exactly fill three archive items. The two
    // historical role edges are governed by the separate link-read limit.
    await withBundleReadLimits({ maxItems: 3 }, async () => {
      await expect(
        runExport(ctx, { runId: run.id, ...scope }),
      ).resolves.toBeUndefined();
    });

    expect(EvidenceRepository.prototype.listForFindings).toHaveBeenCalledWith(
      scope,
      ["finding-link-budget"],
      { maxRows: 100_001 },
    );
    expect(EvidenceRepository.prototype.findByIds).not.toHaveBeenCalled();
    expect(mocks.assembleBundle).toHaveBeenCalledOnce();
    const input = mocks.assembleBundle.mock.calls[0]![0] as BundleInput;
    expect(input.findingEvidenceLinks).toEqual([
      { findingId: "finding-link-budget", evidenceId: "evidence-1" },
    ]);
  });

  it("rejects a dense finding-link history at its independent overflow sentinel", async () => {
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValueOnce({
      rows: [finding("finding-dense-links")],
      nextCursor: null,
    });
    const link = {
      finding_id: "finding-dense-links",
      evidence_id: "evidence-shared",
      role: "supporting",
    };
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValueOnce(
      new Array(100_001).fill(link),
    );

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(EvidenceRepository.prototype.listForFindings).toHaveBeenCalledWith(
      scope,
      ["finding-dense-links"],
      { maxRows: 100_001 },
    );
    expect(EvidenceRepository.prototype.listExportByteSizesByIdsPage).not.toHaveBeenCalled();
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        lastErrorCode: "EXPORT_BUNDLE_LIMIT_EXCEEDED",
      }),
    );
  });

  it("preflights evidence bytes before bodies and stops before a third size page", async () => {
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValueOnce({
      rows: [finding("finding-evidence-budget")],
      nextCursor: null,
    });
    const evidenceIds = Array.from(
      { length: 60 },
      (_, index) => `evidence-${String(index + 1).padStart(3, "0")}`,
    );
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValueOnce(
      evidenceIds.map((evidenceId) => ({
        finding_id: "finding-evidence-budget",
        evidence_id: evidenceId,
        role: "supporting",
      })),
    );
    const evidenceSizeReads = vi.mocked(
      EvidenceRepository.prototype.listExportByteSizesByIdsPage,
    );
    evidenceSizeReads.mockImplementation(async (_scope, ids, options) => {
      if (options.cursor === null) {
        return {
          rows: ids.slice(0, 25).map((id) => ({
            id,
            estimated_bytes: 64,
          })),
          nextCursor: ids[24] ?? null,
        };
      }
      if (options.cursor === ids[24]) {
        return {
          rows: ids.slice(25, 50).map((id, index) => ({
            id,
            estimated_bytes: index === 0 ? 140 * 1024 : 64,
          })),
          nextCursor: ids[49] ?? null,
        };
      }
      throw new Error("third evidence size page must not be requested");
    });
    const evidenceBodyReads = vi.mocked(
      EvidenceRepository.prototype.listExportByIdsPage,
    );

    await withBundleReadLimits(
      { maxEstimatedBytes: 128 * 1024 },
      async () => {
        await expect(
          runExport(ctx, { runId: run.id, ...scope }),
        ).resolves.toBeUndefined();
      },
    );

    expect(evidenceSizeReads).toHaveBeenCalledTimes(2);
    expect(evidenceSizeReads.mock.calls[0]?.[2]).toEqual({
      limit: 25,
      cursor: null,
    });
    expect(evidenceSizeReads.mock.calls[1]?.[2]).toEqual({
      limit: 25,
      cursor: "evidence-025",
    });
    expect(evidenceBodyReads).not.toHaveBeenCalled();
    expect(EvidenceRepository.prototype.findByIds).not.toHaveBeenCalled();
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
  });

  it("uses the final evidence row as an exact item overflow sentinel before body reads", async () => {
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValueOnce({
      rows: [finding("finding-evidence-item-budget")],
      nextCursor: null,
    });
    const ids = ["evidence-1", "evidence-2", "evidence-3"];
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValueOnce(
      ids.map((evidenceId) => ({
        finding_id: "finding-evidence-item-budget",
        evidence_id: evidenceId,
        role: "supporting",
      })),
    );
    const sizeReads = vi.mocked(
      EvidenceRepository.prototype.listExportByteSizesByIdsPage,
    );
    sizeReads.mockResolvedValueOnce({
      rows: ids.map((id) => ({ id, estimated_bytes: 1 })),
      nextCursor: null,
    });

    // Input-only links do not consume archive items. Project + finding consume
    // two; two evidence rows fill the remaining budget and the third is the
    // item overflow sentinel.
    await withBundleReadLimits({ maxItems: 4 }, async () => {
      await expect(
        runExport(ctx, { runId: run.id, ...scope }),
      ).resolves.toBeUndefined();
    });

    expect(sizeReads).toHaveBeenCalledWith(scope, ids, {
      limit: 3,
      cursor: null,
    });
    expect(EvidenceRepository.prototype.listExportByIdsPage).not.toHaveBeenCalled();
    expect(mocks.assembleBundle).not.toHaveBeenCalled();
  });

  it("sorts links and evidence ids, preflights all pages, then reads 25-row body pages", async () => {
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValueOnce({
      rows: [finding("finding-z"), finding("finding-a")],
      nextCursor: null,
    });
    const ids = Array.from(
      { length: 130 },
      (_, index) => `evidence-${String(index + 1).padStart(3, "0")}`,
    );
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValueOnce(
      [...ids]
        .reverse()
        .map((evidenceId, index) => ({
          finding_id: index % 2 === 0 ? "finding-z" : "finding-a",
          evidence_id: evidenceId,
          role: "supporting",
        })),
    );
    mockEvidenceExportPages(ids.map((id) => evidenceRow(id)));
    mocks.put.mockRejectedValueOnce(new Error("stop after assembly"));

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    const sizeReads = vi.mocked(
      EvidenceRepository.prototype.listExportByteSizesByIdsPage,
    );
    const bodyReads = vi.mocked(
      EvidenceRepository.prototype.listExportByIdsPage,
    );
    expect(sizeReads).toHaveBeenCalledTimes(6);
    expect(bodyReads).toHaveBeenCalledTimes(6);
    expect(sizeReads.mock.calls[0]?.[1]).toEqual(ids.slice(0, 100));
    expect(sizeReads.mock.calls[4]?.[1]).toEqual(ids.slice(100));
    expect(bodyReads.mock.calls[0]?.[1]).toEqual(ids.slice(0, 100));
    expect(bodyReads.mock.calls[4]?.[1]).toEqual(ids.slice(100));
    expect(
      sizeReads.mock.calls.every((call) => call[1].length <= 100),
    ).toBe(true);
    expect(sizeReads.mock.calls.map((call) => call[2])).toEqual([
      { limit: 25, cursor: null },
      { limit: 25, cursor: "evidence-025" },
      { limit: 25, cursor: "evidence-050" },
      { limit: 25, cursor: "evidence-075" },
      { limit: 25, cursor: null },
      { limit: 25, cursor: "evidence-125" },
    ]);
    expect(bodyReads.mock.calls.map((call) => call[2])).toEqual([
      { limit: 25, cursor: null },
      { limit: 25, cursor: "evidence-025" },
      { limit: 25, cursor: "evidence-050" },
      { limit: 25, cursor: "evidence-075" },
      { limit: 25, cursor: null },
      { limit: 25, cursor: "evidence-125" },
    ]);
    expect(sizeReads.mock.invocationCallOrder.at(-1)).toBeLessThan(
      bodyReads.mock.invocationCallOrder[0]!,
    );
    expect(EvidenceRepository.prototype.findByIds).not.toHaveBeenCalled();

    const input = mocks.assembleBundle.mock.calls[0]![0] as BundleInput;
    expect(input.evidence.map((row) => row["id"])).toEqual(ids);
    expect(input.findingEvidenceLinks).toEqual(
      [...input.findingEvidenceLinks].sort((left, right) => {
        if (left.findingId !== right.findingId) {
          return left.findingId < right.findingId ? -1 : 1;
        }
        return left.evidenceId < right.evidenceId ? -1 : 1;
      }),
    );
  });

  it("filters client findings/evidence/artifacts before reads and keeps only current ready revisions", async () => {
    const visible = { ...finding("finding-visible"), review_state: "confirmed" };
    const hidden = { ...finding("finding-hidden"), review_state: "ignored" };
    const needsData = {
      ...finding("finding-needs-data"),
      review_state: "needs_more_data",
    };
    vi.mocked(FindingsRepository.prototype.list).mockImplementationOnce(
      async (_scope, options) => ({
        rows: options.excludedReviewStates ? [visible] : [visible, hidden, needsData],
        nextCursor: null,
      }),
    );
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValueOnce([
      {
        finding_id: visible.id,
        evidence_id: "evidence-shared",
        role: "primary",
      },
      {
        finding_id: visible.id,
        evidence_id: "evidence-shared",
        role: "supporting",
      },
      {
        finding_id: visible.id,
        evidence_id: "evidence-visible-only",
        role: "primary",
      },
    ]);
    mockEvidenceExportPages([
      evidenceRow("evidence-shared", "evidence-shared"),
      evidenceRow("evidence-visible-only", "evidence-visible-only"),
    ]);
    vi.mocked(
      ExecutionArtifactsRepository.prototype.listByProject,
    ).mockImplementationOnce(async (_scope, options) => ({
      rows: options.status === "ready"
        ? [
            {
              ...artifact("artifact-ready"),
              current_revision: 2,
              validation_state: "valid",
            } as ArtifactRow,
          ]
        : [artifact("artifact-draft")],
      nextCursor: null,
    }));
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).mockResolvedValueOnce({
      ...revision("artifact-ready", 2),
      validation_errors: [],
    } as ArtifactRevisionRow);
    mocks.transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );
    mocks.put.mockRejectedValueOnce(new Error("stop after assembly"));

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(FindingsRepository.prototype.list).toHaveBeenCalledWith(scope, {
      limit: 500,
      cursor: null,
      activeOnly: false,
      excludedReviewStates: ["ignored", "needs_more_data"],
    });
    expect(EvidenceRepository.prototype.listForFindings).toHaveBeenCalledWith(
      scope,
      [visible.id],
      { maxRows: 100_001 },
    );
    expect(
      EvidenceRepository.prototype.listExportByteSizesByIdsPage,
    ).toHaveBeenCalledWith(
      scope,
      ["evidence-shared", "evidence-visible-only"],
      { limit: 25, cursor: null },
    );
    expect(
      ExecutionArtifactsRepository.prototype.listByProject,
    ).toHaveBeenCalledWith(scope, {
      limit: 500,
      cursor: null,
      status: "ready",
    });
    expect(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).toHaveBeenCalledWith(scope, "artifact-ready", 2);
    expect(
      ExecutionArtifactsRepository.prototype.listRevisionsPage,
    ).not.toHaveBeenCalled();
    const assembledInput = mocks.assembleBundle.mock.calls[0]![0] as BundleInput;
    expect(assembledInput.findings.map((row) => row["id"])).toEqual([
      visible.id,
    ]);
    expect(assembledInput.evidence.map((row) => row["id"])).toEqual([
      "evidence-shared",
      "evidence-visible-only",
    ]);
    expect(assembledInput.findingEvidenceLinks).toEqual([
      { findingId: visible.id, evidenceId: "evidence-shared" },
      { findingId: visible.id, evidenceId: "evidence-visible-only" },
    ]);
    expect(assembledInput.artifacts).toEqual([
      expect.objectContaining({
        id: "artifact-ready",
        status: "ready",
        currentRevision: 2,
        revisions: [
          expect.objectContaining({ revision: 2, content: "# artifact-ready" }),
        ],
      }),
    ]);
  });

  it("lets a near-limit client skip large hidden bytes while the same service data is limited", async () => {
    const visible = {
      ...finding("finding-visible-budget"),
      review_state: "confirmed",
    };
    const hidden = Array.from({ length: 4 }, (_, index) => ({
      ...finding(`finding-hidden-budget-${index}`),
      review_state: index % 2 === 0 ? "ignored" : "needs_more_data",
      summary: "界".repeat(4_000),
    }));
    vi.mocked(FindingsRepository.prototype.list).mockImplementation(
      async (_scope, options) => ({
        rows: options.excludedReviewStates ? [visible] : [visible, ...hidden],
        nextCursor: options.excludedReviewStates ? null : "overflow-sentinel",
      }),
    );
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockImplementation(
      async (_scope, findingIds) =>
        findingIds.map((findingId) => ({
          finding_id: findingId,
          evidence_id: `evidence-${findingId}`,
          role: "primary",
        })),
    );
    mockEvidenceExportPages([
      evidenceRow(`evidence-${visible.id}`, "visible evidence"),
    ]);
    vi.mocked(
      ExecutionArtifactsRepository.prototype.listByProject,
    ).mockImplementation(async (_scope, options) => ({
      rows: options.status === "ready"
        ? [{ ...artifact("artifact-ready-budget"), current_revision: 1 }]
        : [
            { ...artifact("artifact-ready-budget"), current_revision: 1 },
            artifact("artifact-draft-budget"),
          ],
      nextCursor: null,
    } as never));
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).mockResolvedValue(revision("artifact-ready-budget", 1));
    vi.mocked(AsyncRunsRepository.prototype.claim)
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({
        ...run,
        request_payload: { kind: "service_bundle", outputLocale: "en" },
      });
    mocks.put.mockRejectedValueOnce(new Error("stop after client assembly"));

    await withBundleReadLimits(
      { maxItems: 100, maxEstimatedBytes: 8 * 1024 },
      async () => {
        await expect(
          runExport(ctx, { runId: run.id, ...scope }),
        ).resolves.toBeUndefined();
        await expect(
          runExport(ctx, { runId: run.id, ...scope }),
        ).resolves.toBeUndefined();
      },
    );

    expect(mocks.assembleBundle).toHaveBeenCalledOnce();
    const clientInput = mocks.assembleBundle.mock.calls[0]![0] as BundleInput;
    expect(clientInput.findings.map((row) => row["id"])).toEqual([visible.id]);
    expect(clientInput.evidence.map((row) => row["id"])).toEqual([
      `evidence-${visible.id}`,
    ]);
    expect(FindingsRepository.prototype.list).toHaveBeenNthCalledWith(1, scope, {
      limit: 100,
      cursor: null,
      activeOnly: false,
      excludedReviewStates: ["ignored", "needs_more_data"],
    });
    expect(FindingsRepository.prototype.list).toHaveBeenNthCalledWith(2, scope, {
      limit: 100,
      cursor: null,
      activeOnly: false,
    });
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenLastCalledWith(
      attempt,
      expect.objectContaining({
        lastErrorCode: "EXPORT_BUNDLE_LIMIT_EXCEEDED",
      }),
    );
  });

  it("deep-redacts free-form export content before handing input to the assembler", async () => {
    vi.mocked(ProjectsRepository.prototype.findById).mockResolvedValueOnce({
      id: scope.projectId,
      workspace_id: scope.workspaceId,
      client_name: `Acme ${EXPORT_SECRET_FIXTURES.oauthToken}`,
      project_name: `Growth ${EXPORT_SECRET_FIXTURES.apiKey}`,
      stage: "executing",
      default_delivery_locale: "en",
      current_icp_profile_id: null,
      confirmed_icp_profile_id: null,
      archived_at: null,
      created_by: "actor-1",
      created_at: "2026-07-19T00:00:00.000Z",
      updated_at: "2026-07-19T00:00:00.000Z",
    });
    vi.mocked(
      SourceConnectionsRepository.prototype.listByProject,
    ).mockResolvedValueOnce([
      {
        id: "source-1",
        provider: "gsc",
        connection_type: "oauth",
        state: "available",
        limitation: EXPORT_SECRET_FIXTURES.cookie,
      },
    ] as never);
    vi.mocked(DataSnapshotsRepository.prototype.listByProject).mockResolvedValueOnce({
      rows: [snapshot("snapshot-redaction")],
      nextCursor: null,
    });
    vi.mocked(
      ObservationsRepository.prototype.listBySnapshotIdsPage,
    ).mockResolvedValueOnce({
      rows: [
        {
          ...observation("snapshot-redaction"),
          value_json: {
            access_token: EXPORT_SECRET_FIXTURES.bearer,
            note: EXPORT_SECRET_FIXTURES.ciphertext,
          },
        } as ObservationRow,
      ],
      nextCursor: null,
    });
    vi.mocked(FindingsRepository.prototype.list).mockResolvedValueOnce({
      rows: [
        {
          ...finding("finding-redaction"),
          summary: `Finding ${EXPORT_SECRET_FIXTURES.apiKey}`,
        },
      ],
      nextCursor: null,
    });
    vi.mocked(EvidenceRepository.prototype.listForFindings).mockResolvedValueOnce(
      [],
    );
    vi.mocked(EvidenceRepository.prototype.findByIds).mockResolvedValueOnce([]);
    vi.mocked(ActionsRepository.prototype.list).mockResolvedValueOnce({
      rows: [
        {
          ...action("action-redaction"),
          title: EXPORT_SECRET_FIXTURES.cookie,
        },
      ],
      nextCursor: null,
    });
    vi.mocked(
      ExecutionArtifactsRepository.prototype.listByProject,
    ).mockResolvedValueOnce({
      rows: [
        {
          ...artifact("artifact-redaction"),
          current_revision: 1,
          validation_state: "valid",
        } as ArtifactRow,
      ],
      nextCursor: null,
    });
    vi.mocked(
      ExecutionArtifactsRepository.prototype.findRevision,
    ).mockResolvedValueOnce({
      ...revision("artifact-redaction"),
      content_text:
        `# Secret fixture\n${EXPORT_SECRET_FIXTURES.clientSecretAssignment}\n` +
        `${EXPORT_SECRET_FIXTURES.ciphertext}\n`,
    } as ArtifactRevisionRow);
    mocks.put.mockRejectedValueOnce(new Error("stop after assembly"));

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    const assembledInput = mocks.assembleBundle.mock.calls[0]![0] as BundleInput;
    const serialized = JSON.stringify(assembledInput);
    for (const secret of Object.values(EXPORT_SECRET_FIXTURES)) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("[redacted]");
  });
});

describe("runExport orphan cleanup", () => {
  const uploadedKey = `export/${scope.projectId}/${run.id}/uploaded`;

  it("deletes only its own upload when the attempt epoch is stale before finalize", async () => {
    mocks.put.mockResolvedValueOnce({
      key: uploadedKey,
      sha256: "sha256",
      bytes: 3,
    });
    mocks.transaction.mockImplementationOnce(
      async (callback: (tx: object) => Promise<unknown>) => callback({}),
    );
    vi.mocked(
      AsyncRunsRepository.prototype.lockAttemptForUpdate,
    ).mockResolvedValueOnce(null);

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(ExportBundlesRepository.prototype.finalize).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
    expect(mocks.deleteObject).toHaveBeenCalledOnce();
    expect(mocks.deleteObject).toHaveBeenCalledWith(uploadedKey);
  });

  it("best-effort deletes an upload when the transaction callback fails before COMMIT", async () => {
    const databaseFailure = Object.assign(new Error("database unavailable"), {
      code: "08006",
    });
    mocks.put.mockResolvedValueOnce({
      key: uploadedKey,
      sha256: "sha256",
      bytes: 3,
    });
    vi.mocked(ExportBundlesRepository.prototype.finalize).mockRejectedValueOnce(
      databaseFailure,
    );

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).rejects.toBe(databaseFailure);

    expect(mocks.deleteObject).toHaveBeenCalledOnce();
    expect(mocks.deleteObject).toHaveBeenCalledWith(uploadedKey);
    expect(AsyncRunsRepository.prototype.resetToQueued).toHaveBeenCalledWith(
      attempt,
    );
  });

  it("does not delete an upload when the callback completed before COMMIT became unknown", async () => {
    const unknownCommit = Object.assign(new Error("commit result unknown"), {
      code: "08006",
    });
    mocks.put.mockResolvedValueOnce({
      key: uploadedKey,
      sha256: "sha256",
      bytes: 3,
    });
    mocks.transaction.mockImplementation(
      async (
        callback: (tx: object) => Promise<unknown>,
        config?: { isolationLevel?: string },
      ) => {
        if (config?.isolationLevel === "repeatable read") {
          return callback({ role: "read" });
        }
        await callback({ role: "write" });
        throw unknownCommit;
      },
    );

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).rejects.toBe(unknownCommit);

    expect(ExportBundlesRepository.prototype.finalize).toHaveBeenCalledWith(
      bundle.id,
      expect.objectContaining({ objectKey: uploadedKey }),
    );
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("acks a commit-unknown result when the canonical run proves COMMIT succeeded", async () => {
    const unknownCommit = Object.assign(new Error("commit result unknown"), {
      code: "08006",
    });
    mocks.put.mockResolvedValueOnce({
      key: uploadedKey,
      sha256: "sha256",
      bytes: 3,
    });
    mocks.transaction.mockImplementation(
      async (
        callback: (tx: object) => Promise<unknown>,
        config?: { isolationLevel?: string },
      ) => {
        if (config?.isolationLevel === "repeatable read") {
          return callback({ role: "read" });
        }
        await callback({ role: "write" });
        throw unknownCommit;
      },
    );
    vi.mocked(AsyncRunsRepository.prototype.resetToQueued).mockResolvedValueOnce(
      false,
    );

    await expect(
      runExport(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();

    expect(ExportBundlesRepository.prototype.finalize).toHaveBeenCalledWith(
      bundle.id,
      expect.objectContaining({ objectKey: uploadedKey }),
    );
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.resetToQueued).toHaveBeenCalledWith(
      attempt,
    );
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("export_skip_stale_attempt", {
      code: "08006",
    });
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
    vi.mocked(ExportBundlesRepository.prototype.finalize).mockRejectedValueOnce(
      databaseFailure,
    );
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
