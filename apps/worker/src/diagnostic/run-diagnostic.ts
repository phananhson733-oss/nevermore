import {
  AsyncRunsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  FindingsRepository,
  IcpProfilesRepository,
  ObservationsRepository,
  TelemetryRepository,
  type DiagnosticRunRow,
  type EvidenceInsert,
  type FindingObservationInsert,
  type ProjectScope,
} from "@sf/db";
import {
  ALL_RULES,
  DiagnosticContext,
  parseIcp,
  runPipeline,
  type CoverageInput,
  type DatasetAvailability,
  type ObservationView,
  type RunFinding,
} from "@sf/engine";
import type { WorkerContext } from "../context.ts";

/**
 * Diagnostic job runner (spec §8.2, §8.6). Loads the frozen manifest + its
 * snapshots' observations, builds the pure `DiagnosticContext`, runs the 11-rule
 * pipeline, then persists rule results + findings + evidence and resolves stale
 * findings — all in one transaction. Cross-run identity uses the pipeline's
 * `findingKey`; a re-hit preserves the human review state and flips `regressed`.
 */

export interface DiagnoseJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

interface ManifestSnapshot {
  readonly snapshotId: string;
  readonly provider: string;
  readonly availability: string;
  readonly capturedAt: string;
}

function readManifestSnapshots(
  manifest: Record<string, unknown>,
): ManifestSnapshot[] {
  const raw = manifest["snapshots"];
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => {
    const o = s as Record<string, unknown>;
    return {
      snapshotId: String(o["snapshotId"]),
      provider: String(o["provider"]),
      availability: String(o["availability"]),
      capturedAt: String(o["capturedAt"]),
    };
  });
}

function buildCoverage(snaps: readonly ManifestSnapshot[]): {
  coverage: CoverageInput;
  capturedAt: Record<string, string>;
} {
  const availFor = (provider: string): DatasetAvailability => {
    const s = snaps.find((x) => x.provider === provider);
    if (!s) return "unavailable";
    return s.availability === "available" || s.availability === "partial"
      ? (s.availability as DatasetAvailability)
      : "unavailable";
  };
  const capturedAt: Record<string, string> = {};
  for (const s of snaps) capturedAt[s.provider] = s.capturedAt;
  return {
    coverage: {
      crawl: availFor("crawl"),
      gsc: availFor("gsc"),
      ga4: availFor("ga4"),
      csv: availFor("csv"),
    },
    capturedAt,
  };
}

export async function runDiagnostic(
  ctx: WorkerContext,
  payload: DiagnoseJobPayload,
): Promise<void> {
  const { runId, workspaceId, projectId } = payload;
  const scope: ProjectScope = { workspaceId, projectId };
  const runs = new AsyncRunsRepository(ctx.db);

  const claimed = await runs.claim(runId);
  if (!claimed) return;

  const diagRun = await new DiagnosticRunsRepository(ctx.db).findById(
    scope,
    runId,
  );
  if (!diagRun) {
    await runs.setTerminal(runId, {
      status: "failed",
      lastErrorCode: "NOT_FOUND",
      lastErrorSummary: "diagnostic run missing",
    });
    return;
  }

  try {
    const result = await computeAndPersist(
      ctx,
      scope,
      diagRun,
      claimed.initiated_by,
    );
    ctx.logger.info("diagnostic_done", {
      runId,
      status: result.status,
      findingCount: result.findingCount,
    });
  } catch (error) {
    ctx.logger.error("diagnostic_failed", {
      runId,
      message: error instanceof Error ? error.message : "unknown",
    });
    await runs.setTerminal(runId, {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "diagnostic failed",
    });
  }
}

