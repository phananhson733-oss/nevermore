import {
  AsyncRunsRepository,
  contentHash,
  enqueueRunInTx,
  ExportBundlesRepository,
  EXPORT_OBJECT_RETENTION_DAYS,
  EXPORT_OBJECT_RETENTION_MS,
  IdempotencyRepository,
  ProjectsRepository,
  StorageObjectReferencesRepository,
  isStorageObjectExpired,
  type ExportBundleRow,
  type WorkspaceScope,
} from "@sf/db";
import type { CreateExportRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import {
  BlobObjectNotFoundError,
  ObjectOutOfProjectScopeError,
  SupabaseSignError,
  SupabaseStorageError,
} from "@sf/sources";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { getExportDownloadSigner } from "@/lib/storage";
import { isPostgresUniqueViolation } from "./db-errors";
import { toAsyncRunDto, runStatusUrl, type AsyncRunDto } from "./runs";

/**
 * Enterprise export (spec §10.5). Create is async (202); the worker assembles the
 * ZIP, uploads it, and finalizes checksum + manifest. Download URLs are signed for
 * 15 minutes and only issued from a committed row. `export:{kind}` active key
 * serializes concurrent exports of the same kind.
 */

const CONTRACT_VERSION = "2026-07-18";
const IDEMPOTENCY_SCOPE = "createProjectExport";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const SIGNED_URL_TTL_S = 15 * 60;

export interface ExportAcceptedResult {
  readonly status: 202;
  readonly run: AsyncRunDto;
  readonly statusUrl: string;
  readonly resourceRef: { type: "export"; id: string };
  readonly location: string;
}

function replayExport(
  row: {
    request_hash: string;
    status: string;
    resource_id: string | null;
    response_body: unknown;
  },
  requestHash: string,
): ExportAcceptedResult | null {
  if (row.request_hash !== requestHash) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key reused with a different request.",
    );
  }
  if (row.status !== "completed" || !row.resource_id) return null;
  const body = row.response_body as
    | {
        run: AsyncRunDto;
        statusUrl: string;
        resourceRef?: { id?: string };
      }
    | null;
  if (!body?.run || !body.statusUrl) return null;
  return {
    status: 202,
    run: body.run,
    statusUrl: body.statusUrl,
    resourceRef: {
      type: "export",
      id: body.resourceRef?.id ?? row.resource_id,
    },
    location: body.statusUrl,
  };
}

function activeExportConflict(projectId: string, runId?: string): ProblemError {
  return new ProblemError(
    "RUN_ALREADY_ACTIVE",
    "An export of this kind is already running.",
    {
      ...(runId
        ? { headers: { Location: runStatusUrl(projectId, runId) } }
        : {}),
    },
  );
}

export interface ExportBundleDto {
  id: string;
  kind: string;
  schemaVersion: string;
  outputLocale: string;
  run: AsyncRunDto;
  checksum: string | null;
  itemCounts: Record<string, number>;
  downloadUrl: string | null;
  downloadExpiresAt: string | null;
  createdAt: string;
}

export async function createProjectExport(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: CreateExportRequest,
): Promise<ExportAcceptedResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();

  // Completed commands replay independently of later project lifecycle state.
  // The project is still validated for every genuinely new request below.
  const requestHash = contentHash({
    projectId,
    kind: body.kind,
    outputLocale: body.outputLocale,
  });
  const idem = new IdempotencyRepository(db);
  const existing = await idem.find(
    scope.workspaceId,
    IDEMPOTENCY_SCOPE,
    idempotencyKey,
  );
  if (existing) {
    const replay = replayExport(existing, requestHash);
    if (replay) return replay;
  }

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at)
    throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");

  const activeKey = `export:${body.kind}`;
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
  const active = await new AsyncRunsRepository(db).findActive(
    projectScope,
    activeKey,
  );
  if (active) {
    const now = await idem.find(
      scope.workspaceId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
    );
    const replay = now ? replayExport(now, requestHash) : null;
    if (replay) return replay;
    throw activeExportConflict(projectId, active.id);
  }

  const boss = await getBoss();
  try {
    return await db.transaction(async (tx) => {
      const txIdem = new IdempotencyRepository(tx);
      const txProjects = new ProjectsRepository(tx);
      const reserved = await txIdem.begin({
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        requestHash,
        expiresAt,
      });
      if (!reserved) {
        const winner = await txIdem.find(
          scope.workspaceId,
          IDEMPOTENCY_SCOPE,
          idempotencyKey,
        );
        const replay = winner ? replayExport(winner, requestHash) : null;
        if (replay) return replay;
        throw new ProblemError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency key is being processed.",
        );
      }

      const currentProject = await txProjects.findByIdForUpdate(scope, projectId);
      if (!currentProject) {
        throw new ProblemError("NOT_FOUND", "Project not found.");
      }
      if (currentProject.archived_at) {
        throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");
      }

      const run = await new AsyncRunsRepository(tx).insertQueued({
        workspaceId: scope.workspaceId,
        projectId,
        kind: "export",
        activeKey,
        initiatedBy: actorId,
        contractVersion: CONTRACT_VERSION,
        requestPayload: { kind: body.kind, outputLocale: body.outputLocale },
      });
      const bundle = await new ExportBundlesRepository(tx).insert({
        workspaceId: scope.workspaceId,
        projectId,
        asyncRunId: run.id,
        kind: body.kind,
        outputLocale: body.outputLocale,
        createdBy: actorId,
      });
      await enqueueRunInTx(boss, tx, "export.bundle", {
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        contractVersion: CONTRACT_VERSION,
      });

      const statusUrl = runStatusUrl(projectId, run.id);
      const result: ExportAcceptedResult = {
        status: 202,
        run: toAsyncRunDto(run),
        statusUrl,
        resourceRef: { type: "export", id: bundle.id },
        location: statusUrl,
      };
      await txIdem.complete(reserved.id, {
        responseStatus: 202,
        responseBody: result,
        resourceType: "export",
        resourceId: bundle.id,
      });
      return result;
    });
  } catch (error) {
    if (
      isPostgresUniqueViolation(error, "async_runs_one_active_key_idx")
    ) {
      const winnerKey = await idem.find(
        scope.workspaceId,
        IDEMPOTENCY_SCOPE,
        idempotencyKey,
      );
      const replay = winnerKey ? replayExport(winnerKey, requestHash) : null;
      if (replay) return replay;
      const winner = await new AsyncRunsRepository(db).findActive(
        projectScope,
        activeKey,
      );
      throw activeExportConflict(projectId, winner?.id);
    }
    throw error;
  }
}

