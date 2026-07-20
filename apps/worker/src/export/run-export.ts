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
  type DataSnapshotRow,
  type DbTx,
  type FindingRow,
  type ObservationRow,
  type ProjectScope,
} from "@sf/db";
import {
  assembleBundle,
  DEFAULT_BUNDLE_ASSEMBLY_LIMITS,
  type BundleArtifact,
  type BundleArtifactRevision,
  type BundleFindingEvidenceLink,
  ExportBundleLimitError,
  type BundleInput,
} from "@sf/artifacts";
import { mintExportObjectKey, type BlobPutResult } from "@sf/sources";
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
const OBSERVATION_PAGE_SIZE = 500;
const ARTIFACT_REVISION_PAGE_SIZE = 100;
const EXPORT_LOOKUP_CHUNK_SIZE = 100;
const EVIDENCE_PAGE_SIZE = 25;
// Input-only historical associations have their own raw-row safety cap. They
// are not archive items, but the overflow sentinel keeps dense role/run history
// from growing worker memory without bound before reachability deduplication.
const MAX_FINDING_EVIDENCE_LINK_ROWS = 100_000;

interface CursorPage<T, Cursor> {
  readonly rows: readonly T[];
  readonly nextCursor: Cursor | null;
}

type ExportSnapshot = {
  id: string;
  provider: string;
  datasetKey: string;
  availability: string;
  capturedAt: string;
  rowCount: number;
  checksum: string;
};
type ExportObservation = {
  snapshotId: string;
  metricKey: string;
  subjectRef: string;
  availability: string;
  valueJson: unknown;
};
type ExportFinding = {
  id: string;
  ruleId: string;
  domain: string;
  severity: string;
  confidence: string;
  reviewState: string;
  summary: string;
  subjectRefs: unknown[];
};
type ExportEvidence = {
  id: string;
  sourceProvider: string;
  grade: string;
  claim: string;
  subjectRefs: unknown[];
  observedAt: string;
};
type ExportAction = {
  id: string;
  templateId: string;
  title: string;
  priorityBand: string;
  roadmapLane: string;
  status: string;
};
type ExportArtifactMutable = BundleArtifact & {
  revisions: BundleArtifactRevision[];
};

class ExportReadBudget {
  private itemCount = 0;
  private estimatedBytes = 0;

  get remainingItems(): number {
    return Math.max(
      0,
      DEFAULT_BUNDLE_ASSEMBLY_LIMITS.maxItems - this.itemCount,
    );
  }

  /**
   * Reserve one extra row as an overflow sentinel. Even with no remaining
   * items, callers fetch at most one row to distinguish "complete" from
   * "over budget" without materializing an unbounded logical resource.
   */
  pageLimit(maxPageSize: number): number {
    return Math.min(maxPageSize, this.remainingItems + 1);
  }

  consumeJsonItem(value: unknown): void {
    this.consumeItem();
    this.consumeJson(value);
  }

  consumePrecomputedJsonItem(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error("export evidence byte estimate was invalid");
    }
    this.consumeItem();
    this.consumeBytes(bytes);
  }

  consumeJson(value: unknown): void {
    const encoded = JSON.stringify(value);
    this.consumeBytes(Buffer.byteLength(encoded ?? "null", "utf8") + 1);
  }

  /** Match the assembler's artifact shell estimate exactly. */
  consumeArtifact(id: string): void {
    this.consumeItem();
    this.consumeBytes(Buffer.byteLength(id, "utf8") + 64);
  }

  /** Match the assembler's per-revision estimate exactly. */
  consumeRevision(content: unknown): void {
    this.consumeItem();
    this.consumeBytes(64);
    if (typeof content === "string") {
      this.consumeBytes(Buffer.byteLength(content, "utf8"));
    } else {
      this.consumeJson(content);
    }
  }

  private consumeItem(): void {
    this.itemCount += 1;
    if (this.itemCount > DEFAULT_BUNDLE_ASSEMBLY_LIMITS.maxItems) {
      throw new ExportBundleLimitError();
    }
  }

  private consumeBytes(bytes: number): void {
    this.estimatedBytes += bytes;
    if (
      this.estimatedBytes >
      DEFAULT_BUNDLE_ASSEMBLY_LIMITS.maxEstimatedBytes
    ) {
      throw new ExportBundleLimitError();
    }
  }
}

