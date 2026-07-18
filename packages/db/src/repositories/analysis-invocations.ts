import { analysisInvocations } from "../schema.ts";
import { Repository } from "./base.ts";

/**
 * `analysis_invocations` is append-only (spec §10.2). One row per model call with
 * provider/model, prompt set, input/output hashes, token counts, latency, status
 * and cost — never prompt or output text (spec §14.4). `generated` evidence must
 * reference one of these ids.
 */

export class AnalysisInvocationsRepository extends Repository {
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
