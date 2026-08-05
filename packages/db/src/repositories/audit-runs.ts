import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq } from "drizzle-orm";
import { auditModuleResults, auditRuns } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/** Known historical read-model generation retained only for explicit pins. */
export const LEGACY_GROWTH_AUDIT_PROJECTION_VERSION =
  "growth-audit.0.3.0" as const;

/**
 * The current frozen projection version of a deliberate full Growth Audit.
 * Latest frontstage reads use only this generation so historical audits are
 * never reinterpreted under current rules.
 */
export const GROWTH_AUDIT_PROJECTION_VERSION =
  "growth-audit.0.3.1" as const;

/**
 * The frozen projection version of a targeted Action recheck. A recheck creates
 * its own immutable audit run under this version; it is read only by the Results
 * comparison surface and is excluded from the primary audit read paths.
 */
export const GROWTH_AUDIT_RECHECK_PROJECTION_VERSION =
  "growth-audit-recheck.0.3.0";

export interface AuditRunRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly diagnostic_run_id: string;
  readonly capability_run_id: string;
  readonly scope_kind: string;
  readonly scope_key: string;
  readonly projection_version: string;
  readonly created_at: string;
}

export interface AuditModuleResultRow {
  readonly audit_run_id: string;
  readonly module_id: string;
  readonly coverage_state: string;
  readonly summary: Record<string, unknown>;
  readonly created_at: string;
}

export interface AuditModuleResultInsert {
  readonly moduleId: string;
  readonly coverageState: "available" | "partial" | "stale" | "no_data";
  readonly summary: Record<string, unknown>;
}

export class AuditRunsRepository extends Repository {
  async create(values: {
    workspaceId: string;
    projectId: string;
    diagnosticRunId: string;
    capabilityRunId: string;
    scopeKind: "site" | "template" | "url";
    scopeKey: string;
    projectionVersion: string;
  }): Promise<AuditRunRow> {
    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    const [inserted] = await this.exec
      .insert(auditRuns)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        diagnostic_run_id: values.diagnosticRunId,
        capability_run_id: values.capabilityRunId,
        scope_kind: values.scopeKind,
        scope_key: values.scopeKey,
        projection_version: values.projectionVersion,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted as AuditRunRow;

    const existing = await this.findByDiagnosticRunId(
      scope,
      values.diagnosticRunId,
    );
    if (
      existing &&
      existing.workspace_id === values.workspaceId &&
      existing.project_id === values.projectId &&
      existing.capability_run_id === values.capabilityRunId &&
      existing.scope_kind === values.scopeKind &&
      existing.scope_key === values.scopeKey &&
      existing.projection_version === values.projectionVersion
    ) {
      return existing;
    }
    throw new Error("audit run replay conflicts with immutable values");
  }

  async findById(scope: ProjectScope, id: string): Promise<AuditRunRow | null> {
    const rows = await this.exec
      .select()
      .from(auditRuns)
      .where(and(projectPredicate(auditRuns, scope), eq(auditRuns.id, id)))
      .limit(1);
    return (rows[0] as AuditRunRow | undefined) ?? null;
  }

  async findByDiagnosticRunId(
    scope: ProjectScope,
    diagnosticRunId: string,
  ): Promise<AuditRunRow | null> {
    const rows = await this.exec
      .select()
      .from(auditRuns)
      .where(
        and(
          projectPredicate(auditRuns, scope),
          eq(auditRuns.diagnostic_run_id, diagnosticRunId),
        ),
      )
      .limit(1);
    return (rows[0] as AuditRunRow | undefined) ?? null;
  }

  /**
   * The latest audit run for one projection version. The primary audit read
   * paths pass {@link GROWTH_AUDIT_PROJECTION_VERSION} so a targeted recheck
   * (its own {@link GROWTH_AUDIT_RECHECK_PROJECTION_VERSION} run) never becomes
   * the "latest audit" and hijacks the Overview or module projections.
   */
  async findLatestByProjectionVersion(
    scope: ProjectScope,
    projectionVersion: string,
  ): Promise<AuditRunRow | null> {
    const rows = await this.exec
      .select()
      .from(auditRuns)
      .where(
        and(
          projectPredicate(auditRuns, scope),
          eq(auditRuns.projection_version, projectionVersion),
        ),
      )
      .orderBy(desc(auditRuns.created_at), desc(auditRuns.id))
      .limit(1);
    return (rows[0] as AuditRunRow | undefined) ?? null;
  }

  /** Worker completion write; the composite key makes every module append-once. */
  async insertModuleResults(
    values: {
      auditRunId: string;
      workspaceId: string;
      projectId: string;
    },
    results: readonly AuditModuleResultInsert[],
  ): Promise<void> {
    if (results.length === 0) return;
    const scope = {
      workspaceId: values.workspaceId,
      projectId: values.projectId,
    };
    if (!(await this.findById(scope, values.auditRunId))) {
      throw new Error("audit module result canonical scope mismatch");
    }
    for (const result of results) {
      const [inserted] = await this.exec
        .insert(auditModuleResults)
        .values({
          audit_run_id: values.auditRunId,
          module_id: result.moduleId,
          coverage_state: result.coverageState,
          summary: result.summary,
        })
        .onConflictDoNothing({
          target: [
            auditModuleResults.audit_run_id,
            auditModuleResults.module_id,
          ],
        })
        .returning({ module_id: auditModuleResults.module_id });
      if (inserted) continue;

      const existing = await this.findModuleResult(
        scope,
        values.auditRunId,
        result.moduleId,
      );
      if (
        existing &&
        existing.coverage_state === result.coverageState &&
        isDeepStrictEqual(existing.summary, result.summary)
      ) {
        continue;
      }
      throw new Error(
        "audit module result replay conflicts with immutable values",
      );
    }
  }

  private async findModuleResult(
    scope: ProjectScope,
    auditRunId: string,
    moduleId: string,
  ): Promise<AuditModuleResultRow | null> {
    const rows = (await this.exec
      .select({
        audit_run_id: auditModuleResults.audit_run_id,
        module_id: auditModuleResults.module_id,
        coverage_state: auditModuleResults.coverage_state,
        summary: auditModuleResults.summary,
        created_at: auditModuleResults.created_at,
      })
      .from(auditModuleResults)
      .innerJoin(auditRuns, eq(auditRuns.id, auditModuleResults.audit_run_id))
      .where(
        and(
          projectPredicate(auditRuns, scope),
          eq(auditModuleResults.audit_run_id, auditRunId),
          eq(auditModuleResults.module_id, moduleId),
        ),
      )
      .limit(1)) as AuditModuleResultRow[];
    return rows[0] ?? null;
  }

  /** Customer read: scope is applied in the same SQL statement as the child rows. */
  async listModuleResults(
    scope: ProjectScope,
    auditRunId: string,
  ): Promise<AuditModuleResultRow[]> {
    return (await this.exec
      .select({
        audit_run_id: auditModuleResults.audit_run_id,
        module_id: auditModuleResults.module_id,
        coverage_state: auditModuleResults.coverage_state,
        summary: auditModuleResults.summary,
        created_at: auditModuleResults.created_at,
      })
      .from(auditModuleResults)
      .innerJoin(auditRuns, eq(auditRuns.id, auditModuleResults.audit_run_id))
      .where(
        and(
          projectPredicate(auditRuns, scope),
          eq(auditModuleResults.audit_run_id, auditRunId),
        ),
      )
      .orderBy(asc(auditModuleResults.module_id))) as AuditModuleResultRow[];
  }
}
