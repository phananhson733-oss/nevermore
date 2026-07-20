import {
  ActionsRepository,
  AnalysisInvocationsRepository,
  AsyncRunsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  FindingsRepository,
  IcpProfilesRepository,
  ObservationsRepository,
  ProjectsRepository,
  ProviderDiscrepanciesRepository,
  TelemetryRepository,
  toRunAttempt,
  type DiagnosticRunRow,
  type EvidenceInsert,
  type FindingObservationInsert,
  type ProjectScope,
  type RunAttempt,
} from "@sf/db";
import {
  LLMError,
  createOpenAIFindingSummaryClient,
  type AnalysisInvocationRecord,
  type FindingSummaryClient,
  type FindingSummaryClientOptions,
} from "@sf/artifacts";
import {
  ALL_RULES,
  DiagnosticContext,
  parseIcp,
  runPipeline,
  type CoverageInput,
  type DatasetAvailability,
  type FindingSummaryGenerator,
  type ObservationView,
  type RunFinding,
} from "@sf/engine";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../context.ts";
import {
  isTransientInfrastructureError,
  transientFailureCode,
} from "../handlers/transient-errors.ts";
import { runtimeFailureMetadata } from "../runtime-failure.ts";

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

export interface FindingSummaryGeneratorDependencies {
  readonly createClient?: (
    options: FindingSummaryClientOptions,
  ) => FindingSummaryClient;
}

export const MAX_FINDING_SUMMARY_INVOCATIONS_PER_RUN = 8;
export const FINDING_SUMMARY_REQUEST_TIMEOUT_MS = 30_000;

export type FindingSummaryGeneratorStage = FindingSummaryGenerator & {
  /** Throws after the pipeline when invocation accounting is not trustworthy. */
  assertHealthy(): void;
};

const INVOCATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function needsGeneratedSummary(locale: string): boolean {
  const normalized = locale.toLowerCase();
  return (
    normalized !== "en" &&
    !normalized.startsWith("en-") &&
    normalized !== "zh-cn"
  );
}

async function persistFindingSummaryInvocation(
  ctx: WorkerContext,
  scope: ProjectScope,
  runId: string,
  invocation: AnalysisInvocationRecord,
): Promise<string | null> {
  try {
    const invocationId = await new AnalysisInvocationsRepository(ctx.db).insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      asyncRunId: runId,
      task: "finding_summary",
      provider: invocation.provider,
      model: invocation.model,
      promptSetVersion: invocation.promptSetVersion,
      inputHash: invocation.inputHash,
      outputHash: invocation.outputHash,
      status: invocation.status,
      inputTokens: invocation.inputTokens,
      outputTokens: invocation.outputTokens,
      costUsd: invocation.costUsd,
      latencyMs: invocation.latencyMs,
      errorCode: invocation.errorCode,
    });
    if (!INVOCATION_UUID_RE.test(invocationId)) return null;
    try {
      ctx.logger.info("finding_summary_invocation_recorded", {
        task: "finding_summary",
        status: invocation.status,
      });
    } catch {
      // Observability cannot turn an optional localized summary into a run error.
    }
    return invocationId;
  } catch (error) {
    // Do not expose DB/provider detail, but do preserve the error for the run-level
    // health latch: a real model call without its immutable audit row must prevent
    // the diagnostic from reaching completed.
    try {
      ctx.logger.warn("finding_summary_invocation_persist_failed", {
        task: "finding_summary",
        status: invocation.status,
      });
    } catch {
      // A failing log sink cannot replace the original infrastructure failure.
    }
    throw error;
  }
}

/**
 * Worker-owned adapter between the engine hook and the model client. A real
 * invocation id is returned only after its immutable row exists. Model failures
 * return null so the engine selects the honestly labelled English fallback;
 * invocation count/persistence failures additionally trip the run-level health
 * latch so the engine's optional-summary fallback cannot complete the run.
 */
