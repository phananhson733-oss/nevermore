import { and, asc, eq, lte, or, sql } from "drizzle-orm";
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
  | "export";
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
  /** Insert a queued run inside the atomic enqueue transaction (spec §13.2). */
  async insertQueued(values: {
    workspaceId: string;
    projectId: string;
    kind: RunKind;
    activeKey: string;
    initiatedBy: string;
    contractVersion?: string;
    requestPayload?: Record<string, unknown>;
  }): Promise<AsyncRunRow> {
    const [row] = await this.exec
      .insert(asyncRuns)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        kind: values.kind,
        active_key: values.activeKey,
        initiated_by: values.initiatedBy,
        ...(values.contractVersion
          ? { contract_version: values.contractVersion }
          : {}),
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
   * this call won the claim, else null (already running/terminal). Must run inside
   * a transaction that first `SELECT ... FOR UPDATE`s the row.
   */
  async claim(runId: string): Promise<AsyncRunRow | null> {
    const rows = await this.exec
      .update(asyncRuns)
      .set({
        status: "running",
        started_at: sql`now()`,
        attempt_count: sql`${asyncRuns.attempt_count} + 1`,
      })
      .where(and(eq(asyncRuns.id, runId), eq(asyncRuns.status, "queued")))
      .returning();
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
    runId: string,
    error?: { readonly code: string; readonly summary: string },
  ): Promise<void> {
    await this.exec
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
      .where(and(eq(asyncRuns.id, runId), eq(asyncRuns.status, "running")));
  }

  /** Update the progress projection during a running job. */
  async setProgress(
    runId: string,
    progress: Record<string, unknown>,
  ): Promise<void> {
    await this.exec
      .update(asyncRuns)
      .set({ progress })
      .where(eq(asyncRuns.id, runId));
  }

  /** Write a terminal status + result/error in the same tx as the domain write. */
  async setTerminal(
    runId: string,
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
  ): Promise<void> {
    await this.exec
      .update(asyncRuns)
      .set({
        status: values.status,
        completed_at: sql`now()`,
        ...(values.resultType ? { result_type: values.resultType } : {}),
        ...(values.resultId ? { result_id: values.resultId } : {}),
        ...(values.lastErrorCode
          ? { last_error_code: values.lastErrorCode }
          : {}),
        ...(values.lastErrorSummary
          ? { last_error_summary: values.lastErrorSummary }
          : {}),
      })
      .where(eq(asyncRuns.id, runId));
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
      .where(
        scope
          ? and(projectPredicate(asyncRuns, scope), active)
          : active,
      )
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
