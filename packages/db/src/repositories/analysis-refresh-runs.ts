import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { contentHash, type CanonicalValue } from "../hash.ts";
import {
  analysisRefreshRuns,
  analysisRefreshSteps,
} from "../schema.ts";
import {
  projectPredicate,
  Repository,
  type ProjectScope,
} from "./base.ts";

export const ANALYSIS_REFRESH_PLAN_VERSION =
  "analysis-refresh.plan.v1" as const;

export const ANALYSIS_REFRESH_PLAN_STEPS = [
  { ordinal: 1, stepKey: "crawl", required: true },
  { ordinal: 2, stepKey: "gsc", required: false },
  { ordinal: 3, stepKey: "ga4", required: false },
  { ordinal: 4, stepKey: "dataforseo", required: false },
  { ordinal: 5, stepKey: "growth_audit", required: true },
] as const;

export type AnalysisRefreshStepKey =
  (typeof ANALYSIS_REFRESH_PLAN_STEPS)[number]["stepKey"];
export type AnalysisRefreshStepState =
  | "pending"
  | "running"
  | "completed"
  | "skipped"
  | "failed";

export interface AnalysisRefreshPlanManifest {
  readonly version: typeof ANALYSIS_REFRESH_PLAN_VERSION;
  readonly steps: readonly {
    readonly ordinal: number;
    readonly stepKey: AnalysisRefreshStepKey;
    readonly required: boolean;
  }[];
}

export interface AnalysisRefreshRunRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly icp_profile_id: string;
  readonly plan_manifest: AnalysisRefreshPlanManifest;
  readonly plan_hash: string;
  readonly created_at: string;
}

export interface AnalysisRefreshStepError {
  readonly code: string;
  readonly summary: string;
}

export interface AnalysisRefreshStepRow {
  readonly analysis_refresh_run_id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly ordinal: number;
  readonly step_key: AnalysisRefreshStepKey;
  readonly required: boolean;
  readonly state: AnalysisRefreshStepState;
  readonly child_async_run_id: string | null;
  readonly result_snapshot_id: string | null;
  readonly skip_reason: string | null;
  readonly error: AnalysisRefreshStepError | null;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CreatedAnalysisRefreshPlan {
  readonly run: AnalysisRefreshRunRow;
  readonly steps: AnalysisRefreshStepRow[];
}

/**
 * Return a fresh object so a caller cannot mutate the frozen server-owned plan
 * shared by another request.
 */
export function analysisRefreshPlanManifest(): AnalysisRefreshPlanManifest {
  return {
    version: ANALYSIS_REFRESH_PLAN_VERSION,
    steps: ANALYSIS_REFRESH_PLAN_STEPS.map((step) => ({ ...step })),
  };
}

export function analysisRefreshPlanHash(
  manifest: AnalysisRefreshPlanManifest,
): string {
  return contentHash(manifest as unknown as CanonicalValue);
}

function assertStepError(error: AnalysisRefreshStepError): void {
  if (
    error.code.trim().length === 0 ||
    error.code.length > 200 ||
    error.summary.trim().length === 0 ||
    error.summary.length > 1_000
  ) {
    throw new RangeError(
      "Analysis Refresh step errors require bounded code and summary",
    );
  }
}

function assertSkipReason(skipReason: string): void {
  if (
    skipReason !== skipReason.trim() ||
    skipReason.length < 1 ||
    skipReason.length > 500 ||
    [...skipReason].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new RangeError(
      "Analysis Refresh skip reason must be a bounded printable string",
    );
  }
}

/**
 * Durable Analysis Refresh plan storage. Parent plan identity is append-only in
 * SQL; only the five step execution rows may advance through their state graph.
 */
export class AnalysisRefreshRunsRepository extends Repository {
  /**
   * Insert the immutable parent and all five pending steps in the caller's
   * atomic enqueue transaction.
   */
  async create(values: {
    runId: string;
    workspaceId: string;
    projectId: string;
    siteId: string;
    icpProfileId: string;
  }): Promise<CreatedAnalysisRefreshPlan> {
    const manifest = analysisRefreshPlanManifest();
    const planHash = analysisRefreshPlanHash(manifest);
    const [run] = await this.exec
      .insert(analysisRefreshRuns)
      .values({
        id: values.runId,
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        icp_profile_id: values.icpProfileId,
        plan_manifest: manifest as unknown as Record<string, unknown>,
        plan_hash: planHash,
      })
      .returning();
    if (!run) throw new Error("analysis refresh parent insert returned no row");

    const steps = await this.exec
      .insert(analysisRefreshSteps)
      .values(
        ANALYSIS_REFRESH_PLAN_STEPS.map((step) => ({
          analysis_refresh_run_id: values.runId,
          workspace_id: values.workspaceId,
          project_id: values.projectId,
          ordinal: step.ordinal,
          step_key: step.stepKey,
          required: step.required,
        })),
      )
      .returning();
    if (steps.length !== ANALYSIS_REFRESH_PLAN_STEPS.length) {
      throw new Error("analysis refresh step plan insert was incomplete");
    }
    return {
      run: run as unknown as AnalysisRefreshRunRow,
      steps: steps as AnalysisRefreshStepRow[],
    };
  }

  async findById(
    scope: ProjectScope,
    runId: string,
  ): Promise<AnalysisRefreshRunRow | null> {
    const rows = await this.exec
      .select()
      .from(analysisRefreshRuns)
      .where(
        and(
          projectPredicate(analysisRefreshRuns, scope),
          eq(analysisRefreshRuns.id, runId),
        ),
      )
      .limit(1);
    return (rows[0] as AnalysisRefreshRunRow | undefined) ?? null;
  }