export function createFindingSummaryGenerator(
  ctx: WorkerContext,
  scope: ProjectScope,
  runId: string,
  dependencies: FindingSummaryGeneratorDependencies = {},
): FindingSummaryGeneratorStage {
  const createClient =
    dependencies.createClient ?? createOpenAIFindingSummaryClient;
  let client: FindingSummaryClient | null = null;
  let clientCreationFailed = false;
  let attemptedInvocations = 0;
  let persistedInvocationCount: Promise<number> | null = null;
  let healthFailed = false;
  let fatalHealthError: unknown;

  const generator: FindingSummaryGeneratorStage = Object.assign(async (
    input: Parameters<FindingSummaryGenerator>[0],
  ) => {
    if (ctx.signal?.aborted) return null;
    if (healthFailed) return null;
    if (clientCreationFailed) return null;
    if (!needsGeneratedSummary(input.outputLocale)) return null;

    persistedInvocationCount ??= new AnalysisInvocationsRepository(
      ctx.db,
    ).countByAsyncRunTask(scope, runId, "finding_summary");
    let historicalInvocations: number;
    try {
      historicalInvocations = await persistedInvocationCount;
    } catch (error) {
      healthFailed = true;
      fatalHealthError = error;
      try {
        ctx.logger.warn("finding_summary_invocation_count_failed", {
          task: "finding_summary",
        });
      } catch {
        // Optional summaries fail closed even if logging is unavailable.
      }
      return null;
    }

    if (ctx.signal?.aborted) return null;
    if (
      historicalInvocations + attemptedInvocations >=
      MAX_FINDING_SUMMARY_INVOCATIONS_PER_RUN
    ) {
      return null;
    }

    if (client === null) {
      try {
        client = createClient({
          apiKey: ctx.openai.apiKey,
          model: ctx.openai.model,
          ...(ctx.openai.baseUrl ? { baseUrl: ctx.openai.baseUrl } : {}),
          ...(ctx.openai.authScheme
            ? { authScheme: ctx.openai.authScheme }
            : {}),
          timeoutMs: FINDING_SUMMARY_REQUEST_TIMEOUT_MS,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
      } catch {
        clientCreationFailed = true;
        return null;
      }
    }

    if (ctx.signal?.aborted) return null;
    attemptedInvocations += 1;
    let result: Awaited<ReturnType<FindingSummaryClient["generateSummary"]>>;
    try {
      result = await client.generateSummary(input);
    } catch (error) {
      if (error instanceof LLMError && error.invocation) {
        try {
          await persistFindingSummaryInvocation(
            ctx,
            scope,
            runId,
            error.invocation,
          );
        } catch (persistenceError) {
          healthFailed = true;
          fatalHealthError = persistenceError;
        }
      }
      return null;
    }

    let invocationId: string | null;
    try {
      invocationId = await persistFindingSummaryInvocation(
        ctx,
        scope,
        runId,
        result.invocation,
      );
    } catch (error) {
      healthFailed = true;
      fatalHealthError = error;
      return null;
    }
    if (invocationId === null) return null;
    return {
      summary: result.summary,
      summaryLocale: result.summaryLocale,
      invocationId,
    };
  }, {
    assertHealthy(): void {
      if (healthFailed) throw fatalHealthError;
    },
  });

  return generator;
}

export function createFindingSummaryGeneratorForRun(
  ctx: WorkerContext,
  scope: ProjectScope,
  runId: string,
  dependencies: FindingSummaryGeneratorDependencies = {},
): FindingSummaryGeneratorStage | undefined {
  if (!ctx.findingSummariesEnabled) return undefined;
  return createFindingSummaryGenerator(ctx, scope, runId, dependencies);
}

export function warnOnSlowRules(
  logger: Logger,
  runId: string,
  ruleResults: readonly {
    readonly ruleId: string;
    readonly durationMs: number;
  }[],
): void {
  for (const rule of ruleResults) {
    if (rule.durationMs > 250) {
      logger.warn("diagnostic_rule_slow", {
        runId,
        ruleId: rule.ruleId,
        durationMs: rule.durationMs,
      });
    }
  }
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
  const keywordGapAvailability = (): DatasetAvailability => {
    const sources = [availFor("csv"), availFor("dataforseo")];
    if (sources.includes("available")) return "available";
    if (sources.includes("partial")) return "partial";
    return "unavailable";
  };
  return {
    coverage: {
      crawl: availFor("crawl"),
      gsc: availFor("gsc"),
      ga4: availFor("ga4"),
      // The frozen `csv` coverage key is the canonical keyword-gap dataset slot.
      // It may now be supplied by either an operator CSV or DataForSEO.
      csv: keywordGapAvailability(),
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

  const claimed = await runs.claim(scope, runId);
  if (!claimed) return;
  const attempt = toRunAttempt(claimed);

  const diagRun = await new DiagnosticRunsRepository(ctx.db).findById(
    scope,
    runId,
  );
  if (!diagRun) {
    await runs.setTerminal(attempt, {
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
      attempt,
    );
    if (result === null) return;
    ctx.logger.info("diagnostic_done", {
      runId,
      status: result.status,
      findingCount: result.findingCount,
    });
  } catch (error) {
    if (isTransientInfrastructureError(error)) {
      const code = transientFailureCode(error);
      if (!(await runs.resetToQueued(attempt))) {
        ctx.logger.info("diagnostic_skip_stale_attempt", { code });
        return;
      }
      ctx.logger.warn("diagnostic_transient_error", { code });
      throw error;
    }
    const terminalized = await runs.setTerminal(attempt, {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "diagnostic failed",
    });
    if (!terminalized) {
      ctx.logger.info("diagnostic_skip_stale_attempt", {
        code: "UNAVAILABLE",
      });
      return;
    }
    ctx.logger.error(
      "diagnostic_failed",
      runtimeFailureMetadata("UNAVAILABLE", error),
    );
  }
}

async function computeAndPersist(
  ctx: WorkerContext,
  scope: ProjectScope,
  diagRun: DiagnosticRunRow,
  actorId: string,
  attempt: RunAttempt,
): Promise<{ status: "completed" | "partial"; findingCount: number } | null> {
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
  const discrepancyRows = await new ProviderDiscrepanciesRepository(
    ctx.db,
  ).listUnresolvedBySnapshotIds(scope, snapshotIds);
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

  const summaryGenerator = createFindingSummaryGeneratorForRun(
    ctx,
    scope,
    diagRun.id,
  );
  const pipeline = await runPipeline({
    projectId: scope.projectId,
    ctx: diagCtx,
    rules: ALL_RULES,
    deliveryLocale: diagRun.output_locale,
    discrepancySubjectRefs: [
      ...new Set(discrepancyRows.map((row) => row.subject_ref)),
    ],
    ...(summaryGenerator ? { summaryGenerator } : {}),
  });
  // The engine deliberately contains optional generator failures. Invocation
  // persistence is different: losing an immutable audit row is fatal and must
  // be surfaced before the canonical persistence transaction can complete.
  summaryGenerator?.assertHealthy();
  warnOnSlowRules(ctx.logger, diagRun.id, pipeline.ruleResults);

  // A run is `completed` (and may therefore auto-resolve stale findings, §8.6)
  // ONLY when every rule actually ran to pass/candidate — a single skipped
  // (missing dataset) or inconclusive rule makes the whole run `partial`, which
  // must NOT resolve anything.
  const allRulesRan = pipeline.ruleResults.every(
    (r) => r.status === "pass" || r.status === "candidate",
  );
  const runStatus: "completed" | "partial" = allRulesRan
    ? "completed"
    : "partial";
  const now = new Date().toISOString();

  const persisted = await ctx.db.transaction(async (tx) => {
    const asyncRunsRepo = new AsyncRunsRepository(tx);
    if (!(await asyncRunsRepo.lockAttemptForUpdate(attempt))) return false;
    // Match web mutation order after fencing the accepted attempt: project
    // before finding/action children. Archival freezes only the project stage;
    // diagnostic history, findings/evidence, and run terminalization converge.
    const projects = new ProjectsRepository(tx);
    const project = await projects.findByIdForUpdate(
      { workspaceId: scope.workspaceId },
      scope.projectId,
    );
    if (!project) {
      throw new Error("diagnostic project disappeared while terminalizing");
    }
    const projectionsMutable = project.archived_at === null;

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
    const actionsRepo = new ActionsRepository(tx);

    for (const finding of pipeline.findings) {
      const { id: findingId, isRehit } = await upsertFinding(
        findingsRepo,
        scope,
        diagRun.id,
        finding,
        now,
      );
      const evidenceIds = await persistEvidence(
        evidenceRepo,
        scope,
        diagRun.id,
        findingId,
        finding,
      );
      // §9.2: a cross-run re-hit merges the new evidence into an existing,
      // non-dismissed Action without touching human priority/status.
      if (isRehit && evidenceIds.length > 0) {
        const action = await actionsRepo.findActiveByFinding(scope, findingId);
        if (action) {
          const merged = [
            ...new Set([...(action.evidence_refs as string[]), ...evidenceIds]),
          ];
          await actionsRepo.mergeEvidenceRefs(action.id, merged);
        }
      }
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

    const terminalized = await asyncRunsRepo.setTerminal(attempt, {
      status: runStatus,
      resultType: "diagnostic_run",
      resultId: diagRun.id,
    });
    if (!terminalized) {
      throw new Error("diagnostic attempt ownership changed while locked");
    }
    if (projectionsMutable) {
      await projects.setStage(
        { workspaceId: scope.workspaceId },
        scope.projectId,
        "planning",
      );
    }

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
    return true;
  });

  if (!persisted) return null;

  return { status: runStatus, findingCount: pipeline.findings.length };
}

async function upsertFinding(
  repo: FindingsRepository,
  scope: ProjectScope,
  runId: string,
  finding: RunFinding,
  now: string,
): Promise<{ id: string; isRehit: boolean }> {
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
      summaryInvocationId: finding.summaryInvocationId,
      subjectRefs: [...finding.subjectRefs],
      severity: finding.severity,
      confidence: finding.confidence,
      reviewState: finding.reviewState,
      runId,
      seenAt: now,
    });
    return { id: row.id, isRehit: false };
  }
  // Re-hit: refresh + reactivate, preserve human review state; regressed if resolved.
  const regressed = existing.resolved_at !== null || existing.active === false;
  await repo.touchSeen(existing.id, {
    severity: finding.severity,
    confidence: finding.confidence,
    titleArgs,
    summary: finding.summary,
    summaryLocale: finding.summaryLocale,
    summaryInvocationId: finding.summaryInvocationId,
    subjectRefs: [...finding.subjectRefs],
    runId,
    seenAt: now,
    regressed,
  });
  return { id: existing.id, isRehit: true };
}

/** Map an evidence support direction to a finding_observations.role (schema CHECK). */
function evidenceRole(support: string | undefined, index: number): string {
  if (support === "contradicts") return "contradicting";
  if (support === "context") return "context";
  return index === 0 ? "primary" : "supporting";
}

async function persistEvidence(
  repo: EvidenceRepository,
  scope: ProjectScope,
  runId: string,
  findingId: string,
  finding: RunFinding,
): Promise<string[]> {
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
  const links: FindingObservationInsert[] = evidenceIds.map(
    (evidenceId, i) => ({
      findingId,
      evidenceId,
      role: evidenceRole(finding.evidence[i]?.support, i),
    }),
  );
  await repo.linkObservations(
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      diagnosticRunId: runId,
    },
    links,
  );
  return evidenceIds;
}