/** Exhaust a trusted keyset paginator; reject a repeated cursor instead of hanging. */
async function collectAllPages<T, Cursor, Result>(
  loadPage: (
    cursor: Cursor | null,
    limit: number,
  ) => Promise<CursorPage<T, Cursor>>,
  budget: ExportReadBudget,
  pageSize: number,
  mapRow: (row: T) => Result,
  consumeRow: (row: Result) => void = (row) => budget.consumeJsonItem(row),
  nextLimit: () => number = () => budget.pageLimit(pageSize),
): Promise<Result[]> {
  const rows: Result[] = [];
  const seenCursors = new Set<Cursor>();
  let cursor: Cursor | null = null;

  for (;;) {
    const limit = nextLimit();
    const page = await loadPage(cursor, limit);
    if (page.rows.length > limit) {
      throw new Error("export pagination exceeded its requested page size");
    }
    for (const row of page.rows) {
      const mapped = mapRow(row);
      consumeRow(mapped);
      rows.push(mapped);
    }
    if (page.nextCursor === null) return rows;
    // A keyset paginator can only advance when it returned at least one row.
    // Reject a broken repository contract here so an ever-changing cursor with
    // empty pages cannot turn export assembly into an unbounded read loop.
    if (page.rows.length === 0) {
      throw new Error("export pagination advanced without rows");
    }
    if (seenCursors.has(page.nextCursor)) {
      throw new Error("export pagination returned a repeated cursor");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
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
  const claimed = await runs.claim(scope, runId);
  if (!claimed) return;
  const attempt = toRunAttempt(claimed);

  const bundlesRepo = new ExportBundlesRepository(ctx.db);
  const bundleRow = await bundlesRepo.findByRun(scope, runId);
  if (!bundleRow) {
    await runs.setTerminal(attempt, {
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

    // A fresh random nonce makes every (re)generate land on a distinct final,
    // non-overwritable key (AC-039). The key is known before Storage is touched,
    // so this writer and orphan cleanup can serialize on the same advisory lock.
    const key = mintExportObjectKey({ projectId, runId });
    let put: BlobPutResult | undefined;
    let transactionCallbackCompleted = false;
    try {
      const committedPut = await ctx.db.transaction(async (tx) => {
        // Storage is external to PostgreSQL, but orphan cleanup holds this same
        // transaction-scoped key lock across its final reference recheck and
        // DELETE. Holding it from upload through canonical commit prevents a
        // cleanup sweep from deleting bytes between upload and reference.
        await new StorageObjectReferencesRepository(
          tx,
        ).lockObjectKeysForTransaction([key]);
        put = await ctx.blobStore.put({
          key,
          body: assembled.zip,
          contentType: "application/zip",
        });
        const uploaded = put;

        const txRuns = new AsyncRunsRepository(tx);
        if (!(await txRuns.lockAttemptForUpdate(attempt))) {
          transactionCallbackCompleted = true;
          return null;
        }
        const projects = new ProjectsRepository(tx);
        const project = await projects.findByIdForUpdate(
          { workspaceId },
          projectId,
        );
        if (!project) {
          throw new Error("export project disappeared while terminalizing");
        }
        const projectionsMutable = project.archived_at === null;

        await new ExportBundlesRepository(tx).finalize(bundleRow.id, {
          objectKey: uploaded.key,
          checksum: assembled.checksum,
          byteSize: uploaded.bytes,
          itemCounts: assembled.itemCounts,
          manifest: assembled.manifest as unknown as Record<string, unknown>,
        });
        const terminalized = await txRuns.setTerminal(attempt, {
          status: "completed",
          resultType: "export",
          resultId: bundleRow.id,
        });
        if (!terminalized) {
          throw new Error("export attempt ownership changed while locked");
        }
        if (req.kind === "client_bundle" && projectionsMutable) {
          await projects.setStage(
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
              uploaded.bytes < 1_000_000
                ? "under_1mb"
                : uploaded.bytes < 10_000_000
                  ? "under_10mb"
                  : "over_10mb",
          },
        });
        // This callback has finished; Drizzle issues COMMIT next. If the driver
        // then reports a connection-class error, the canonical reference may
        // have committed and its bytes must remain for reconciliation/sweep.
        transactionCallbackCompleted = true;
        return uploaded;
      });
      if (committedPut === null) {
        // This stale attempt never installed its nonce-keyed object in the DB.
        if (put !== undefined) {
          await deleteUncommittedExport(ctx, runId, put.key);
        }
        return;
      }
      ctx.logger.info("export_done", {
        runId,
        kind: req.kind,
        bytes: committedPut.bytes,
      });
    } catch (error) {
      if (!transactionCallbackCompleted && put !== undefined) {
        await deleteUncommittedExport(ctx, runId, put.key);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ExportBundleLimitError) {
      const terminalized = await runs.setTerminal(attempt, {
        status: "failed",
        lastErrorCode: error.code,
        lastErrorSummary: error.message,
      });
      if (!terminalized) {
        ctx.logger.info("export_skip_stale_attempt", { code: error.code });
        return;
      }
      ctx.logger.error("export_failed", {
        code: error.code,
        type: "validation",
      });
      return;
    }
    if (isTransientInfrastructureError(error)) {
      const code = transientFailureCode(error);
      if (!(await runs.resetToQueued(attempt))) {
        ctx.logger.info("export_skip_stale_attempt", { code });
        return;
      }
      ctx.logger.warn("export_transient_error", { code });
      throw error;
    }
    const terminalized = await runs.setTerminal(attempt, {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "export failed",
    });
    if (!terminalized) {
      ctx.logger.info("export_skip_stale_attempt", { code: "UNAVAILABLE" });
      return;
    }
    ctx.logger.error(
      "export_failed",
      runtimeFailureMetadata("UNAVAILABLE", error),
    );
  }
}

async function buildBundleInput(
  ctx: WorkerContext,
  scope: ProjectScope,
  exportId: string,
  req: ExportRequest,
): Promise<BundleInput> {
  return ctx.db.transaction(
    (tx) => buildBundleInputFromSnapshot(tx, scope, exportId, req),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function buildBundleInputFromSnapshot(
  tx: DbTx,
  scope: ProjectScope,
  exportId: string,
  req: ExportRequest,
): Promise<BundleInput> {
  const budget = new ExportReadBudget();
  const projectRow = await new ProjectsRepository(tx).findById(
    { workspaceId: scope.workspaceId },
    scope.projectId,
  );
  if (!projectRow) throw new Error("project missing");
  const project = {
    id: projectRow.id,
    clientName: projectRow.client_name,
    projectName: projectRow.project_name,
    stage: projectRow.stage,
    defaultDeliveryLocale: projectRow.default_delivery_locale,
    createdAt: projectRow.created_at,
  };
  // bundleItemCount includes exactly one project item.
  budget.consumeJsonItem(project);

  const icpRow = projectRow.current_icp_profile_id
    ? await new IcpProfilesRepository(tx).findById(
        scope,
        projectRow.current_icp_profile_id,
      )
    : null;
  const context = icpRow
    ? { version: icpRow.version, status: icpRow.status, profile: icpRow.profile }
    : null;
  // Context JSON is always included in the byte estimate, while only a
  // non-null context contributes an item to bundleItemCount.
  if (context === null) budget.consumeJson(context);
  else budget.consumeJsonItem(context);

  const sourceRows = await new SourceConnectionsRepository(tx).listByProject(scope);
  const sources = sourceRows.map((source) => ({
    id: source.id,
    provider: source.provider,
    connectionType: source.connection_type,
    state: source.state,
    limitation: source.limitation,
  }));
  for (const source of sources) {
    budget.consumeJsonItem(source);
  }

  const snapshots = await collectAllPages<DataSnapshotRow, string, ExportSnapshot>(
    (cursor: string | null, limit) =>
      new DataSnapshotsRepository(tx).listByProject(scope, {
        limit,
        cursor,
      }),
    budget,
    SNAPSHOT_PAGE_SIZE,
    (snapshot) => ({
      id: snapshot.id,
      provider: snapshot.provider,
      datasetKey: snapshot.dataset_key,
      availability: snapshot.availability,
      capturedAt: snapshot.captured_at,
      rowCount: snapshot.row_count,
      checksum: snapshot.checksum,
    }),
  );
  const snapshotIds = snapshots.map((snapshot) => snapshot.id);

  const observationsRepo = new ObservationsRepository(tx);
  const observations =
    req.kind === "service_bundle"
      ? await (async () => {
          const rows: ExportObservation[] = [];
          for (
            let index = 0;
            index < snapshotIds.length;
            index += SNAPSHOT_PAGE_SIZE
          ) {
            rows.push(
              ...await collectAllPages<
                ObservationRow,
                string,
                ExportObservation
              >(
                (cursor: string | null, limit) =>
                  observationsRepo.listBySnapshotIdsPage(
                    scope,
                    snapshotIds.slice(index, index + SNAPSHOT_PAGE_SIZE),
                    {
                      limit,
                      cursor,
                    },
                  ),
                budget,
                OBSERVATION_PAGE_SIZE,
                (observation) => ({
                  snapshotId: observation.snapshot_id,
                  metricKey: observation.metric_key,
                  subjectRef: observation.subject_ref,
                  availability: observation.availability,
                  valueJson: observation.value_json,
                }),
              ),
            );
          }
          return rows;
        })()
      : [];

  const findings = await collectAllPages<FindingRow, string, ExportFinding>(
    (cursor: string | null, limit) =>
      new FindingsRepository(tx).list(scope, {
        limit,
        cursor,
        activeOnly: false,
        ...(req.kind === "client_bundle"
          ? { excludedReviewStates: ["ignored", "needs_more_data"] }
          : {}),
      }),
    budget,
    EXPORT_ENTITY_PAGE_SIZE,
    (finding) => ({
      id: finding.id,
      ruleId: finding.rule_id,
      domain: finding.domain,
      severity: finding.severity,
      confidence: finding.confidence,
      reviewState: finding.review_state,
      summary: finding.summary,
      subjectRefs: finding.subject_refs,
    }),
  );

  const evidenceRepo = new EvidenceRepository(tx);
  const representativeLinkByEvidenceId = new Map<
    string,
    BundleFindingEvidenceLink
  >();
  let rawFindingEvidenceLinkCount = 0;
  const findingIds = findings
    .map((finding) => finding.id)
    .sort();
  for (
    let index = 0;
    index < findingIds.length;
    index += EXPORT_LOOKUP_CHUNK_SIZE
  ) {
    const remainingLinkRows =
      MAX_FINDING_EVIDENCE_LINK_ROWS - rawFindingEvidenceLinkCount;
    const links = await evidenceRepo.listForFindings(
      scope,
      findingIds.slice(index, index + EXPORT_LOOKUP_CHUNK_SIZE),
      { maxRows: remainingLinkRows + 1 },
    );
    if (links.length > remainingLinkRows) {
      throw new ExportBundleLimitError();
    }
    rawFindingEvidenceLinkCount += links.length;
    for (const link of links) {
      if (!representativeLinkByEvidenceId.has(link.evidence_id)) {
        representativeLinkByEvidenceId.set(link.evidence_id, {
          findingId: link.finding_id,
          evidenceId: link.evidence_id,
        });
      }
    }
  }
  const findingEvidenceLinks = [...representativeLinkByEvidenceId.values()];
  findingEvidenceLinks.sort((left, right) => {
    if (left.findingId !== right.findingId) {
      return left.findingId < right.findingId ? -1 : 1;
    }
    if (left.evidenceId !== right.evidenceId) {
      return left.evidenceId < right.evidenceId ? -1 : 1;
    }
    return 0;
  });

  const uniqueEvidenceIds = [...representativeLinkByEvidenceId.keys()].sort();

  // Phase 1: preflight every evidence row using SQL-computed mapped-row JSON
  // bytes for the compact payload budget. This is a bounded payload-read check,
  // not a final ZIP-size estimate.
  // No claim/subject_refs body reaches the worker until the entire evidence set
  // is known to fit the remaining mapped item and byte budgets.
  for (
    let index = 0;
    index < uniqueEvidenceIds.length;
    index += EXPORT_LOOKUP_CHUNK_SIZE
  ) {
    const chunk = uniqueEvidenceIds.slice(
      index,
      index + EXPORT_LOOKUP_CHUNK_SIZE,
    );
    const preflightIds = await collectAllPages(
      (cursor: string | null, limit) =>
        evidenceRepo.listExportByteSizesByIdsPage(scope, chunk, {
          limit,
          cursor,
        }),
      budget,
      EVIDENCE_PAGE_SIZE,
      (row) => row,
      (row) => budget.consumePrecomputedJsonItem(row.estimated_bytes),
    );
    if (
      preflightIds.length !== chunk.length ||
      preflightIds.some((row, offset) => row.id !== chunk[offset])
    ) {
      throw new Error("export evidence preflight did not cover every linked row");
    }
  }

  // Phase 2: now that every body is budget-approved, materialize only exported
  // columns in the same sorted chunks and small id-keyset pages.
  const evidence: ExportEvidence[] = [];
  for (
    let index = 0;
    index < uniqueEvidenceIds.length;
    index += EXPORT_LOOKUP_CHUNK_SIZE
  ) {
    const chunk = uniqueEvidenceIds.slice(
      index,
      index + EXPORT_LOOKUP_CHUNK_SIZE,
    );
    const rows = await collectAllPages(
      (cursor: string | null, limit) =>
        evidenceRepo.listExportByIdsPage(scope, chunk, { limit, cursor }),
      budget,
      EVIDENCE_PAGE_SIZE,
      (row) => ({
        id: row.id,
        sourceProvider: row.source_provider,
        grade: row.grade,
        claim: row.claim,
        subjectRefs: row.subject_refs,
        observedAt: row.observed_at,
      }),
      () => {
        // Already charged during phase 1.
      },
      () => EVIDENCE_PAGE_SIZE,
    );
    if (
      rows.length !== chunk.length ||
      rows.some((row, offset) => row.id !== chunk[offset])
    ) {
      throw new Error("export evidence body did not match its preflight");
    }
    evidence.push(...rows);
  }

  const actions = await collectAllPages<ActionRow, string, ExportAction>(
    (cursor: string | null, limit) =>
      new ActionsRepository(tx).list(scope, {
        limit,
        cursor,
      }),
    budget,
    EXPORT_ENTITY_PAGE_SIZE,
    (action) => ({
      id: action.id,
      templateId: action.template_id,
      title: action.title,
      priorityBand: action.priority_band,
      roadmapLane: action.roadmap_lane,
      status: action.status,
    }),
  );

  const artifactRepo = new ExecutionArtifactsRepository(tx);
  const artifactRows = await collectAllPages<
    ArtifactRow,
    string,
    ExportArtifactMutable
  >(
    (cursor: string | null, limit) =>
      artifactRepo.listByProject(scope, {
        limit,
        cursor,
        ...(req.kind === "client_bundle" ? { status: "ready" } : {}),
      }),
    budget,
    EXPORT_ENTITY_PAGE_SIZE,
    (artifact) => ({
      id: artifact.id,
      status: artifact.status,
      currentRevision: artifact.current_revision,
      revisions: [],
    }),
    (artifact) => budget.consumeArtifact(artifact.id),
  );

  for (const artifact of artifactRows) {
    if (req.kind === "client_bundle") {
      const revision = await artifactRepo.findRevision(
        scope,
        artifact.id,
        artifact.currentRevision,
      );
      if (!revision) {
        throw new Error(
          "client bundle ready artifact current revision is unavailable",
        );
      }
      const mappedRevision: BundleArtifactRevision = {
        revision: revision.revision,
        contentFormat:
          revision.content_format as BundleArtifactRevision["contentFormat"],
        content:
          revision.content_text !== null
            ? revision.content_text
            : (revision.content_json as BundleArtifactRevision["content"]),
      };
      budget.consumeRevision(mappedRevision.content);
      artifact.revisions = [mappedRevision];
    } else {
      artifact.revisions = await collectAllPages<
        ArtifactRevisionRow,
        number,
        BundleArtifactRevision
      >(
        (cursor: number | null, limit) =>
          artifactRepo.listRevisionsPage(scope, artifact.id, {
            limit,
            cursor,
          }),
        budget,
        ARTIFACT_REVISION_PAGE_SIZE,
        (revision) => ({
          revision: revision.revision,
          contentFormat:
            revision.content_format as BundleArtifactRevision["contentFormat"],
          content:
            revision.content_text !== null
              ? revision.content_text
              : (revision.content_json as BundleArtifactRevision["content"]),
        }),
        (revision) => budget.consumeRevision(revision.content),
      );
    }
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
    project,
    context,
    sources,
    snapshots,
    observations,
    findings,
    findingEvidenceLinks,
    evidence,
    actions,
    artifacts: artifactRows,
  };
  return redact(input) as unknown as BundleInput;
}
