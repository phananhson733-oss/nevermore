import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  contentHash,
  ExportBundlesRepository,
  IdempotencyRepository,
  ProjectsRepository,
  StorageObjectReferencesRepository,
  type AsyncRunRow,
  type ExportBundleRow,
  type IdempotencyRow,
  type ProjectRow,
} from "@sf/db";
import { ProblemError } from "@sf/observability";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  enqueueRunInTx: vi.fn(),
  getBoss: vi.fn(),
  signDownloadUrl: vi.fn(),
}));

vi.mock("@sf/db", async () => {
  const actual = await vi.importActual<typeof import("@sf/db")>("@sf/db");
  return { ...actual, enqueueRunInTx: mocks.enqueueRunInTx };
});
vi.mock("@/lib/db", () => ({
  getDb: () => ({ db: { transaction: mocks.transaction } }),
}));
vi.mock("@/lib/boss", () => ({ getBoss: mocks.getBoss }));
vi.mock("@/lib/storage", () => ({
  getExportDownloadSigner: () => ({
    signDownloadUrl: mocks.signDownloadUrl,
  }),
}));

const { createProjectExport, getProjectExport } = await import(
  "../export-service.ts"
);

const scope = { workspaceId: "workspace-1" };
const projectId = "project-1";
const actorId = "user-1";
const key = "export-idem-1";
const body = { kind: "client_bundle" as const, outputLocale: "en" as const };
const requestHash = contentHash({ projectId, ...body });
const project = {
  id: projectId,
  workspace_id: scope.workspaceId,
  archived_at: null,
} as ProjectRow;
const run = {
  id: "run-export-1",
  workspace_id: scope.workspaceId,
  project_id: projectId,
  kind: "export",
  status: "queued",
  progress: {},
  last_error_code: null,
  last_error_summary: null,
  result_type: null,
  result_id: null,
  queued_at: "2026-07-18T12:00:00.000Z",
  started_at: null,
  completed_at: null,
} as AsyncRunRow;
const bundle = {
  id: "export-1",
  workspace_id: scope.workspaceId,
  project_id: projectId,
  async_run_id: run.id,
  kind: body.kind,
  schema_version: "signalframe.service-bundle.0.3.0",
  output_locale: body.outputLocale,
  object_key: null,
  checksum: null,
  byte_size: null,
  item_counts: {},
  manifest: null,
  created_by: actorId,
  created_at: "2026-07-18T12:00:00.000Z",
} as ExportBundleRow;
const reservation = {
  id: "idem-row-1",
  request_hash: requestHash,
  status: "in_progress",
  resource_id: null,
  response_body: null,
} as IdempotencyRow;

