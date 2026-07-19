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
  TelemetryRepository,
  type ProjectScope,
} from "@sf/db";
import { assembleBundle, type BundleInput } from "@sf/artifacts";
import { mintExportObjectKey } from "@sf/sources";
import { redact } from "@sf/observability";
import type { WorkerContext } from "../context.ts";
import {
  isTransientInfrastructureError,
  transientFailureCode,
} from "../handlers/transient-errors.ts";
import { runtimeFailureMetadata } from "../runtime-failure.ts";

/**
 * Export job (spec §10.5, §13.3). Loads canonical objects, applies field-level
 * redaction (never SourceCredential / OAuthIntent / import tokens / idempotency /
 * logs / notes / provider usage / AnalysisInvocation), assembles the ZIP + manifest
 * via the pure assembler, uploads it to a final key, then finalizes the bundle row
 * and the run in one transaction.
 *
 * The assembled input is additionally deep key-redacted (spec §14.3, AC-040) as
 * a runtime backstop, so no secret-named field smuggled into free-form content
 * (ICP profile, model artifact JSON, observation value JSON) can leak into the
 * exported bundle even if the field allowlist misses it.
 */

export interface ExportJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

interface ExportRequest {
  kind: "service_bundle" | "client_bundle";
  outputLocale: string;
}

const SNAPSHOT_PAGE_SIZE = 100;
const EXPORT_ENTITY_PAGE_SIZE = 500;
const EXPORT_LOOKUP_CHUNK_SIZE = 100;

interface CursorPage<T> {
  readonly rows: readonly T[];
  readonly nextCursor: string | null;
}

