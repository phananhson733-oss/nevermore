import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";
import { asyncRuns } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * `async_runs` is the unified ledger for every asynchronous job (collection,
 * diagnostic, artifact_generation, export; spec §5.2, §13). The partial unique
 * index `async_runs_one_active_key_idx` guarantees at most one queued/running run
 * per (project, active_key) — a duplicate aborts the enqueue transaction, which
 * the caller maps to 409 RUN_ALREADY_ACTIVE (§13.4).
 */

export type RunKind =
  | "collection"
  | "diagnostic"
  | "artifact_generation"
  | "export"
  | "product_profile_synthesis"
  | "content_shadow"
  | "publication"
  | "measurement"
  | "analysis_refresh";
export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export interface AsyncRunRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly kind: string;
  readonly status: string;
  readonly active_key: string | null;
  readonly contract_version: string;
  readonly request_payload: Record<string, unknown>;
  readonly progress: Record<string, unknown>;
  readonly last_error_code: string | null;
  readonly last_error_summary: string | null;
  readonly result_type: string | null;
  readonly result_id: string | null;
  readonly attempt_count: number;
  readonly initiated_by: string;
  readonly queued_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
}

/**
 * Fencing identity for one successful queued→running claim. `attempt_count` is
 * the monotonic epoch: after a queue retry reclaims the run, every mutation from
 * an older epoch must become a no-op.
 */
export interface RunAttempt {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly attemptCount: number;
}

/** Metadata-only 24h operations projection; never returns payloads or IDs. */
export interface QueueTechnicalMetric {
  readonly kind: RunKind;
  readonly queuedDepth: number;
  readonly runningDepth: number;
  readonly oldestQueuedAgeMs: number;
  readonly averageRunDurationMs24h: number;
  readonly maxRunDurationMs24h: number;
  readonly retryCount24h: number;
  readonly failureCount24h: number;
}

export function toRunAttempt(run: AsyncRunRow): RunAttempt {
  return {
    workspaceId: run.workspace_id,
    projectId: run.project_id,
    runId: run.id,
    attemptCount: run.attempt_count,
  };
}

const TERMINAL: ReadonlySet<string> = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);
export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status);
}

export class AsyncRunsRepository extends Repository {
  /**
   * Global worker health aggregate (spec §15.2). It intentionally crosses
   * workspaces only after aggregation and exposes no identifiers, payloads,
   * errors, or customer fields. Active depth is current; duration/retry/failure
   * counters use a fixed 24-hour window so the snapshot stays operationally
   * meaningful instead of growing forever.
   */
  async technicalMetrics(): Promise<QueueTechnicalMetric[]> {
    const result = await this.exec.execute<{
      kind: unknown;
      queued_depth: unknown;
      running_depth: unknown;
      oldest_queued_age_ms: unknown;
      average_run_duration_ms_24h: unknown;
      max_run_duration_ms_24h: unknown;
      retry_count_24h: unknown;
      failure_count_24h: unknown;
    }>(sql`
      with run_kinds(kind) as (
        values
          ('collection'::text),
          ('diagnostic'::text),
          ('artifact_generation'::text),
          ('export'::text),
          ('product_profile_synthesis'::text),
          ('content_shadow'::text),
          ('publication'::text),
          ('measurement'::text),
          ('analysis_refresh'::text)
      )
      select
        run_kinds.kind,
        count(async_runs.id) filter (where async_runs.status = 'queued') as queued_depth,
        count(async_runs.id) filter (where async_runs.status = 'running') as running_depth,
        coalesce(
          extract(epoch from (clock_timestamp() - min(async_runs.queued_at)
            filter (where async_runs.status = 'queued'))) * 1000,
          0
        ) as oldest_queued_age_ms,
        coalesce(
          avg(extract(epoch from (async_runs.completed_at - async_runs.started_at)) * 1000)
            filter (
              where async_runs.completed_at >= now() - interval '24 hours'
                and async_runs.started_at is not null
            ),
          0
        ) as average_run_duration_ms_24h,
        coalesce(
          max(extract(epoch from (async_runs.completed_at - async_runs.started_at)) * 1000)
            filter (
              where async_runs.completed_at >= now() - interval '24 hours'
                and async_runs.started_at is not null
            ),
          0
        ) as max_run_duration_ms_24h,
        count(async_runs.id) filter (
          where async_runs.queued_at >= now() - interval '24 hours'
            and async_runs.attempt_count > 1
        ) as retry_count_24h,
        count(async_runs.id) filter (
          where async_runs.completed_at >= now() - interval '24 hours'
            and async_runs.status = 'failed'
        ) as failure_count_24h
      from run_kinds
      left join app.async_runs as async_runs on async_runs.kind = run_kinds.kind
      group by run_kinds.kind
      order by run_kinds.kind
    `);

    return result.rows.flatMap((row) => {
      const kind = runKind(row.kind);
      if (kind === null) return [];
      return [
        {
          kind,
          queuedDepth: nonNegativeMetric(row.queued_depth),
          runningDepth: nonNegativeMetric(row.running_depth),
          oldestQueuedAgeMs: nonNegativeMetric(row.oldest_queued_age_ms),
          averageRunDurationMs24h: nonNegativeMetric(
            row.average_run_duration_ms_24h,
          ),
          maxRunDurationMs24h: nonNegativeMetric(row.max_run_duration_ms_24h),
          retryCount24h: nonNegativeMetric(row.retry_count_24h),
          failureCount24h: nonNegativeMetric(row.failure_count_24h),
        },
      ];
    });
  }

