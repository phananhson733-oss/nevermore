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
import { objectKey } from "@sf/sources";
import { randomBytes } from "node:crypto";
import type { WorkerContext } from "../context.ts";

/**
 * Export job (spec §10.5, §13.3). Loads canonical objects, applies field-level
 * redaction (never SourceCredential / OAuthIntent / import tokens / idempotency /
 * logs / notes / provider usage / AnalysisInvocation), assembles the ZIP + manifest
 * via the pure assembler, uploads it to a final key, then finalizes the bundle row
 * and the run in one transaction.
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

    // Upload to a final, non-overwritable key BEFORE the tx (spec §13.3).
    const nonce = randomBytes(12).toString("hex");
    const key = objectKey({ projectId, runId, kind: "export", nonce });
    const put = await ctx.blobStore.put({
      key,
      body: assembled.zip,
      contentType: "application/zip",
    });

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
    ctx.logger.info("export_done", { runId, kind: req.kind, bytes: put.bytes });
  } catch (error) {
    ctx.logger.error("export_failed", {
      runId,
      message: error instanceof Error ? error.message : "unknown",
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
  const snapshotPage = await new DataSnapshotsRepository(ctx.db).listByProject(
    scope,
    { limit: 100, cursor: null },
  );
  const snapshotIds = snapshotPage.rows.map((s) => s.id);
  const observations =
    req.kind === "service_bundle"
      ? await new ObservationsRepository(ctx.db).listBySnapshotIds(
          scope,
          snapshotIds,
        )
      : [];
  const findingPage = await new FindingsRepository(ctx.db).list(scope, {
    limit: 500,
    cursor: null,
    activeOnly: false,
  });
  const evidenceRepo = new EvidenceRepository(ctx.db);
  const links = await evidenceRepo.listForFindings(
    scope,
    findingPage.rows.map((f) => f.id),
  );
  const evidenceRows = await evidenceRepo.findByIds(scope, [
    ...new Set(links.map((l) => l.evidence_id)),
  ]);
  const actionPage = await new ActionsRepository(ctx.db).list(scope, {
    limit: 500,
    cursor: null,
  });
  const artifactRepo = new ExecutionArtifactsRepository(ctx.db);
  const artifactPage = await artifactRepo.listByProject(scope, {
    limit: 500,
    cursor: null,
  });

  const artifacts = [];
  for (const a of artifactPage.rows) {
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
  // satisfied structurally at the boundary via an explicit cast.
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
    snapshots: snapshotPage.rows.map((s) => ({
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
    findings: findingPage.rows.map((f) => ({
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
    actions: actionPage.rows.map((a) => ({
      id: a.id,
      templateId: a.template_id,
      title: a.title,
      priorityBand: a.priority_band,
      roadmapLane: a.roadmap_lane,
      status: a.status,
    })),
    artifacts,
  };
  return input as unknown as BundleInput;
}
