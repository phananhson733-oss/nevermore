import {
  AnalysisRefreshRunsRepository,
  AsyncRunsRepository,
  DiagnosticRunsRepository,
  ExecutionArtifactsRepository,
  IdempotencyRepository,
  OAuthIntentsRepository,
  ProjectsRepository,
  SourceConnectionsRepository,
  type AsyncRunRow,
  type JobWithMetadata,
  type ProjectScope,
  type QueueName,
} from "@sf/db";
import { CONTRACT_VERSION } from "@sf/contracts";
import { withRunContext, type WorkerContext } from "../context.ts";
import {
  DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED,
  DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED_SUMMARY,
  supportsDiagnosticExecutorVersion,
} from "../diagnostic/executor-version.ts";

export const RUN_RECOVERY_INTERVAL_MS = 60_000;
export const RUN_RECOVERY_MISSING_AFTER_MS = 60 * 60 * 1_000;
export const RUN_RECOVERY_BATCH_SIZE = 100;
export const RUN_RECOVERY_SWEEP_TIMEOUT_MS = 55_000;
export const RUN_RECOVERY_STOP_TIMEOUT_MS = 5_000;

interface CanonicalJobPayload {
  readonly runId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  /** Runtime input may come from an older or malformed queue producer. */
  readonly contractVersion?: unknown;
}

interface ReconcileOptions {
  readonly scope?: ProjectScope;
  readonly now?: Date;
  readonly missingAfterMs?: number;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface RecoveryLoopOptions {
  readonly intervalMs?: number;
  readonly missingAfterMs?: number;
  readonly sweepTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly reconcile?: (signal: AbortSignal) => Promise<void>;
}

export interface RunRecoveryLoop {
  runNow(): Promise<void>;
  stop(): Promise<void>;
}

type RecoveryOperationResult<T> =
  | { readonly status: "completed"; readonly value: T }
  | { readonly status: "failed"; readonly error: unknown }
  | { readonly status: "aborted" };

interface ObservedRecoveryOperation<T> {
  readonly result: Promise<RecoveryOperationResult<T>>;
  /** Settles only when the underlying driver operation itself settles. */
  readonly settlement: Promise<void>;
}

class RunRecoveryExecutionError extends Error {
  readonly code = "RUN_RECOVERY_ABORTED";