  /** Insert a queued run inside the atomic enqueue transaction (spec §13.2). */
  async insertQueued(values: {
    runId?: string;
    workspaceId: string;
    projectId: string;
    kind: RunKind;
    activeKey: string;
    initiatedBy: string;
    /**
     * Job/API contract revision chosen by the caller. The frozen baseline SQL
     * used the product version by mistake; migration 0009 repairs the database
     * default, while canonical application writes remain explicit.
     */
    contractVersion: string;
    requestPayload?: Record<string, unknown>;
    resultType?: string;
    resultId?: string;
  }): Promise<AsyncRunRow> {
    const [row] = await this.exec
      .insert(asyncRuns)
      .values({
        ...(values.runId ? { id: values.runId } : {}),
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        kind: values.kind,
        active_key: values.activeKey,
        initiated_by: values.initiatedBy,
        contract_version: values.contractVersion,
        ...(values.resultType ? { result_type: values.resultType } : {}),
        ...(values.resultId ? { result_id: values.resultId } : {}),
        ...(values.requestPayload
          ? { request_payload: values.requestPayload }
          : {}),
      })
      .returning();
    return row as AsyncRunRow;
  }

  /** The existing queued/running run for an active key, if any (for 409 body). */
  async findActive(
    scope: ProjectScope,
    activeKey: string,
  ): Promise<AsyncRunRow | null> {
    const rows = await this.exec
      .select()
      .from(asyncRuns)
      .where(
        and(
          projectPredicate(asyncRuns, scope),
          eq(asyncRuns.active_key, activeKey),
          sql`${asyncRuns.status} in ('queued','running')`,
        ),
      )
      .limit(1);
    return (rows[0] as AsyncRunRow | undefined) ?? null;
  }

  /**
   * How often this (project, active_key) has already ended in a terminal
   * failure, plus the most recent failure code.
   *
   * Automatic re-arming reads this before enqueuing another attempt. Without it
   * a permanently misconfigured provider produces an unbounded loop: the failed
   * run persists no snapshot, so the next command sees the same missing
   * evidence and enqueues the same doomed job again.
   *
   * The window matters as much as the count. Counting a project's whole history
   * would let one bad afternoon disable a best-effort source forever, including
   * after the defect that caused the failures has been fixed.
   */
  async summarizeTerminalFailures(
    scope: ProjectScope,
    activeKey: string,
    since: Date,
  ): Promise<{
    readonly count: number;
    readonly lastErrorCode: string | null;
  }> {
    const rows = await this.exec
      .select({
        count: sql<number>`count(*)::int`,
        lastErrorCode: sql<
          string | null
        >`(array_agg(${asyncRuns.last_error_code} order by ${asyncRuns.queued_at} desc))[1]`,
      })
      .from(asyncRuns)
      .where(
        and(
          projectPredicate(asyncRuns, scope),
          eq(asyncRuns.active_key, activeKey),
          sql`${asyncRuns.status} in ('failed','cancelled')`,
          gte(asyncRuns.queued_at, since.toISOString()),
        ),
      );
    const row = rows[0];
    return {
      count: row?.count ?? 0,
      lastErrorCode: row?.lastErrorCode ?? null,
    };
  }

  /**
   * Permanent Measurement command replay. Unlike `findActive`, this reads every
   * terminal state because an Idempotency-Key never becomes reusable.
   */
  async findMeasurementByIdempotency(
    scope: ProjectScope,
    idempotencyKey: string,
  ): Promise<AsyncRunRow | null> {
    if (
      idempotencyKey.length < 1 ||
      idempotencyKey.length > 128 ||
      !/^[ -~]+$/u.test(idempotencyKey)
    ) {
      return null;
    }
    const rows = await this.exec
      .select()
      .from(asyncRuns)
      .where(
        and(
          projectPredicate(asyncRuns, scope),
          eq(asyncRuns.kind, "measurement"),
          sql`${asyncRuns.request_payload} ->> ${"idempotencyKey"} = ${idempotencyKey}`,
        ),
      )
      .limit(1);
    return (rows[0] as AsyncRunRow | undefined) ?? null;
  }

