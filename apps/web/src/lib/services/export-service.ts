import {
  AsyncRunsRepository,
  contentHash,
  enqueueRunInTx,
  ExportBundlesRepository,
  IdempotencyRepository,
  ProjectsRepository,
  type ExportBundleRow,
  type WorkspaceScope,
} from "@sf/db";
import type { CreateExportRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { getBlobStore } from "@/lib/storage";
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
  readonly resourceRef: { type: "export_bundle"; id: string };
  readonly location: string;
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
  const boss = await getBoss();

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at) throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");

  const activeKey = `export:${body.kind}`;
  const requestHash = contentHash({ kind: body.kind, outputLocale: body.outputLocale });
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  const idem = new IdempotencyRepository(db);
  const existing = await idem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new ProblemError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key reused with a different body.");
    }
    if (existing.status === "completed" && existing.resource_id) {
      const b = existing.response_body as ExportAcceptedResult | null;
      if (b?.run) return { ...b, status: 202 };
    }
  }
  const active = await new AsyncRunsRepository(db).findActive(projectScope, activeKey);
  if (active) {
    throw new ProblemError("RUN_ALREADY_ACTIVE", "An export of this kind is already running.", {
      headers: { Location: runStatusUrl(projectId, active.id) },
    });
  }

  return db.transaction(async (tx) => {
    const txIdem = new IdempotencyRepository(tx);
    const reserved = await txIdem.begin({
      workspaceId: scope.workspaceId,
      scope: IDEMPOTENCY_SCOPE,
      key: idempotencyKey,
      requestHash,
      expiresAt,
    });
    if (!reserved) throw new ProblemError("IDEMPOTENCY_KEY_REUSED", "Idempotency key is being processed.");

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
      resourceRef: { type: "export_bundle", id: bundle.id },
      location: statusUrl,
    };
    await txIdem.complete(reserved.id, {
      responseStatus: 202,
      responseBody: result,
      resourceType: "export_bundle",
      resourceId: bundle.id,
    });
    return result;
  });
}

export async function getProjectExport(
  scope: WorkspaceScope,
  projectId: string,
  exportId: string,
): Promise<ExportBundleDto> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();
  const bundle = await new ExportBundlesRepository(db).findById(projectScope, exportId);
  if (!bundle) throw new ProblemError("NOT_FOUND", "Export not found.");
  const run = await new AsyncRunsRepository(db).findById(projectScope, bundle.async_run_id);
  if (!run) throw new ProblemError("NOT_FOUND", "Export run not found.");

  let downloadUrl: string | null = null;
  let downloadExpiresAt: string | null = null;
  if (bundle.object_key && run.status === "completed") {
    downloadUrl = await getBlobStore().signedUrl(bundle.object_key, SIGNED_URL_TTL_S);
    downloadExpiresAt = new Date(Date.now() + SIGNED_URL_TTL_S * 1000).toISOString();
  }

  return toExportBundleDto(bundle, toAsyncRunDto(run), downloadUrl, downloadExpiresAt);
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