  async listSteps(
    scope: ProjectScope,
    runId: string,
  ): Promise<AnalysisRefreshStepRow[]> {
    return (await this.exec
      .select({
        analysis_refresh_run_id:
          analysisRefreshSteps.analysis_refresh_run_id,
        workspace_id: analysisRefreshSteps.workspace_id,
        project_id: analysisRefreshSteps.project_id,
        ordinal: analysisRefreshSteps.ordinal,
        step_key: analysisRefreshSteps.step_key,
        required: analysisRefreshSteps.required,
        state: analysisRefreshSteps.state,
        child_async_run_id: analysisRefreshSteps.child_async_run_id,
        result_snapshot_id: analysisRefreshSteps.result_snapshot_id,
        skip_reason: analysisRefreshSteps.skip_reason,
        error: analysisRefreshSteps.error,
        started_at: analysisRefreshSteps.started_at,
        completed_at: analysisRefreshSteps.completed_at,
        created_at: analysisRefreshSteps.created_at,
        updated_at: analysisRefreshSteps.updated_at,
      })
      .from(analysisRefreshSteps)
      .where(
        and(
          projectPredicate(analysisRefreshSteps, scope),
          eq(analysisRefreshSteps.analysis_refresh_run_id, runId),
        ),
      )
      .orderBy(asc(analysisRefreshSteps.ordinal))) as AnalysisRefreshStepRow[];
  }

  async startStep(
    scope: ProjectScope,
    runId: string,
    stepKey: AnalysisRefreshStepKey,
    childAsyncRunId: string,
  ): Promise<AnalysisRefreshStepRow | null> {
    const rows = await this.exec
      .update(analysisRefreshSteps)
      .set({
        state: "running",
        child_async_run_id: childAsyncRunId,
        started_at: sql`now()`,
      })
      .where(
        and(
          projectPredicate(analysisRefreshSteps, scope),
          eq(analysisRefreshSteps.analysis_refresh_run_id, runId),
          eq(analysisRefreshSteps.step_key, stepKey),
          eq(analysisRefreshSteps.state, "pending"),
        ),
      )
      .returning();
    return (rows[0] as AnalysisRefreshStepRow | undefined) ?? null;
  }

  async completeStep(
    scope: ProjectScope,
    runId: string,
    stepKey: AnalysisRefreshStepKey,
    values: {
      childAsyncRunId: string;
      resultSnapshotId: string | null;
    },
  ): Promise<boolean> {
    const rows = await this.exec
      .update(analysisRefreshSteps)
      .set({
        state: "completed",
        result_snapshot_id: values.resultSnapshotId,
        completed_at: sql`now()`,
      })
      .where(
        and(
          projectPredicate(analysisRefreshSteps, scope),
          eq(analysisRefreshSteps.analysis_refresh_run_id, runId),
          eq(analysisRefreshSteps.step_key, stepKey),
          eq(analysisRefreshSteps.state, "running"),
          eq(
            analysisRefreshSteps.child_async_run_id,
            values.childAsyncRunId,
          ),
        ),
      )
      .returning({ ordinal: analysisRefreshSteps.ordinal });
    return rows.length === 1;
  }

  async skipStep(
    scope: ProjectScope,
    runId: string,
    stepKey: Exclude<
      AnalysisRefreshStepKey,
      "crawl" | "growth_audit"
    >,
    skipReason: string,
  ): Promise<boolean> {
    assertSkipReason(skipReason);
    const rows = await this.exec
      .update(analysisRefreshSteps)
      .set({
        state: "skipped",
        skip_reason: skipReason,
        completed_at: sql`now()`,
      })
      .where(
        and(
          projectPredicate(analysisRefreshSteps, scope),
          eq(analysisRefreshSteps.analysis_refresh_run_id, runId),
          eq(analysisRefreshSteps.step_key, stepKey),
          eq(analysisRefreshSteps.required, false),
          eq(analysisRefreshSteps.state, "pending"),
        ),
      )
      .returning({ ordinal: analysisRefreshSteps.ordinal });
    return rows.length === 1;
  }

  async failStep(
    scope: ProjectScope,
    runId: string,
    stepKey: AnalysisRefreshStepKey,
    values: {
      childAsyncRunId: string | null;
      error: AnalysisRefreshStepError;
    },
  ): Promise<boolean> {
    assertStepError(values.error);
    const rows = await this.exec
      .update(analysisRefreshSteps)
      .set({
        state: "failed",
        ...(values.childAsyncRunId
          ? { child_async_run_id: values.childAsyncRunId }
          : {}),
        error: values.error as unknown as Record<string, unknown>,
        completed_at: sql`now()`,
      })
      .where(
        and(
          projectPredicate(analysisRefreshSteps, scope),
          eq(analysisRefreshSteps.analysis_refresh_run_id, runId),
          eq(analysisRefreshSteps.step_key, stepKey),
          inArray(analysisRefreshSteps.state, ["pending", "running"]),
          ...(values.childAsyncRunId
            ? [
                sql`${analysisRefreshSteps.child_async_run_id} IS NULL OR ${analysisRefreshSteps.child_async_run_id} = ${values.childAsyncRunId}`,
              ]
            : [sql`${analysisRefreshSteps.child_async_run_id} IS NULL`]),
        ),
      )
      .returning({ ordinal: analysisRefreshSteps.ordinal });
    return rows.length === 1;
  }
}