export async function getProjectExport(
  scope: WorkspaceScope,
  projectId: string,
  exportId: string,
): Promise<ExportBundleDto> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();
  const bundle = await new ExportBundlesRepository(db).findById(
    projectScope,
    exportId,
  );
  if (!bundle) throw new ProblemError("NOT_FOUND", "Export not found.");
  const run = await new AsyncRunsRepository(db).findById(
    projectScope,
    bundle.async_run_id,
  );
  if (!run) throw new ProblemError("NOT_FOUND", "Export run not found.");

  let downloadUrl: string | null = null;
  let downloadExpiresAt: string | null = null;
  if (bundle.object_key && run.status === "completed") {
    if (run.completed_at === null) {
      throw new ProblemError(
        "DEPENDENCY_UNAVAILABLE",
        "Export metadata is temporarily unavailable.",
      );
    }
    const databaseNow = await new StorageObjectReferencesRepository(
      db,
    ).databaseNow();
    // The object is uploaded immediately before bundle finalization and run
    // completion in the same worker attempt. The API promises 30 days from that
    // canonical completion commit; storage cleanup independently requires both
    // this anchor and Storage's immutable blob `createdAt` to reach the boundary.
    if (
      isStorageObjectExpired(
        run.completed_at,
        databaseNow,
        EXPORT_OBJECT_RETENTION_MS,
      )
    ) {
      throw new ProblemError(
        "NOT_FOUND",
        "Export has expired. Generate a new export.",
        {
          current: {
            reason: "retention_expired",
            regeneratable: true,
            retentionDays: EXPORT_OBJECT_RETENTION_DAYS,
          },
        },
      );
    }
    // Anchor the advertised upper bound before the signing round-trip. If the
    // storage dependency is slow, calculating it after await would overstate
    // the URL's real 900-second lifetime by the request latency.
    const signingStartedAtMs = Date.now();
    try {
      // Project-scoped signer: a key outside this project is rejected before
      // signing, so a wrong-project object can never resolve to a valid URL.
      downloadUrl = await getExportDownloadSigner(projectId).signDownloadUrl(
        bundle.object_key,
        { expiresInSeconds: SIGNED_URL_TTL_S },
      );
    } catch (error) {
      // Missing/out-of-project objects are non-enumerable 404s (§12.2).
      // Known provider failures become a sanitized 503; configuration and
      // unknown programmer errors remain distinct and fail through unchanged.
      if (
        error instanceof ObjectOutOfProjectScopeError ||
        error instanceof BlobObjectNotFoundError
      ) {
        throw new ProblemError("NOT_FOUND", "Export not found.");
      }
      if (
        error instanceof SupabaseSignError ||
        error instanceof SupabaseStorageError
      ) {
        throw new ProblemError(
          "DEPENDENCY_UNAVAILABLE",
          "Export storage is temporarily unavailable.",
        );
      }
      throw error;
    }
    downloadExpiresAt = new Date(
      signingStartedAtMs + SIGNED_URL_TTL_S * 1000,
    ).toISOString();
  }

  return toExportBundleDto(
    bundle,
    toAsyncRunDto(run),
    downloadUrl,
    downloadExpiresAt,
  );
}

function toExportBundleDto(
  row: ExportBundleRow,
  run: AsyncRunDto,
  downloadUrl: string | null,
  downloadExpiresAt: string | null,
): ExportBundleDto {
  const itemCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(row.item_counts)) {
    if (typeof v === "number") itemCounts[k] = v;
  }
  return {
    id: row.id,
    kind: row.kind,
    schemaVersion: row.schema_version,
    outputLocale: row.output_locale,
    run,
    checksum: row.checksum,
    itemCounts,
    downloadUrl,
    downloadExpiresAt,
    createdAt: row.created_at,
  };
}