async function computeAndPersist(
  ctx: WorkerContext,
  scope: ProjectScope,
  diagRun: DiagnosticRunRow,
  actorId: string,
): Promise<{ status: "completed" | "partial"; findingCount: number }> {
  const manifestSnaps = readManifestSnapshots(diagRun.input_manifest);
  const snapshotIds = manifestSnaps.map((s) => s.snapshotId);

  const icpRow = await new IcpProfilesRepository(ctx.db).findById(
    scope,
    diagRun.icp_profile_id,
  );
  if (!icpRow) throw new Error("frozen ICP profile missing");
  const icp = parseIcp(icpRow.profile);

  const observationRows = await new ObservationsRepository(
    ctx.db,
  ).listBySnapshotIds(scope, snapshotIds);
  const observations: ObservationView[] = observationRows.map((o) => ({
    metricKey: o.metric_key,
    subjectType: o.subject_type,
    subjectRef: o.subject_ref,
    provider: o.provider,
    availability: o.availability,
    valueJson: o.value_json,
    observedAt: o.observed_at,
  }));

  const { coverage, capturedAt } = buildCoverage(manifestSnaps);
  const diagCtx = DiagnosticContext.build({
    icp,
    deliveryLocale: diagRun.output_locale,
    observations,
    coverage,
    capturedAt,
  });

  const pipeline = runPipeline({
    projectId: scope.projectId,
    ctx: diagCtx,
    rules: ALL_RULES,
    deliveryLocale: diagRun.output_locale,
  });

  const runStatus: "completed" | "partial" =
    pipeline.coverage.overall === "available" ? "completed" : "partial";
  const now = new Date().toISOString();

  await ctx.db.transaction(async (tx) => {
    // Rule results (append-only ledger).
    await new DiagnosticRunsRepository(tx).insertRuleResults(
      {
        diagnosticRunId: diagRun.id,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
      },
      pipeline.ruleResults.map((r) => ({
        ruleId: r.ruleId,
        ruleVersion: r.ruleVersion,
        domain: r.domain,
        status: r.status,
        reason: r.reason,
        metrics: r.metrics,
        durationMs: r.durationMs,
      })),
    );

    const findingsRepo = new FindingsRepository(tx);
    const evidenceRepo = new EvidenceRepository(tx);

    for (const finding of pipeline.findings) {
      const findingId = await upsertFinding(
        findingsRepo,
        scope,
        diagRun.id,
        finding,
        now,
      );
      await persistEvidence(
        evidenceRepo,
        scope,
        diagRun.id,
        findingId,
        finding,
      );
    }

    // Cross-run resolve: only a completed (non-partial) run resolves clean rules.
    if (runStatus === "completed") {
      const passedRuleIds = pipeline.ruleResults
        .filter((r) => r.status === "pass")
        .map((r) => r.ruleId);
      const keepKeys = pipeline.findings.map((f) => f.findingKey);
      await findingsRepo.resolveByKeysExcept(
        scope,
        passedRuleIds,
        keepKeys,
        now,
      );
    }

    await new DiagnosticRunsRepository(tx).setCoverage(
      diagRun.id,
      pipeline.coverage as unknown as Record<string, unknown>,
    );

    await new AsyncRunsRepository(tx).setTerminal(diagRun.id, {
      status: runStatus,
      resultType: "diagnostic_run",
      resultId: diagRun.id,
    });

    await new TelemetryRepository(tx).emit({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      eventName: "diagnostic_completed",
      actorId,
      properties: {
        status: runStatus,
        domainCoverage: pipeline.coverage.overall,
        findingCount: pipeline.findings.length,
        durationBucket: "under_10m",
      },
    });
  });

  return { status: runStatus, findingCount: pipeline.findings.length };
}

async function upsertFinding(
  repo: FindingsRepository,
  scope: ProjectScope,
  runId: string,
  finding: RunFinding,
  now: string,
): Promise<string> {
  // Preserve the subject-relevance flag for confirm-time priority (spec §9.3
  // step 4). It has no dedicated column, so it rides in title_args under a
  // reserved key the summary templates ignore.
  const titleArgs = {
    ...finding.titleArgs,
    __priorityRelevant: finding.priorityRelevant,
  };

  const existing = await repo.findByKey(scope, finding.findingKey);
  if (!existing) {
    const row = await repo.insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      findingKey: finding.findingKey,
      ruleId: finding.ruleId,
      ruleVersion: finding.ruleVersion,
      ruleFamily: finding.ruleFamily,
      intent: finding.intent,
      domain: finding.domain,
      titleKey: finding.titleKey,
      titleArgs,
      summary: finding.summary,
      summaryLocale: finding.summaryLocale,
      subjectRefs: [...finding.subjectRefs],
      severity: finding.severity,
      confidence: finding.confidence,
      reviewState: finding.reviewState,
      runId,
      seenAt: now,
    });
    return row.id;
  }
  // Re-hit: refresh + reactivate, preserve human review state; regressed if resolved.
  const regressed = existing.resolved_at !== null || existing.active === false;
  await repo.touchSeen(existing.id, {
    severity: finding.severity,
    confidence: finding.confidence,
    titleArgs,
    summary: finding.summary,
    summaryLocale: finding.summaryLocale,
    subjectRefs: [...finding.subjectRefs],
    runId,
    seenAt: now,
    regressed,
  });
  return existing.id;
}

async function persistEvidence(
  repo: EvidenceRepository,
  scope: ProjectScope,
  runId: string,
  findingId: string,
  finding: RunFinding,
): Promise<void> {
  const rows: EvidenceInsert[] = finding.evidence.map((e) => ({
    sourceProvider: e.sourceProvider,
    origin: e.origin,
    method: e.method,
    grade: e.grade,
    availability: e.availability,
    support: e.support,
    subjectRefs: [...e.subjectRefs],
    claim: e.claim,
    observedAt: e.observedAt,
    limitation: e.limitation,
  }));
  const evidenceIds = await repo.insertMany(
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      diagnosticRunId: runId,
    },
    rows,
  );
  const links: FindingObservationInsert[] = evidenceIds.map((evidenceId) => ({
    findingId,
    evidenceId,
    role: "support",
  }));
  await repo.linkObservations(
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      diagnosticRunId: runId,
    },
    links,
  );
}