  /** All queued/running runs for a project (source/artifact list `activeRun`). */
  async listActiveByProject(scope: ProjectScope): Promise<AsyncRunRow[]> {
    return (await this.exec
      .select()
      .from(asyncRuns)
      .where(
        and(
          projectPredicate(asyncRuns, scope),
          sql`${asyncRuns.status} in ('queued','running')`,
        ),
      )) as AsyncRunRow[];
  }

  /** Read a run for unified status polling (spec §11.2 getProjectRun). */
  async findById(
    scope: ProjectScope,
    runId: string,
  ): Promise<AsyncRunRow | null> {
    const rows = await this.exec
      .select()
      .from(asyncRuns)
      .where(and(projectPredicate(asyncRuns, scope), eq(asyncRuns.id, runId)))
      .limit(1);
    return (rows[0] as AsyncRunRow | undefined) ?? null;
  }

  /**
   * Worker claim: transition queued→running for the winner only, stamping
   * started_at and incrementing attempt_count (spec §13.3). Returns the row when
   * this scoped atomic UPDATE won the claim, else null (already
   * running/terminal or outside the delivery scope).
   */
  async claim(scope: ProjectScope, runId: string): Promise<AsyncRunRow | null> {
    const rows = await this.exec
      .update(asyncRuns)
      .set({
        status: "running",
        started_at: sql`now()`,
        attempt_count: sql`${asyncRuns.attempt_count} + 1`,
      })
      .where(
        and(
          projectPredicate(asyncRuns, scope),
          eq(asyncRuns.id, runId),
          eq(asyncRuns.status, "queued"),
        ),
      )
      .returning();
    return (rows[0] as AsyncRunRow | undefined) ?? null;
  }

  /**
   * Lock and validate a claimed attempt before any canonical domain writes.
   * Completion transactions call this first; a retry/recovery transition on the
   * same run either happens before this lock (and makes it return null) or waits
   * until the owned completion commits.
   */
  async lockAttemptForUpdate(attempt: RunAttempt): Promise<AsyncRunRow | null> {
    if (!validAttemptCount(attempt.attemptCount)) return null;
    const rows = await this.exec
      .select()
      .from(asyncRuns)
      .where(runAttemptPredicate(attempt))
      .limit(1)
      .for("update");
    return (rows[0] as AsyncRunRow | undefined) ?? null;
  }

  /**
   * Recovery-only pure row lock across both canonical active states. Unlike a
   * status UPDATE, this does not change the partial active-key index while the
   * reconciler is still waiting to lock the project and child projections.
   */
  async lockActiveForRecovery(
    scope: ProjectScope,
    runId: string,
  ): Promise<AsyncRunRow | null> {
    const rows = await this.exec
      .select()
      .from(asyncRuns)
      .where(
        and(
          projectPredicate(asyncRuns, scope),
          eq(asyncRuns.id, runId),
          sql`${asyncRuns.status} in ('queued','running')`,
        ),
      )
      .limit(1)
      .for("update");
    return (rows[0] as AsyncRunRow | undefined) ?? null;
  }

  /**
   * Validate an actual pg-boss delivery before invoking a runner. An initial
   * queued delivery is eligible. A canonical row left `running` by a crashed
   * worker is reset only when pg-boss metadata proves this is a later retry and
   * the stale attempt has not already advanced beyond that retry count.
   *
   * The workspace/project predicates and retry guard live in the same UPDATE so
   * a delayed delivery cannot race an active newer attempt or cross scope.
   */
  async prepareDelivery(
    scope: ProjectScope,
    runId: string,
    retryCount: number,
  ): Promise<AsyncRunRow | null> {
    if (!Number.isInteger(retryCount) || retryCount < 0) return null;
    const rows = await this.exec
      .update(asyncRuns)
      .set({ status: "queued", started_at: null })
      .where(
        and(
          projectPredicate(asyncRuns, scope),
          eq(asyncRuns.id, runId),
          or(
            eq(asyncRuns.status, "queued"),
            and(
              eq(asyncRuns.status, "running"),
              sql`${retryCount} > 0`,
              lte(asyncRuns.attempt_count, retryCount),
            ),
          ),
        ),
      )
      .returning();
    return (rows[0] as AsyncRunRow | undefined) ?? null;
  }

