import { and, eq, sql } from "drizzle-orm";
import { analysisInvocations } from "../schema.ts";
import {
  Repository,
  projectPredicate,
  type ProjectScope,
} from "./base.ts";

/**
 * `analysis_invocations` is append-only (spec §10.2). One row per model call with
 * provider/model, prompt set, input/output hashes, token counts, latency, status
 * and cost — never prompt or output text (spec §14.4). `generated` evidence must
 * reference one of these ids.
 */

export class AnalysisInvocationsRepository extends Repository {
  /**
   * Count persisted calls for one run/task without loading append-only rows.
   * PostgreSQL returns bigint counts as strings; reject every non-canonical or
   * unsafe value so a malformed/overflowing result can never reopen a budget.
   */
  async countByAsyncRunTask(
    scope: ProjectScope,
    asyncRunId: string,
    task: "finding_summary",
  ): Promise<number> {
    const rows = (await this.exec
      .select({ count: sql<string>`count(*)::text` })
      .from(analysisInvocations)
      .where(
        and(
          projectPredicate(analysisInvocations, scope),
          eq(analysisInvocations.async_run_id, asyncRunId),
          eq(analysisInvocations.task, task),
        ),
      )) as Array<{ readonly count: unknown }>;
    if (rows.length !== 1) {
      throw new Error("invalid analysis invocation count");
    }
    const raw = rows[0]?.count;
    if (typeof raw !== "string" || !/^(?:0|[1-9]\d*)$/u.test(raw)) {
      throw new Error("invalid analysis invocation count");
    }
    const count = Number(raw);
    if (!Number.isSafeInteger(count)) {
      throw new Error("invalid analysis invocation count");
    }
    return count;
  }

  async insert(values: {
    workspaceId: string;
    projectId: string;
    asyncRunId: string | null;
    task: string;
    provider: string;
    model: string;
    promptSetVersion: string;
    inputHash: string;
    outputHash: string | null;
    status: string;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    latencyMs: number;
    errorCode: string | null;
  }): Promise<string> {
    const [row] = await this.exec
      .insert(analysisInvocations)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        async_run_id: values.asyncRunId,
        task: values.task,
        provider: values.provider,
        model: values.model,
        prompt_set_version: values.promptSetVersion,
        input_hash: values.inputHash,
        output_hash: values.outputHash,
        status: values.status,
        input_tokens: values.inputTokens,
        output_tokens: values.outputTokens,
        cost_usd: values.costUsd === null ? null : String(values.costUsd),
        latency_ms: values.latencyMs,
        error_code: values.errorCode,
      })
      .returning({ id: analysisInvocations.id });
    return (row as { id: string }).id;
  }
}