/** Exhaust a trusted keyset paginator; reject a repeated cursor instead of hanging. */
async function collectAllPages<T>(
  loadPage: (cursor: string | null) => Promise<CursorPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (;;) {
    const page = await loadPage(cursor);
    rows.push(...page.rows);
    if (page.nextCursor === null) return rows;
    if (seenCursors.has(page.nextCursor)) {
      throw new Error("export pagination returned a repeated cursor");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

/** Keep project-scoped `IN (...)` lookups below driver/database bind limits. */
async function collectInChunks<T, R>(
  values: readonly T[],
  loadChunk: (chunk: readonly T[]) => Promise<readonly R[]>,
): Promise<R[]> {
  const rows: R[] = [];
  for (let index = 0; index < values.length; index += EXPORT_LOOKUP_CHUNK_SIZE) {
    const chunk = values.slice(index, index + EXPORT_LOOKUP_CHUNK_SIZE);
    rows.push(...(await loadChunk(chunk)));
  }
  return rows;
}

async function deleteUncommittedExport(
  ctx: WorkerContext,
  runId: string,
  key: string,
): Promise<void> {
  try {
    await ctx.blobStore.delete(key);
  } catch {
    // Do not expose an object key or storage exception: either may contain
    // customer identifiers. The transaction error remains the primary failure.
    ctx.logger.error("export_orphan_cleanup_failed", {
      runId,
      code: "STORAGE_DELETE_FAILED",
    });
  }
}

export async function runExport(
  ctx: WorkerContext,
  payload: ExportJobPayload,
): Promise<void> {
  const { runId, workspaceId, projectId } = payload;
  const scope: ProjectScope = { workspaceId, projectId };
  const runs = new AsyncRunsRepository(ctx.db);
  const claimed = await runs.claim(runId);
  if (!claimed) return;

  const bundlesRepo = new ExportBundlesRepository(ctx.db);
  const bundleRow = await bundlesRepo.findByRun(scope, runId);
  if (!bundleRow) {
    await runs.setTerminal(runId, {
      status: "failed",
      lastErrorCode: "NOT_FOUND",
      lastErrorSummary: "export bundle missing",
    });
    return;
  }
  const req = claimed.request_payload as unknown as ExportRequest;

  try {
    const input = await buildBundleInput(ctx, scope, bundleRow.id, req);
    const assembled = assembleBundle(input);

    // Upload to a final, non-overwritable key BEFORE the tx (spec §13.3). A fresh
    // random nonce per run makes every (re)generate land on a distinct key (AC-039).
    const key = mintExportObjectKey({ projectId, runId });
    const put = await ctx.blobStore.put({
      key,
      body: assembled.zip,
      contentType: "application/zip",
    });

    try {
      await ctx.db.transaction(async (tx) => {
        await new ExportBundlesRepository(tx).finalize(bundleRow.id, {
          objectKey: put.key,
          checksum: assembled.checksum,
          byteSize: put.bytes,
          itemCounts: assembled.itemCounts,
          manifest: assembled.manifest as unknown as Record<string, unknown>,
        });
        await new AsyncRunsRepository(tx).setTerminal(runId, {
          status: "completed",
          resultType: "export",
          resultId: bundleRow.id,
        });
        if (req.kind === "client_bundle") {
          await new ProjectsRepository(tx).setStage(
            { workspaceId },
            projectId,
            "delivered",
          );
        }
        await new TelemetryRepository(tx).emit({
          workspaceId,
          projectId,
          eventName: "export_ready",
          actorId: claimed.initiated_by,
          properties: {
            kind: req.kind,
            itemCounts: assembled.itemCounts,
            sizeBucket:
              put.bytes < 1_000_000
                ? "under_1mb"
                : put.bytes < 10_000_000
                  ? "under_10mb"
                  : "over_10mb",
          },
        });
      });
    } catch (error) {
      await deleteUncommittedExport(ctx, runId, put.key);
      throw error;
    }
    ctx.logger.info("export_done", { runId, kind: req.kind, bytes: put.bytes });
  } catch (error) {
    if (isTransientInfrastructureError(error)) {
      ctx.logger.warn("export_transient_error", {
        runId,
        code: transientFailureCode(error),
      });
      await runs.resetToQueued(runId);
      throw error;
    }
    ctx.logger.error("export_failed", {
      runId,
      ...runtimeFailureMetadata("UNAVAILABLE", error),
    });
    await runs.setTerminal(runId, {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "export failed",
    });
  }
}

async function buildBundleInput(
  ctx: WorkerContext,
  scope: ProjectScope,
  exportId: string,
  req: ExportRequest,
): Promise<BundleInput> {
  const project = await new ProjectsRepository(ctx.db).findById(
    { workspaceId: scope.workspaceId },
    scope.projectId,
  );
  if (!project) throw new Error("project missing");
  const icp = project.current_icp_profile_id
    ? await new IcpProfilesRepository(ctx.db).findById(
        scope,
        project.current_icp_profile_id,
      )
    : null;
  const sources = await new SourceConnectionsRepository(ctx.db).listByProject(
    scope,
  );
  const snapshotsRepo = new DataSnapshotsRepository(ctx.db);
  const snapshots = await collectAllPages((cursor) =>
    snapshotsRepo.listByProject(scope, {
      limit: SNAPSHOT_PAGE_SIZE,
      cursor,
    }),
  );
  const snapshotIds = snapshots.map((snapshot) => snapshot.id);
  const observationsRepo = new ObservationsRepository(ctx.db);
  const observations =
    req.kind === "service_bundle"
      ? await collectInChunks(snapshotIds, (ids) =>
          observationsRepo.listBySnapshotIds(scope, ids),
        )
      : [];
  const findingsRepo = new FindingsRepository(ctx.db);
  const findings = await collectAllPages((cursor) =>
    findingsRepo.list(scope, {
      limit: EXPORT_ENTITY_PAGE_SIZE,
      cursor,
      activeOnly: false,
    }),
  );
  const evidenceRepo = new EvidenceRepository(ctx.db);
  const links = await collectInChunks(
    findings.map((finding) => finding.id),
    (findingIds) => evidenceRepo.listForFindings(scope, findingIds),
  );
  const evidenceRows = await collectInChunks(
    [...new Set(links.map((link) => link.evidence_id))],
    (evidenceIds) => evidenceRepo.findByIds(scope, evidenceIds),
  );
  const actionsRepo = new ActionsRepository(ctx.db);
  const actions = await collectAllPages((cursor) =>
    actionsRepo.list(scope, {
      limit: EXPORT_ENTITY_PAGE_SIZE,
      cursor,
    }),
  );
  const artifactRepo = new ExecutionArtifactsRepository(ctx.db);
  const artifactRows = await collectAllPages((cursor) =>
    artifactRepo.listByProject(scope, {
      limit: EXPORT_ENTITY_PAGE_SIZE,
      cursor,
    }),
  );

  const artifacts = [];
  for (const a of artifactRows) {
    const revs = await artifactRepo.listRevisions(scope, a.id);
    artifacts.push({
      id: a.id,
      status: a.status,
      revisions: revs.map((r) => ({
        revision: r.revision,
        contentFormat: r.content_format,
        content:
          r.content_text !== null
            ? r.content_text
            : (r.content_json as unknown),
      })),
    });
  }

  // The DB rows are JSON at runtime; the assembler's strict JsonValue types are
  // satisfied structurally at the boundary via an explicit cast. `redact` also
  // strips any secret-named key nested in free-form content (AC-040 backstop).
  const input = {
    exportId,
    projectId: scope.projectId,
    kind: req.kind,
    generatedAt: new Date().toISOString(),
    outputLocale: req.outputLocale,
    sourceSnapshotIds: snapshotIds,
    project: {
      id: project.id,
      clientName: project.client_name,
      projectName: project.project_name,
      stage: project.stage,
      defaultDeliveryLocale: project.default_delivery_locale,
      createdAt: project.created_at,
    },
    context: icp
      ? { version: icp.version, status: icp.status, profile: icp.profile }
      : null,
    sources: sources.map((s) => ({
      id: s.id,
      provider: s.provider,
      connectionType: s.connection_type,
      state: s.state,
      limitation: s.limitation,
    })),
    snapshots: snapshots.map((s) => ({
      id: s.id,
      provider: s.provider,
      datasetKey: s.dataset_key,
      availability: s.availability,
      capturedAt: s.captured_at,
      rowCount: s.row_count,
      checksum: s.checksum,
    })),
    observations: observations.map((o) => ({
      snapshotId: o.snapshot_id,
      metricKey: o.metric_key,
      subjectRef: o.subject_ref,
      availability: o.availability,
      valueJson: o.value_json,
    })),
    findings: findings.map((f) => ({
      id: f.id,
      ruleId: f.rule_id,
      domain: f.domain,
      severity: f.severity,
      confidence: f.confidence,
      reviewState: f.review_state,
      summary: f.summary,
      subjectRefs: f.subject_refs,
    })),
    evidence: evidenceRows.map((e) => ({
      id: e.id,
      sourceProvider: e.source_provider,
      grade: e.grade,
      claim: e.claim,
      subjectRefs: e.subject_refs,
      observedAt: e.observed_at,
    })),
    actions: actions.map((a) => ({
      id: a.id,
      templateId: a.template_id,
      title: a.title,
      priorityBand: a.priority_band,
      roadmapLane: a.roadmap_lane,
      status: a.status,
    })),
    artifacts,
  };
  return redact(input) as unknown as BundleInput;
}