  /**
   * Return a claimed run to `queued` before a transient-error retry (spec §13.1).
   * Without this a rethrow leaves the run stuck `running` — the pg-boss retry
   * re-runs `claim`, which only wins on `queued`, acks, and never executes.
   */
  async resetToQueued(
    attempt: RunAttempt,
    error?: { readonly code: string; readonly summary: string },
  ): Promise<boolean> {
    if (!validAttemptCount(attempt.attemptCount)) return false;
    const rows = await this.exec
      .update(asyncRuns)
      .set({
        status: "queued",
        started_at: null,
        ...(error
          ? {
              last_error_code: error.code,
              last_error_summary: error.summary,
            }
          : {}),
      })
      .where(runAttemptPredicate(attempt))
      .returning({ id: asyncRuns.id });
    return rows.length === 1;
  }

  /** Update the progress projection during a running job. */
  async setProgress(
    attempt: RunAttempt,
    progress: Record<string, unknown>,
  ): Promise<boolean> {
    if (!validAttemptCount(attempt.attemptCount)) return false;
    const rows = await this.exec
      .update(asyncRuns)
      .set({ progress })
      .where(runAttemptPredicate(attempt))
      .returning({ id: asyncRuns.id });
    return rows.length === 1;
  }

  /** Write a terminal status + result/error in the same tx as the domain write. */
  async setTerminal(
    attempt: RunAttempt,
    values: {
      status: Extract<
        RunStatus,
        "completed" | "partial" | "failed" | "cancelled"
      >;
      resultType?: string;
      resultId?: string;
      lastErrorCode?: string;
      lastErrorSummary?: string;
    },
  ): Promise<boolean> {
    if (!validAttemptCount(attempt.attemptCount)) return false;
    const rows = await this.exec
      .update(asyncRuns)
      .set({
        status: values.status,
        completed_at: sql`now()`,
        ...(values.resultType ? { result_type: values.resultType } : {}),
        ...(values.resultId ? { result_id: values.resultId } : {}),
        last_error_code: values.lastErrorCode ?? null,
        last_error_summary: values.lastErrorSummary ?? null,
      })
      .where(runAttemptPredicate(attempt))
      .returning({ id: asyncRuns.id });
    return rows.length === 1;
  }

  /**
   * Operational worker scan across both canonical active states. Production
   * passes no scope and re-asserts each returned row's immutable scope during
   * compare-and-set; integration/operations callers may constrain the scan to
   * one project without weakening that mutation guard.
   */
  async listActiveForRecovery(
    scope: ProjectScope | null = null,
    limit = 100,
  ): Promise<AsyncRunRow[]> {
    const active = sql`${asyncRuns.status} in ('queued','running')`;
    return (await this.exec
      .select()
      .from(asyncRuns)
      .where(scope ? and(projectPredicate(asyncRuns, scope), active) : active)
      .orderBy(
        asc(sql`coalesce(${asyncRuns.started_at}, ${asyncRuns.queued_at})`),
        asc(asyncRuns.id),
      )
      .limit(limit)) as AsyncRunRow[];
  }

  /**
   * Reconciler-only compare-and-set across queued/running. A runner that
   * committed a terminal state after the scan wins; recovery never overwrites
   * it. Including queued is essential after a transient runner resets itself
   * immediately before pg-boss exhausts the final retry.
   */
  async reconcileActiveToTerminal(
    scope: ProjectScope,
    runId: string,
    values: {
      status: "failed" | "cancelled";
      lastErrorCode: string;
      lastErrorSummary: string;
    },
  ): Promise<boolean> {
    const rows = await this.exec
      .update(asyncRuns)
      .set({
        status: values.status,
        completed_at: sql`now()`,
        last_error_code: values.lastErrorCode,
        last_error_summary: values.lastErrorSummary,
      })
      .where(
        and(
          projectPredicate(asyncRuns, scope),
          eq(asyncRuns.id, runId),
          sql`${asyncRuns.status} in ('queued','running')`,
        ),
      )
      .returning({ id: asyncRuns.id });
    return rows.length === 1;
  }
}

function validAttemptCount(attemptCount: number): boolean {
  return Number.isSafeInteger(attemptCount) && attemptCount > 0;
}

function runKind(value: unknown): RunKind | null {
  return value === "collection" ||
    value === "diagnostic" ||
    value === "artifact_generation" ||
    value === "export" ||
    value === "product_profile_synthesis" ||
    value === "content_shadow" ||
    value === "publication" ||
    value === "measurement" ||
    value === "analysis_refresh"
    ? value
    : null;
}

function nonNegativeMetric(value: unknown): number {
  let parsed: number;
  if (typeof value === "number") parsed = value;
  else if (typeof value === "string" || typeof value === "bigint") {
    parsed = Number(value);
  } else return 0;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
}

function runAttemptPredicate(attempt: RunAttempt) {
  return and(
    projectPredicate(asyncRuns, {
      workspaceId: attempt.workspaceId,
      projectId: attempt.projectId,
    }),
    eq(asyncRuns.id, attempt.runId),
    eq(asyncRuns.status, "running"),
    eq(asyncRuns.attempt_count, attempt.attemptCount),
  );
}
