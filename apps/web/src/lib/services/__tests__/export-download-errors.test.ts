import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  ExportBundlesRepository,
  StorageObjectReferencesRepository,
  type AsyncRunRow,
  type ExportBundleRow,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import {
  BlobObjectNotFoundError,
  BlobStoreConfigurationError,
  ObjectOutOfProjectScopeError,
  SupabaseSignError,
  SupabaseStorageError,
} from "@sf/sources";

const { signDownloadUrl } = vi.hoisted(() => ({
  signDownloadUrl: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({ db: {} }) }));
vi.mock("@/lib/storage", () => ({
  getExportDownloadSigner: () => ({ signDownloadUrl }),
}));

const { getProjectExport } = await import("@/lib/services/export-service");

const bundle = {
  id: "00000000-0000-4000-8000-000000000001",
  workspace_id: "00000000-0000-4000-8000-000000000002",
  project_id: "00000000-0000-4000-8000-000000000003",
  async_run_id: "00000000-0000-4000-8000-000000000004",
  kind: "service_bundle",
  schema_version: "signalframe.service-bundle.0.3.0",
  output_locale: "en",
  object_key:
    "exports/00000000-0000-4000-8000-000000000003/run-1/archive.zip",
  checksum: "a".repeat(64),
  item_counts: {},
  manifest: {},
  created_by: "00000000-0000-4000-8000-000000000005",
  created_at: "2026-07-18T12:00:00.000Z",
} as ExportBundleRow;

const run = {
  id: bundle.async_run_id,
  workspace_id: bundle.workspace_id,
  project_id: bundle.project_id,
  kind: "export",
  status: "completed",
  active_key: null,
  contract_version: "2026-07-21",
  request_payload: {},
  progress: { phase: "completed", current: 1, total: 1, messageKey: "done" },
  last_error_code: null,
  last_error_summary: null,
  result_type: "export",
  result_id: bundle.id,
  attempt_count: 1,
  initiated_by: bundle.created_by,
  queued_at: "2026-07-18T11:59:00.000Z",
  started_at: "2026-07-18T11:59:01.000Z",
  completed_at: "2026-07-18T12:00:00.000Z",
  created_at: "2026-07-18T11:59:00.000Z",
  updated_at: "2026-07-18T12:00:00.000Z",
} as AsyncRunRow;

describe("export download error mapping", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    signDownloadUrl.mockReset();
    vi.spyOn(ExportBundlesRepository.prototype, "findById").mockResolvedValue(
      bundle,
    );
    vi.spyOn(AsyncRunsRepository.prototype, "findById").mockResolvedValue(run);
    vi.spyOn(
      StorageObjectReferencesRepository.prototype,
      "databaseNow",
    ).mockResolvedValue(new Date("2026-07-19T00:00:00.000Z"));
  });

  it.each([
    new BlobObjectNotFoundError(bundle.object_key!),
    new ObjectOutOfProjectScopeError(bundle.object_key!, bundle.project_id),
  ])("maps an absent/out-of-scope object to a 404 problem", async (error) => {
    signDownloadUrl.mockRejectedValueOnce(error);

    const promise = getProjectExport(
      { workspaceId: bundle.workspace_id },
      bundle.project_id,
      bundle.id,
    );
    await expect(promise).rejects.toBeInstanceOf(ProblemError);
    await expect(promise).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it.each([
    new SupabaseSignError("signing service unavailable", { status: 503 }),
    new SupabaseStorageError("sign", bundle.object_key!, { status: 503 }),
  ])("maps an explicit storage dependency failure to a sanitized 503 problem", async (failure) => {
    signDownloadUrl.mockRejectedValueOnce(failure);

    const promise = getProjectExport(
      { workspaceId: bundle.workspace_id },
      bundle.project_id,
      bundle.id,
    );
    await expect(promise).rejects.toBeInstanceOf(ProblemError);
    await expect(promise).rejects.toMatchObject({
      status: 503,
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Export storage is temporarily unavailable.",
    });
  });

  it.each([
    new BlobStoreConfigurationError("missing export bucket"),
    new Error("unexpected signer bug"),
  ])("keeps configuration/unknown failures distinct", async (failure) => {
    signDownloadUrl.mockRejectedValueOnce(failure);

    await expect(
      getProjectExport(
        { workspaceId: bundle.workspace_id },
        bundle.project_id,
        bundle.id,
      ),
    ).rejects.toBe(failure);
  });
});
