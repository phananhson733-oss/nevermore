import { and, desc, eq } from "drizzle-orm";
import { diagnosticRunRules, diagnosticRuns } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * `diagnostic_runs` shares its id with `async_runs` (spec §12.1). The run freezes
 * an immutable input manifest (icp version + selected snapshot ids/checksums +
 * rule/prompt set versions) hashed into `input_hash` (spec §8.1) so a later
 * snapshot never changes this run's result. `diagnostic_run_rules` is the
 * append-only per-rule result ledger (composite PK).
 */

export interface DiagnosticRunRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly icp_profile_id: string;
  readonly icp_profile_version: number;
  readonly rule_set_version: string;
  readonly prompt_set_version: string;
  readonly output_locale: string;
  readonly input_manifest: Record<string, unknown>;
  readonly input_hash: string;
  readonly coverage: Record<string, unknown>;
  readonly created_at: string;
}

export interface RuleResultInsert {
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly domain: string;
  readonly status: string;
  readonly reason: string | null;
  readonly metrics: Record<string, unknown>;
  readonly durationMs: number;
}

export class DiagnosticRunsRepository extends Repository {
  /** Insert the frozen diagnostic run placeholder (atomic enqueue tx). */
  async insert(values: {
    runId: string;
    workspaceId: string;
    projectId: string;
    siteId: string;
    icpProfileId: string;
    icpProfileVersion: number;
    ruleSetVersion: string;
    promptSetVersion: string;
    outputLocale: string;
    inputManifest: Record<string, unknown>;
    inputHash: string;
  }): Promise<DiagnosticRunRow> {
    const [row] = await this.exec
      .insert(diagnosticRuns)
      .values({
        id: values.runId,
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        icp_profile_id: values.icpProfileId,
        icp_profile_version: values.icpProfileVersion,
        rule_set_version: values.ruleSetVersion,
        prompt_set_version: values.promptSetVersion,
        output_locale: values.outputLocale,
        input_manifest: values.inputManifest,
        input_hash: values.inputHash,
      })
      .returning();
    return row as DiagnosticRunRow;
  }

  async findById(
    scope: ProjectScope,
    id: string,
  ): Promise<DiagnosticRunRow | null> {
    const rows = await this.exec
      .select()
      .from(diagnosticRuns)
      .where(
        and(projectPredicate(diagnosticRuns, scope), eq(diagnosticRuns.id, id)),
      )
      .limit(1);
    return (rows[0] as DiagnosticRunRow | undefined) ?? null;
  }

  /** The latest diagnostic run for a project (Diagnosis screen meta). */
  async findLatest(scope: ProjectScope): Promise<DiagnosticRunRow | null> {
    const rows = await this.exec
      .select()
      .from(diagnosticRuns)
      .where(projectPredicate(diagnosticRuns, scope))
      .orderBy(desc(diagnosticRuns.created_at))
      .limit(1);
    return (rows[0] as DiagnosticRunRow | undefined) ?? null;
  }

  /** Persist the run coverage projection (worker completion tx). */
  async setCoverage(
    id: string,
    coverage: Record<string, unknown>,
  ): Promise<void> {
    await this.exec
      .update(diagnosticRuns)
      .set({ coverage })
      .where(eq(diagnosticRuns.id, id));
  }

  /** Append per-rule results (append-only ledger; worker completion tx). */
  async insertRuleResults(
    values: {
      diagnosticRunId: string;
      workspaceId: string;
      projectId: string;
    },
    results: readonly RuleResultInsert[],
  ): Promise<void> {
    if (results.length === 0) return;
    await this.exec.insert(diagnosticRunRules).values(
      results.map((r) => ({
        diagnostic_run_id: values.diagnosticRunId,
        rule_id: r.ruleId,
        rule_version: r.ruleVersion,
        domain: r.domain,
        status: r.status,
        reason: r.reason,
        metrics: r.metrics,
        duration_ms: r.durationMs,
      })),
    );
  }

  /** Load the per-rule results for a run (Diagnosis screen rule board). */
  async listRuleResults(diagnosticRunId: string): Promise<
    {
      rule_id: string;
      rule_version: number;
      domain: string;
      status: string;
      reason: string | null;
      metrics: Record<string, unknown>;
      duration_ms: number;
    }[]
  > {
    return (await this.exec
      .select()
      .from(diagnosticRunRules)
      .where(eq(diagnosticRunRules.diagnostic_run_id, diagnosticRunId))) as {
      rule_id: string;
      rule_version: number;
      domain: string;
      status: string;
      reason: string | null;
      metrics: Record<string, unknown>;
      duration_ms: number;
    }[];
  }
}