function replayKey(overrides: Partial<IdempotencyRow> = {}): IdempotencyRow {
  return {
    ...reservation,
    status: "completed",
    resource_id: bundle.id,
    response_body: {
      run: {
        id: run.id,
        projectId,
        kind: run.kind,
        status: run.status,
        progress: {
          phase: "queued",
          current: 0,
          total: null,
          messageKey: "run.queued",
        },
        lastError: null,
        resultRef: null,
        queuedAt: run.queued_at,
        startedAt: null,
        completedAt: null,
      },
      statusUrl: `/api/mvp/projects/${projectId}/runs/${run.id}`,
      resourceRef: { id: bundle.id },
    },
    ...overrides,
  } as IdempotencyRow;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.transaction.mockReset();
  mocks.enqueueRunInTx.mockReset().mockResolvedValue("job-1");
  mocks.getBoss.mockReset().mockResolvedValue({});
  mocks.signDownloadUrl.mockReset().mockResolvedValue("https://signed.example/export");
  mocks.transaction.mockImplementation(
    async (callback: (tx: object) => Promise<unknown>) => callback({}),
  );
  vi.spyOn(IdempotencyRepository.prototype, "find").mockResolvedValue(null);
  vi.spyOn(IdempotencyRepository.prototype, "begin").mockResolvedValue(
    reservation,
  );
  vi.spyOn(IdempotencyRepository.prototype, "complete").mockResolvedValue();
  vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue(project);
  vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue(
    project,
  );
  vi.spyOn(AsyncRunsRepository.prototype, "findActive").mockResolvedValue(null);
  vi.spyOn(AsyncRunsRepository.prototype, "insertQueued").mockResolvedValue(run);
  vi.spyOn(ExportBundlesRepository.prototype, "insert").mockResolvedValue(bundle);
  vi.spyOn(
    StorageObjectReferencesRepository.prototype,
    "databaseNow",
  ).mockResolvedValue(new Date("2026-07-19T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createProjectExport", () => {
  it("atomically accepts a bundle and records a replayable response", async () => {
    const result = await createProjectExport(
      scope,
      projectId,
      actorId,
      key,
      body,
    );
    expect(result).toMatchObject({
      status: 202,
      resourceRef: { type: "export", id: bundle.id },
      location: `/api/mvp/projects/${projectId}/runs/${run.id}`,
    });
    expect(AsyncRunsRepository.prototype.insertQueued).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "export",
        activeKey: "export:client_bundle",
        contractVersion: "2026-07-21",
        requestPayload: body,
      }),
    );
    expect(mocks.enqueueRunInTx).toHaveBeenCalledWith(
      {},
      {},
      "export.bundle",
      expect.objectContaining({
        runId: run.id,
        contractVersion: "2026-07-21",
      }),
    );
    expect(IdempotencyRepository.prototype.complete).toHaveBeenCalledWith(
      reservation.id,
      expect.objectContaining({ resourceType: "export", resourceId: bundle.id }),
    );
  });

  it("replays a completed command even after the project disappears", async () => {
    vi.mocked(IdempotencyRepository.prototype.find).mockResolvedValueOnce(
      replayKey(),
    );
    vi.mocked(ProjectsRepository.prototype.findById).mockResolvedValueOnce(null);
    await expect(
      createProjectExport(scope, projectId, actorId, key, body),
    ).resolves.toMatchObject({ resourceRef: { id: bundle.id } });
    expect(ProjectsRepository.prototype.findById).not.toHaveBeenCalled();
  });

  it("uses the stored resource id when an older response omitted resourceRef", async () => {
    const original = replayKey();
    vi.mocked(IdempotencyRepository.prototype.find).mockResolvedValueOnce(
      replayKey({
        response_body: {
          ...(original.response_body as object),
          resourceRef: undefined,
        },
      }),
    );
    await expect(
      createProjectExport(scope, projectId, actorId, key, body),
    ).resolves.toMatchObject({ resourceRef: { id: bundle.id } });
  });

  it("continues a new command when an old key is incomplete or malformed", async () => {
    vi.mocked(IdempotencyRepository.prototype.find).mockResolvedValueOnce({
      ...reservation,
      status: "completed",
      resource_id: bundle.id,
      response_body: { statusUrl: "/missing-run" },
    });
    await expect(
      createProjectExport(scope, projectId, actorId, key, body),
    ).resolves.toMatchObject({ status: 202 });
  });

  it("rejects a key reused with another export request", async () => {
    vi.mocked(IdempotencyRepository.prototype.find).mockResolvedValueOnce(
      replayKey({ request_hash: "different" }),
    );
    await expect(
      createProjectExport(scope, projectId, actorId, key, body),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("rejects missing and archived projects", async () => {
    vi.mocked(ProjectsRepository.prototype.findById).mockResolvedValueOnce(null);
    await expect(
      createProjectExport(scope, projectId, actorId, key, body),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    vi.mocked(ProjectsRepository.prototype.findById).mockResolvedValueOnce({
      ...project,
      archived_at: "2026-07-18",
    });
    await expect(
      createProjectExport(scope, projectId, actorId, "key-2", body),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
  });

  it("replays an active command that won the read race", async () => {
    vi.mocked(AsyncRunsRepository.prototype.findActive).mockResolvedValueOnce(run);
    vi.mocked(IdempotencyRepository.prototype.find)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(replayKey());
    await expect(
      createProjectExport(scope, projectId, actorId, key, body),
    ).resolves.toMatchObject({ resourceRef: { id: bundle.id } });
  });

  it("returns the active run location when the winner used another key", async () => {
    vi.mocked(AsyncRunsRepository.prototype.findActive).mockResolvedValueOnce(run);
    await expect(
      createProjectExport(scope, projectId, actorId, key, body),
    ).rejects.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      extraHeaders: {
        Location: `/api/mvp/projects/${projectId}/runs/${run.id}`,
      },
    });
  });

  it("replays a winner that reserved the idempotency key first", async () => {
    vi.mocked(IdempotencyRepository.prototype.begin).mockResolvedValueOnce(null);
    vi.mocked(IdempotencyRepository.prototype.find)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(replayKey());
    await expect(
      createProjectExport(scope, projectId, actorId, key, body),
    ).resolves.toMatchObject({ resourceRef: { id: bundle.id } });
  });

  it("rejects a reservation that is still being processed", async () => {
    vi.mocked(IdempotencyRepository.prototype.begin).mockResolvedValueOnce(null);
    vi.mocked(IdempotencyRepository.prototype.find)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(reservation);
    await expect(
      createProjectExport(scope, projectId, actorId, key, body),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("recovers unique races through replay or a winning active run", async () => {
    mocks.transaction.mockRejectedValueOnce({
      cause: {
        cause: {
          code: "23505",
          constraint: "async_runs_one_active_key_idx",
        },
      },
    });
    vi.mocked(IdempotencyRepository.prototype.find)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(replayKey());
    await expect(
      createProjectExport(scope, projectId, actorId, key, body),
    ).resolves.toMatchObject({ resourceRef: { id: bundle.id } });

    mocks.transaction.mockRejectedValueOnce({
      code: "23505",
      constraint: "async_runs_one_active_key_idx",
    });
    vi.mocked(IdempotencyRepository.prototype.find).mockResolvedValue(null);
    vi.mocked(AsyncRunsRepository.prototype.findActive)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(run);
    await expect(
      createProjectExport(scope, projectId, actorId, "key-2", body),
    ).rejects.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      extraHeaders: { Location: expect.stringContaining(run.id) },
    });
  });

  it("preserves a non-unique transaction error", async () => {
    const failure = new Error("database offline");
    mocks.transaction.mockRejectedValueOnce(failure);
    await expect(
      createProjectExport(scope, projectId, actorId, key, body),
    ).rejects.toBe(failure);
  });
});

describe("getProjectExport", () => {
  it("returns a historical 0.2 bundle through the current read DTO", async () => {
    vi.spyOn(ExportBundlesRepository.prototype, "findById").mockResolvedValue({
      ...bundle,
      schema_version: "signalframe.service-bundle.0.2.0",
    });
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue(run);

    await expect(
      getProjectExport(scope, projectId, bundle.id),
    ).resolves.toMatchObject({
      id: bundle.id,
      schemaVersion: "signalframe.service-bundle.0.2.0",
    });
  });

  it("fails closed instead of emitting an undocumented export schema version", async () => {
    vi.spyOn(ExportBundlesRepository.prototype, "findById").mockResolvedValue({
      ...bundle,
      schema_version: "signalframe.service-bundle.9.9.9",
    });
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue(run);

    await expect(
      getProjectExport(scope, projectId, bundle.id),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Export metadata is temporarily unavailable.",
    });
  });

  it("returns a pending bundle without attempting to sign it", async () => {
    vi.spyOn(ExportBundlesRepository.prototype, "findById").mockResolvedValue(
      bundle,
    );
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue(run);
    await expect(
      getProjectExport(scope, projectId, bundle.id),
    ).resolves.toMatchObject({
      id: bundle.id,
      downloadUrl: null,
      downloadExpiresAt: null,
      itemCounts: {},
    });
    expect(mocks.signDownloadUrl).not.toHaveBeenCalled();
  });

  it("also withholds a URL when an object exists but its run is not complete", async () => {
    vi.spyOn(ExportBundlesRepository.prototype, "findById").mockResolvedValue({
      ...bundle,
      object_key: "exports/project-1/run-1/archive.zip",
    });
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue(run);
    await expect(
      getProjectExport(scope, projectId, bundle.id),
    ).resolves.toMatchObject({ downloadUrl: null });
    expect(mocks.signDownloadUrl).not.toHaveBeenCalled();
  });

  it("fails closed when a completed export is missing its completion anchor", async () => {
    vi.spyOn(ExportBundlesRepository.prototype, "findById").mockResolvedValue({
      ...bundle,
      object_key: "exports/project-1/run-1/archive.zip",
    });
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue({
      ...run,
      status: "completed",
      completed_at: null,
    });

    await expect(
      getProjectExport(scope, projectId, bundle.id),
    ).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Export metadata is temporarily unavailable.",
    });
    expect(
      StorageObjectReferencesRepository.prototype.databaseNow,
    ).not.toHaveBeenCalled();
    expect(mocks.signDownloadUrl).not.toHaveBeenCalled();
  });

  it("signs completed bundles and filters malformed item counts", async () => {
    vi.spyOn(ExportBundlesRepository.prototype, "findById").mockResolvedValue({
      ...bundle,
      object_key: "exports/project-1/run-1/archive.zip",
      checksum: "checksum",
      item_counts: { findings: 4, artifacts: 2, malformed: "three" },
    });
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue({
      ...run,
      status: "completed",
      completed_at: "2026-07-18T12:01:00.000Z",
    });
    const result = await getProjectExport(scope, projectId, bundle.id);
    expect(result).toMatchObject({
      downloadUrl: "https://signed.example/export",
      downloadExpiresAt: expect.any(String),
      itemCounts: { findings: 4, artifacts: 2 },
    });
    expect(result.itemCounts).not.toHaveProperty("malformed");
    expect(mocks.signDownloadUrl).toHaveBeenCalledWith(
      "exports/project-1/run-1/archive.zip",
      { expiresInSeconds: 900 },
    );
  });

  it("anchors the exact 15-minute expiry to signing start, not a delayed response", async () => {
    const signingStartedAt = new Date("2026-07-19T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(signingStartedAt);
    vi.spyOn(ExportBundlesRepository.prototype, "findById").mockResolvedValue({
      ...bundle,
      object_key: "export/project-1/run-1/archive.zip",
    });
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue({
      ...run,
      status: "completed",
      completed_at: bundle.created_at,
    });
    mocks.signDownloadUrl.mockImplementationOnce(async () => {
      // Simulate a slow signing dependency. The API must never advertise an
      // expiry later than the 900-second window it requested.
      vi.setSystemTime(new Date(signingStartedAt.getTime() + 60_000));
      return "https://signed.example/export?token=fresh";
    });

    const result = await getProjectExport(scope, projectId, bundle.id);

    expect(result.downloadExpiresAt).toBe("2026-07-19T00:15:00.000Z");
    expect(mocks.signDownloadUrl).toHaveBeenCalledWith(
      "export/project-1/run-1/archive.zip",
      { expiresInSeconds: 900 },
    );
  });

  it("re-signs a completed object before its 30-day retention boundary", async () => {
    const ageDays = 29;
    const completedAt = new Date(bundle.created_at);
    const now = new Date(
      completedAt.getTime() + ageDays * 24 * 60 * 60 * 1000,
    );
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.mocked(
      StorageObjectReferencesRepository.prototype.databaseNow,
    ).mockResolvedValue(now);
    vi.spyOn(
      ExportBundlesRepository.prototype,
      "findById",
    ).mockResolvedValue({
      ...bundle,
      object_key: "export/project-1/run-1/archive.zip",
    });
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue({
      ...run,
      status: "completed",
      completed_at: completedAt.toISOString(),
    });
    mocks.signDownloadUrl.mockResolvedValueOnce(
      `https://signed.example/export?ageDays=${ageDays}`,
    );

    const result = await getProjectExport(scope, projectId, bundle.id);

    expect(result.downloadUrl).toContain(`ageDays=${ageDays}`);
    expect(result.downloadExpiresAt).toBe(
      new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    );
    expect(mocks.signDownloadUrl).toHaveBeenCalledWith(
      "export/project-1/run-1/archive.zip",
      { expiresInSeconds: 900 },
    );
  });

  it("starts the 30-day visibility window when a delayed worker commits the upload", async () => {
    const placeholderCreatedAt = new Date(bundle.created_at);
    const completedAt = new Date(
      placeholderCreatedAt.getTime() + 2 * 24 * 60 * 60 * 1000,
    );
    const databaseNow = new Date(
      completedAt.getTime() + 29 * 24 * 60 * 60 * 1000,
    );
    vi.useFakeTimers();
    vi.setSystemTime(databaseNow);
    vi.mocked(
      StorageObjectReferencesRepository.prototype.databaseNow,
    ).mockResolvedValue(databaseNow);
    vi.spyOn(
      ExportBundlesRepository.prototype,
      "findById",
    ).mockResolvedValue({
      ...bundle,
      object_key: "export/project-1/run-1/archive.zip",
    });
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue({
      ...run,
      status: "completed",
      completed_at: completedAt.toISOString(),
    });

    const result = await getProjectExport(scope, projectId, bundle.id);

    expect(result.downloadUrl).toBe("https://signed.example/export");
    expect(mocks.signDownloadUrl).toHaveBeenCalledWith(
      "export/project-1/run-1/archive.zip",
      { expiresInSeconds: 900 },
    );
  });

  it.each([30, 31])(
    "rejects an expired completed object at age %i days with stable regeneration metadata",
    async (ageDays) => {
      const completedAt = new Date(
        new Date(bundle.created_at).getTime() + 24 * 60 * 60 * 1000,
      );
      const databaseNow = new Date(
        completedAt.getTime() + ageDays * 24 * 60 * 60 * 1000,
      );
      vi.mocked(
        StorageObjectReferencesRepository.prototype.databaseNow,
      ).mockResolvedValue(databaseNow);
      vi.spyOn(
        ExportBundlesRepository.prototype,
        "findById",
      ).mockResolvedValue({
        ...bundle,
        object_key: "export/project-1/run-1/archive.zip",
      });
      vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue({
        ...run,
        status: "completed",
        completed_at: completedAt.toISOString(),
      });

      const response = getProjectExport(scope, projectId, bundle.id);

      await expect(response).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Export has expired. Generate a new export.",
        current: {
          reason: "retention_expired",
          regeneratable: true,
          retentionDays: 30,
        },
      });
      expect(mocks.signDownloadUrl).not.toHaveBeenCalled();
    },
  );

  it("returns a non-enumerating 404 when the export id is scoped to another project", async () => {
    const wrongProjectId = "project-2";
    vi.spyOn(ExportBundlesRepository.prototype, "findById").mockResolvedValue(
      null,
    );

    const response = getProjectExport(scope, wrongProjectId, bundle.id);

    await expect(response).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    expect(ExportBundlesRepository.prototype.findById).toHaveBeenCalledWith(
      { workspaceId: scope.workspaceId, projectId: wrongProjectId },
      bundle.id,
    );
    expect(mocks.signDownloadUrl).not.toHaveBeenCalled();
  });

  it("returns non-enumerating 404s for a missing bundle or run", async () => {
    vi.spyOn(ExportBundlesRepository.prototype, "findById").mockResolvedValueOnce(
      null,
    );
    await expect(
      getProjectExport(scope, projectId, "missing"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    vi.mocked(ExportBundlesRepository.prototype.findById).mockResolvedValueOnce(
      bundle,
    );
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValueOnce(
      null,
    );
    const missingRun = getProjectExport(scope, projectId, bundle.id);
    await expect(missingRun).rejects.toBeInstanceOf(ProblemError);
    await expect(missingRun).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