  constructor() {
    super("run recovery sweep aborted");
    this.name = "RunRecoveryExecutionError";
  }
}

/** Total, nominal check used at the bootstrap boundary to classify cancellation. */
export function isRunRecoveryAbortError(error: unknown): boolean {
  try {
    return (
      error instanceof RunRecoveryExecutionError &&
      error.code === "RUN_RECOVERY_ABORTED"
    );
  } catch {
    return false;
  }
}

const COLLECTION_QUEUE_BY_PROVIDER: Readonly<Record<string, QueueName>> = {
  crawl: "collect.crawl",
  gsc: "collect.gsc",
  ga4: "collect.ga4",
  csv: "collect.csv",
  dataforseo: "collect.dataforseo",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_CONTRACT_VERSION = "0.2.0";
const PUBLICATION_CONTRACT_VERSION = "publication.0.4.0";
const MEASUREMENT_CONTRACT_VERSION = "measurement.0.1.0";
const QUEUE_RETRY_EXHAUSTED = "QUEUE_RETRY_EXHAUSTED";
const QUEUE_RETRY_EXHAUSTED_SUMMARY =
  "Queue retries exhausted before the run completed.";
const QUEUE_JOB_FAILED_SUMMARY =
  "The queue job failed before the run completed.";
const STABLE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const SENSITIVE_ERROR_SUMMARY_PATTERN =
  /(?:api[_ -]?key|authorization|bearer|client[_ -]?secret|password|passwd|private[_ -]?key|refresh[_ -]?token|access[_ -]?token)\s*[:=]|\b(?:sk|pk)-[A-Za-z0-9_-]{12,}/i;
const MAX_SAFE_ERROR_SUMMARY_LENGTH = 512;
// Preserve only exact, server-authored retry messages. A suffix match would let
// provider/customer-controlled text masquerade as a safe canonical summary.
const SAFE_RETRY_SUMMARIES = new Set<string>([
  "Product Profile synthesis will be retried.",
  "Collection was interrupted by worker shutdown; automatic retry is scheduled.",
  "Provider rate limit reached; automatic retry is scheduled.",
  "Provider request timed out; automatic retry is scheduled.",
  "Provider is temporarily unavailable; automatic retry is scheduled.",
  "Provider network request failed; automatic retry is scheduled.",
  "Storage network request failed; automatic retry is scheduled.",
  "Storage request timed out; automatic retry is scheduled.",
  "Storage rate limit reached; automatic retry is scheduled.",
  "Storage is temporarily unavailable; automatic retry is scheduled.",
  "Database or runtime infrastructure is temporarily unavailable; automatic retry is scheduled.",
]);

type JobContractFailure = {
  readonly code: "UNSUPPORTED_JOB_CONTRACT" | "JOB_CONTRACT_MISMATCH";
  readonly summary: string;
};

interface CanonicalJobLookup {
  readonly jobs: JobWithMetadata<CanonicalJobPayload>[];
  readonly contractFailure: JobContractFailure | null;
}

interface RetryExhaustionFailure {
  readonly lastErrorCode: string;
  readonly lastErrorSummary: string;
  readonly preservedRootCause: boolean;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function terminalFailureWithCanonicalCause(
  run: Pick<AsyncRunRow, "last_error_code" | "last_error_summary">,
  fallbackCode: string,
  fallbackSummary: string,
): RetryExhaustionFailure {
  const code = run.last_error_code;
  const summary = run.last_error_summary;
  const hasSafeCanonicalCause =
    typeof code === "string" &&
    STABLE_ERROR_CODE_PATTERN.test(code) &&
    code !== QUEUE_RETRY_EXHAUSTED &&
    typeof summary === "string" &&
    summary.length > 0 &&
    summary.length <= MAX_SAFE_ERROR_SUMMARY_LENGTH &&
    summary === summary.trim() &&
    !hasControlCharacters(summary) &&
    !SENSITIVE_ERROR_SUMMARY_PATTERN.test(summary) &&
    SAFE_RETRY_SUMMARIES.has(summary);

  if (hasSafeCanonicalCause) {
    return {
      lastErrorCode: code,
      lastErrorSummary: `${summary} ${fallbackSummary}`,
      preservedRootCause: true,
    };
  }

  return {
    lastErrorCode: fallbackCode,
    lastErrorSummary: fallbackSummary,
    preservedRootCause: false,
  };
}

function retryExhaustionFailure(
  run: Pick<AsyncRunRow, "last_error_code" | "last_error_summary">,
): RetryExhaustionFailure {
  return terminalFailureWithCanonicalCause(
    run,
    QUEUE_RETRY_EXHAUSTED,
    QUEUE_RETRY_EXHAUSTED_SUMMARY,
  );
}

function collectionQueueForProvider(provider: unknown): QueueName | null {
  if (
    typeof provider !== "string" ||
    !Object.hasOwn(COLLECTION_QUEUE_BY_PROVIDER, provider)
  ) {
    return null;
  }
  return COLLECTION_QUEUE_BY_PROVIDER[provider] ?? null;
}

/** Map a canonical run to the one public pg-boss queue that may own it. */
export function queueForRun(
  run: Pick<AsyncRunRow, "kind" | "request_payload">,
): QueueName | null {
  switch (run.kind) {
    case "collection": {
      return collectionQueueForProvider(run.request_payload["provider"]);
    }
    case "diagnostic":
      return "diagnose";
    case "product_profile_synthesis":
      return "profile.synthesize";
    case "artifact_generation":
      return "artifact.generate";
    case "export":
      return "export.bundle";
    case "content_shadow":
      return "content-shadow";
    case "publication":
      return "publication";
    case "measurement":
      return "measurement";
    case "analysis_refresh":
      return "refresh.analysis";
    default:
      return null;
  }
}

/**
 * Gate a pg-boss delivery against the canonical ledger before invoking a
 * runner. Delivery metadata is part of the safety condition: only a genuine
 * later retry may recover a canonical row left running by a crashed process.
 */
export async function prepareRunDelivery<T extends CanonicalJobPayload>(
  ctx: WorkerContext,
  job: JobWithMetadata<T>,
  execute: (payload: T, runCtx: WorkerContext) => Promise<void>,
): Promise<void> {
  const runCtx = withRunContext(ctx, job.data);
  const scope = scopeFromPayload(job.data);
  const runs = new AsyncRunsRepository(runCtx.db);
  const prepared = await runs.prepareDelivery(
    scope,
    job.data.runId,
    job.retryCount,
  );

  if (!prepared) {
    runCtx.logger.warn("run_delivery_skipped", {
      code: "CANONICAL_RUN_NOT_DELIVERABLE",
      runId: job.data.runId,
      retryCount: job.retryCount,
    });
    return;
  }

  const contractFailure = validateJobContract(
    job.data.contractVersion,
    prepared.contract_version,
    prepared.kind,
  );
  if (contractFailure) {
    let reconciled = false;
    try {
      reconciled = await reconcileCanonicalAndProjection(
        runCtx,
        prepared,
        scope,
        {
          status: "failed",
          lastErrorCode: contractFailure.code,
          lastErrorSummary: contractFailure.summary,
        },
      );
    } catch {
      // Ack this invalid delivery instead of retrying untrusted work. Recovery
      // retains the scoped invalid candidate and immediately retries the same
      // stable terminal outcome if this transaction failed.
      runCtx.logger.error("run_delivery_reconciliation_failed", {
        code: contractFailure.code,
        runId: job.data.runId,
      });
      return;
    }
    runCtx.logger.warn(
      reconciled ? "run_delivery_reconciled" : "run_delivery_skipped",
      {
        code: contractFailure.code,
        runId: job.data.runId,
      },
    );
    return;
  }

  if (await hasUnsupportedDiagnosticExecutor(runCtx, prepared, scope)) {
    let reconciled = false;
    try {
      reconciled = await reconcileCanonicalAndProjection(
        runCtx,
        prepared,
        scope,
        {
          status: "failed",
          lastErrorCode: DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED,
          lastErrorSummary: DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED_SUMMARY,
        },
      );
    } catch {
      runCtx.logger.error("run_delivery_reconciliation_failed", {
        code: DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED,
        runId: job.data.runId,
      });
      return;
    }
    runCtx.logger.warn(
      reconciled ? "run_delivery_reconciled" : "run_delivery_skipped",
      {
        code: DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED,
        runId: job.data.runId,
      },
    );
    return;
  }

  try {
    await execute(job.data, runCtx);
  } catch (error: unknown) {
    if (job.retryCount >= job.retryLimit) {
      // Runners persist their canonical failure after delivery preparation.
      // Re-read it so the final retry preserves the observed cause instead of
      // the stale pre-execution snapshot. A read failure must not mask the
      // runner error or prevent pg-boss retry semantics.
      const observed = await runs.findById(scope, job.data.runId).catch(
        () => null,
      );
      const terminalCandidate = observed ?? prepared;
      const exhaustionFailure = retryExhaustionFailure(terminalCandidate);
      let reconciled = false;
      try {
        reconciled = await reconcileCanonicalAndProjection(
          runCtx,
          terminalCandidate,
          scope,
          {
            status: "failed",
            lastErrorCode: exhaustionFailure.lastErrorCode,
            lastErrorSummary: exhaustionFailure.lastErrorSummary,
          },
        );
      } catch {
        // Preserve the runner error for pg-boss. A later recovery sweep will
        // retry the atomic canonical/projection reconciliation.
        runCtx.logger.error("run_delivery_reconciliation_failed", {
          code: QUEUE_RETRY_EXHAUSTED,
          runId: job.data.runId,
          ...(exhaustionFailure.preservedRootCause
            ? { rootCauseCode: exhaustionFailure.lastErrorCode }
            : {}),
        });
      }
      if (reconciled) {
        runCtx.logger.error("run_delivery_reconciled", {
          code: QUEUE_RETRY_EXHAUSTED,
          runId: job.data.runId,
          ...(exhaustionFailure.preservedRootCause
            ? { rootCauseCode: exhaustionFailure.lastErrorCode }
            : {}),
        });
      }
    }
    throw error;
  }
}

/**
 * Reconcile canonical active rows with pg-boss using public APIs only. Live
 * queue states remain untouched. Terminal/missing jobs are converted into a
 * stable canonical terminal result through a scope-checked compare-and-set.
 */
export async function reconcileActiveRuns(
  ctx: WorkerContext,
  options: ReconcileOptions = {},
): Promise<void> {
  throwIfRecoveryAborted(options.signal);
  const runs = new AsyncRunsRepository(ctx.db);
  const active = await runs.listActiveForRecovery(
    options.scope ?? null,
    options.limit ?? RUN_RECOVERY_BATCH_SIZE,
  );
  throwIfRecoveryAborted(options.signal);
  const now = options.now ?? new Date();
  const missingAfterMs =
    options.missingAfterMs ?? RUN_RECOVERY_MISSING_AFTER_MS;

  for (const run of active) {
    throwIfRecoveryAborted(options.signal);
    const runCtx = withRunContext(ctx, {
      runId: run.id,
      workspaceId: run.workspace_id,
      projectId: run.project_id,
    });
    try {
      await reconcileOne(runCtx, run, now, missingAfterMs, options.signal);
      throwIfRecoveryAborted(options.signal);
    } catch {
      throwIfRecoveryAborted(options.signal);
      // Lookup/database errors are retryable on the next sweep. Never include a
      // raw exception or job payload in logs because those may carry secrets.
      runCtx.logger.error("run_recovery_failed", {
        code: "RUN_RECOVERY_CHECK_FAILED",
        runId: run.id,
      });
    }
  }
}

/** One startup/minutely maintenance sweep: scrub OAuth temporaries, then runs. */
export async function runRecoverySweep(
  ctx: WorkerContext,
  options: ReconcileOptions = {},
): Promise<void> {
  throwIfRecoveryAborted(options.signal);
  const now = options.now ?? new Date();
  try {
    const count = await new OAuthIntentsRepository(ctx.db).scrubExpired(now);
    throwIfRecoveryAborted(options.signal);
    if (count > 0) ctx.logger.info("oauth_intents_scrubbed", { count });
  } catch {
    throwIfRecoveryAborted(options.signal);
    // Cleanup is retried next minute. Never log rows/errors: both may contain
    // credential material from a legacy intent.
    ctx.logger.error("oauth_intent_scrub_failed", {
      code: "OAUTH_INTENT_SCRUB_FAILED",
    });
  }
  try {
    const count = await new IdempotencyRepository(ctx.db).pruneExpired();
    throwIfRecoveryAborted(options.signal);
    if (count > 0) ctx.logger.info("idempotency_keys_pruned", { count });
  } catch {
    throwIfRecoveryAborted(options.signal);
    // Expiry correctness is enforced atomically in the repository; this sweep
    // is capacity maintenance and can safely retry next minute.
    ctx.logger.error("idempotency_key_prune_failed", {
      code: "IDEMPOTENCY_KEY_PRUNE_FAILED",
    });
  }
  throwIfRecoveryAborted(options.signal);
  await reconcileActiveRuns(ctx, { ...options, now });
}

/** Start one immediate sweep plus an unref'd, closeable periodic sweep. */
export function startRunRecoveryLoop(
  ctx: WorkerContext,
  options: RecoveryLoopOptions = {},
): RunRecoveryLoop {
  const intervalMs = positiveSafeInteger(
    "run recovery interval",
    options.intervalMs ?? RUN_RECOVERY_INTERVAL_MS,
  );
  const sweepTimeoutMs = positiveSafeInteger(
    "run recovery sweep timeout",
    options.sweepTimeoutMs ?? RUN_RECOVERY_SWEEP_TIMEOUT_MS,
  );
  const stopTimeoutMs = positiveSafeInteger(
    "run recovery stop timeout",
    options.stopTimeoutMs ?? RUN_RECOVERY_STOP_TIMEOUT_MS,
  );

  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let outstandingSweep: Promise<void> | null = null;
  let activeController: AbortController | null = null;
  let stopPromise: Promise<void> | null = null;
  const reconcile =
    options.reconcile ??
    ((signal: AbortSignal) =>
      runRecoverySweep(ctx, {
        missingAfterMs: options.missingAfterMs ?? RUN_RECOVERY_MISSING_AFTER_MS,
        signal,
      }));

  const runNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight !== null) return inFlight;
    if (outstandingSweep !== null) return Promise.resolve();

    const controller = new AbortController();
    activeController = controller;
    const timeout = setTimeout(() => controller.abort(), sweepTimeoutMs);
    timeout.unref();
    const observed = observeRecoveryOperation(
      () => reconcile(controller.signal),
      controller.signal,
    );
    const settlement = observed.settlement.finally(() => {
      if (outstandingSweep === settlement) outstandingSweep = null;
    });
    outstandingSweep = settlement;
    const current = observed.result
      .then((result) => {
        if (result.status === "completed") return;
        if (result.status === "failed") throw result.error;
        if (!stopped) throw new RunRecoveryExecutionError();
      })
      .finally(() => {
        clearTimeout(timeout);
        if (inFlight === current) inFlight = null;
        if (activeController === controller) activeController = null;
      });
    inFlight = current;
    return current;
  };

  const reportPeriodicFailure = (): void => {
    try {
      ctx.logger.error("run_recovery_failed", {
        code: "RUN_RECOVERY_SWEEP_FAILED",
      });
    } catch {
      // A failing log sink must not create an unhandled periodic rejection.
    }
  };
  const stop = (): Promise<void> => {
    if (stopPromise !== null) return stopPromise;
    stopped = true;
    clearInterval(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
    activeController?.abort();
    const pending = inFlight;
    stopPromise =
      pending === null
        ? Promise.resolve()
        : waitForPromise(pending, stopTimeoutMs);
    return stopPromise;
  };
  const onExternalAbort = (): void => {
    void stop();
  };

  const timer = setInterval(() => {
    void runNow().catch(reportPeriodicFailure);
  }, intervalMs);
  timer.unref();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  // Start now; callers may await runNow() to make this startup sweep a
  // readiness condition without scheduling it twice.
  if (options.signal?.aborted) onExternalAbort();
  else void runNow().catch(reportPeriodicFailure);

  return { runNow, stop };
}

async function reconcileOne(
  ctx: WorkerContext,
  run: AsyncRunRow,
  now: Date,
  missingAfterMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfRecoveryAborted(signal);
  const scope: ProjectScope = {
    workspaceId: run.workspace_id,
    projectId: run.project_id,
  };
  if (await hasUnsupportedDiagnosticExecutor(ctx, run, scope, signal)) {
    await terminalize(
      ctx,
      run,
      scope,
      {
        status: "failed",
        code: DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED,
        summary: DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED_SUMMARY,
      },
      signal,
    );
    return;
  }
  const queue = queueForRun(run);
  if (!queue) {
    await terminalize(
      ctx,
      run,
      scope,
      {
        status: "failed",
        code: "QUEUE_MAPPING_INVALID",
        summary: "The active run cannot be mapped to a supported queue.",
      },
      signal,
    );
    return;
  }

  const lookup = await findCanonicalJobs(ctx, queue, run, signal);
  throwIfRecoveryAborted(signal);
  const { jobs } = lookup;
  if (jobs.some((job) => isLiveQueueState(job.state))) return;

  if (jobs.some((job) => job.state === "failed")) {
    const terminalFailure = terminalFailureWithCanonicalCause(
      run,
      "QUEUE_JOB_FAILED",
      QUEUE_JOB_FAILED_SUMMARY,
    );
    await terminalize(
      ctx,
      run,
      scope,
      {
        status: "failed",
        code: terminalFailure.lastErrorCode,
        summary: terminalFailure.lastErrorSummary,
      },
      signal,
    );
    return;
  }
  if (jobs.some((job) => job.state === "cancelled")) {
    await terminalize(
      ctx,
      run,
      scope,
      {
        status: "cancelled",
        code: "QUEUE_JOB_CANCELLED",
        summary: "The queue job was cancelled before the run completed.",
      },
      signal,
    );
    return;
  }
  if (jobs.some((job) => job.state === "completed")) {
    await terminalize(
      ctx,
      run,
      scope,
      {
        status: "failed",
        code: "QUEUE_JOB_COMPLETED_WITHOUT_CANONICAL_RESULT",
        summary:
          "The queue job completed without recording a canonical run result.",
      },
      signal,
    );
    return;
  }

  if (lookup.contractFailure) {
    await terminalize(
      ctx,
      run,
      scope,
      {
        status: "failed",
        code: lookup.contractFailure.code,
        summary: lookup.contractFailure.summary,
      },
      signal,
    );
    return;
  }

  const activeSince = new Date(run.started_at ?? run.queued_at).getTime();
  if (
    Number.isFinite(activeSince) &&
    now.getTime() - activeSince >= missingAfterMs
  ) {
    await terminalize(
      ctx,
      run,
      scope,
      {
        status: "failed",
        code: "QUEUE_JOB_MISSING",
        summary: "No queue job could be found for this active run.",
      },
      signal,
    );
  }
}

async function findCanonicalJobs(
  ctx: WorkerContext,
  queue: QueueName,
  run: AsyncRunRow,
  signal: AbortSignal | undefined,
): Promise<CanonicalJobLookup> {
  throwIfRecoveryAborted(signal);
  const direct = await ctx.boss.getJobById<CanonicalJobPayload>(queue, run.id);
  throwIfRecoveryAborted(signal);
  if (
    direct &&
    jobMatchesRun(direct, run) &&
    run.kind !== "analysis_refresh"
  ) {
    return { jobs: [direct], contractFailure: null };
  }

  // Old releases generated a random pg-boss id. Analysis Refresh also uses a
  // fresh random id for every durable continuation, so it must always inspect
  // all jobs carrying the canonical run id even when the initial direct-id
  // delivery still exists. JSONB containment narrows the public lookup; exact
  // scope checks below prevent a cross-project collision.
  const legacy = await ctx.boss.findJobs<CanonicalJobPayload>(queue, {
    data: { runId: run.id },
  });
  throwIfRecoveryAborted(signal);
  const candidates = stableUniqueJobs(direct, legacy);
  const jobs = candidates.filter((job) => jobMatchesRun(job, run));
  if (jobs.length > 0) return { jobs, contractFailure: null };

  for (const candidate of candidates) {
    if (!jobMatchesRunIdentity(candidate, run)) continue;
    const contractFailure = validateJobContract(
      candidate.data.contractVersion,
      run.contract_version,
      run.kind,
    );
    if (contractFailure) return { jobs: [], contractFailure };
  }
  return { jobs: [], contractFailure: null };
}

function jobMatchesRun(
  job: JobWithMetadata<CanonicalJobPayload>,
  run: AsyncRunRow,
): boolean {
  return (
    jobMatchesRunIdentity(job, run) &&
    isSupportedJobContract(job.data.contractVersion, run.kind) &&
    job.data.contractVersion === run.contract_version
  );
}

function jobMatchesRunIdentity(
  job: JobWithMetadata<CanonicalJobPayload>,
  run: AsyncRunRow,
): boolean {
  const data = job.data;
  return (
    isRecord(data) &&
    data.runId === run.id &&
    data.workspaceId === run.workspace_id &&
    data.projectId === run.project_id
  );
}

function stableUniqueJobs(
  direct: JobWithMetadata<CanonicalJobPayload> | null,
  legacy: JobWithMetadata<CanonicalJobPayload>[],
): JobWithMetadata<CanonicalJobPayload>[] {
  const ordered = [
    ...(direct ? [direct] : []),
    ...legacy.slice().sort((left, right) => left.id.localeCompare(right.id)),
  ];
  const seen = new Set<string>();
  return ordered.filter((job) => {
    if (seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });
}

function isRecord(value: unknown): value is CanonicalJobPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["runId"] === "string" &&
    typeof candidate["workspaceId"] === "string" &&
    typeof candidate["projectId"] === "string"
  );
}

function validateJobContract(
  jobContractVersion: unknown,
  runContractVersion: string,
  runKind: string,
): JobContractFailure | null {
  if (!isSupportedJobContract(jobContractVersion, runKind)) {
    return {
      code: "UNSUPPORTED_JOB_CONTRACT",
      summary: "The queue job uses an unsupported contract version.",
    };
  }
  if (jobContractVersion !== runContractVersion) {
    return {
      code: "JOB_CONTRACT_MISMATCH",
      summary: "The queue job contract does not match the canonical run.",
    };
  }
  return null;
}

function isSupportedJobContract(
  value: unknown,
  runKind: string,
): value is string {
  if (runKind === "publication") {
    return value === PUBLICATION_CONTRACT_VERSION;
  }
  if (runKind === "measurement") {
    return value === MEASUREMENT_CONTRACT_VERSION;
  }
  return value === CONTRACT_VERSION || value === LEGACY_CONTRACT_VERSION;
}

function isLiveQueueState(state: JobWithMetadata["state"]): boolean {
  return state === "created" || state === "retry" || state === "active";
}

async function hasUnsupportedDiagnosticExecutor(
  ctx: WorkerContext,
  run: AsyncRunRow,
  scope: ProjectScope,
  signal?: AbortSignal,
): Promise<boolean> {
  if (run.kind !== "diagnostic") return false;
  throwIfRecoveryAborted(signal);
  const diagnostic = await new DiagnosticRunsRepository(ctx.db).findById(
    scope,
    run.id,
  );
  throwIfRecoveryAborted(signal);
  return (
    diagnostic !== null && !supportsDiagnosticExecutorVersion(diagnostic)
  );
}

async function terminalize(
  ctx: WorkerContext,
  run: AsyncRunRow,
  scope: ProjectScope,
  outcome: {
    readonly status: "failed" | "cancelled";
    readonly code: string;
    readonly summary: string;
  },
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfRecoveryAborted(signal);
  const reconciled = await reconcileCanonicalAndProjection(
    ctx,
    run,
    scope,
    {
      status: outcome.status,
      lastErrorCode: outcome.code,
      lastErrorSummary: outcome.summary,
    },
    signal,
  );
  throwIfRecoveryAborted(signal);
  if (reconciled) {
    ctx.logger.warn("run_recovery_reconciled", {
      code: outcome.code,
      runId: run.id,
      status: outcome.status,
    });
  }
}

async function reconcileCanonicalAndProjection(
  ctx: WorkerContext,
  run: AsyncRunRow,
  scope: ProjectScope,
  values: {
    readonly status: "failed" | "cancelled";
    readonly lastErrorCode: string;
    readonly lastErrorSummary: string;
  },
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfRecoveryAborted(signal);
  return ctx.db.transaction(async (tx) => {
    throwIfRecoveryAborted(signal);
    const runs = new AsyncRunsRepository(tx);
    if (!(await runs.lockActiveForRecovery(scope, run.id))) return false;
    throwIfRecoveryAborted(signal);
    const project = await new ProjectsRepository(tx).findByIdForUpdate(
      { workspaceId: scope.workspaceId },
      scope.projectId,
    );
    if (!project) {
      throw new Error("recovery project disappeared while reconciling run");
    }
    throwIfRecoveryAborted(signal);
    const reconciled = await runs.reconcileActiveToTerminal(
      scope,
      run.id,
      values,
    );
    throwIfRecoveryAborted(signal);
    if (!reconciled) return false;

    if (run.kind === "analysis_refresh") {
      const plans = new AnalysisRefreshRunsRepository(tx);
      const steps = await plans.listSteps(scope, run.id);
      const running = steps.find((step) => step.state === "running");
      if (running) {
        const failed = await plans.failStep(
          scope,
          run.id,
          running.step_key,
          {
            childAsyncRunId: running.child_async_run_id,
            error: {
              code: "ANALYSIS_REFRESH_RECOVERY_TERMINATED",
              summary:
                "Recovery terminalized the parent before its running step completed.",
            },
          },
        );
        if (!failed) {
          throw new Error(
            "recovery could not terminalize the running Analysis Refresh step",
          );
        }
        throwIfRecoveryAborted(signal);
      }
    }

    const artifactId = run.request_payload["artifactId"];
    if (run.kind === "artifact_generation" && typeof artifactId === "string") {
      await new ExecutionArtifactsRepository(tx).setFailedForGenerationRun(
        scope,
        artifactId,
        run.id,
      );
      throwIfRecoveryAborted(signal);
    }
    // Content Shadow claims its draft inside the worker, so the request payload
    // carries no artifact id to compensate with; the generation-run pointer is
    // the run-scoped key instead. Without this the artifact would outlive its
    // terminal run stuck in `generating`.
    if (run.kind === "content_shadow") {
      await new ExecutionArtifactsRepository(tx).failGeneratingByGenerationRun(
        scope,
        run.id,
      );
      throwIfRecoveryAborted(signal);
    }
    const sourceConnectionId = run.request_payload["sourceConnectionId"];
    const collectionProvider = run.request_payload["provider"];
    if (
      run.kind === "collection" &&
      project.archived_at === null &&
      typeof sourceConnectionId === "string" &&
      UUID_PATTERN.test(sourceConnectionId) &&
      typeof collectionProvider === "string" &&
      collectionQueueForProvider(collectionProvider) !== null
    ) {
      await new SourceConnectionsRepository(
        tx,
      ).recoverSyncingAfterCollectionFailure(
        scope,
        sourceConnectionId,
        collectionProvider,
      );
      throwIfRecoveryAborted(signal);
    }
    return true;
  });
}

function observeRecoveryOperation<T>(
  operation: () => Promise<T> | T,
  signal: AbortSignal,
): ObservedRecoveryOperation<T> {
  if (signal.aborted) {
    return {
      result: Promise.resolve({ status: "aborted" }),
      settlement: Promise.resolve(),
    };
  }

  let pending: Promise<T>;
  try {
    pending = Promise.resolve(operation());
  } catch (error) {
    return {
      result: Promise.resolve({ status: "failed", error }),
      settlement: Promise.resolve(),
    };
  }
  const settlement = pending.then(
    () => undefined,
    () => undefined,
  );
  const result = new Promise<RecoveryOperationResult<T>>((resolve) => {
    let settled = false;
    const finish = (outcome: RecoveryOperationResult<T>): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = (): void => finish({ status: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    void pending.then(
      (value) => finish({ status: "completed", value }),
      (error) => finish({ status: "failed", error }),
    );
  });
  return { result, settlement };
}

function throwIfRecoveryAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RunRecoveryExecutionError();
}

function positiveSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

async function waitForPromise(
  pending: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pending.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function scopeFromPayload(payload: CanonicalJobPayload): ProjectScope {
  return {
    workspaceId: payload.workspaceId,
    projectId: payload.projectId,
  };
}
