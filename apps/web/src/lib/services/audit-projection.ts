import {
  AuditLensSummary,
  AuditModuleId,
  AuditModuleSummary,
  FrontstageLensId,
  GrowthAuditResponse,
  RULE_OPPORTUNITY_PROJECTION,
  type AuditModuleId as AuditModuleIdType,
  type FrontstageLensId as FrontstageLensIdType,
  type OpportunityRuleId,
} from "@sf/contracts";
import {
  AsyncRunsRepository,
  AuditRunsRepository,
  canonicalUtcTimestamptz,
  DiagnosticRunsRepository,
  FindingsRepository,
  GROWTH_AUDIT_PROJECTION_VERSION,
  ProjectsRepository,
  type AuditModuleResultRow,
  type AuditRunRow,
  type Executor,
  type FindingRow,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import type { UiLocale } from "@sf/i18n";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { loadEvidenceByFinding } from "./diagnostic-load";

/**
 * Growth Audit read-model projection (Slice 1). Status is projected from the
 * canonical async run; the eight customer-facing modules are the worker's
 * persisted `audit_module_results` summaries; the three frontstage lenses are
 * derived from the run's evidence-bearing Findings grouped by the frozen
 * rule -> lens policy in {@link RULE_OPPORTUNITY_PROJECTION}. This surface is
 * strictly read-only: it never writes an Action, audit row, or module row.
 */

const AUDIT_STATUS = new Set<GrowthAuditResponse["status"]>([
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

const OPPORTUNITY_RULES = new Set<string>(
  Object.keys(RULE_OPPORTUNITY_PROJECTION),
);

/** Request-bound audit read scope; the UI locale controls chrome copy only. */
export interface AuditReadScope extends WorkspaceScope {
  readonly uiLocale: UiLocale;
}

interface AuditProjectionCopy {
  readonly pending: string;
  readonly incomplete: string;
  readonly lensNoData: string;
  readonly lensPartial: string;
}

function isZhCn(locale: string): boolean {
  return locale.toLowerCase() === "zh-cn";
}

/** Chrome copy for synthesized coverage limitations; persisted copy is untouched. */
export function auditProjectionCopy(uiLocale: UiLocale): AuditProjectionCopy {
  if (isZhCn(uiLocale)) {
    return {
      pending: "增长审计仍在运行，覆盖尚未生成。",
      incomplete: "本次增长审计未完成，未生成任何覆盖。",
      lensNoData: "本次运行未观测到该视角的审计信号。",
      lensPartial: "该视角的部分数据集不可用，覆盖为部分。",
    };
  }
  return {
    pending:
      "The growth audit is still running; coverage is not yet available.",
    incomplete:
      "The growth audit did not complete; no coverage was materialized.",
    lensNoData: "No audit signals were observed for this lens in this run.",
    lensPartial:
      "Some datasets for this lens were unavailable; coverage is partial.",
  };
}

function corruptAudit(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "The frozen Growth Audit projection failed its provenance checks.",
  );
}

function assertAuditStatus(status: string): GrowthAuditResponse["status"] {
  if (!AUDIT_STATUS.has(status as GrowthAuditResponse["status"])) {
    corruptAudit();
  }
  return status as GrowthAuditResponse["status"];
}

function isTerminal(status: GrowthAuditResponse["status"]): boolean {
  return status !== "queued" && status !== "running";
}

/** Parse one persisted module summary and re-check its row-level provenance. */
export function parseAuditModuleSummary(
  row: AuditModuleResultRow,
): AuditModuleSummary {
  const parsed = AuditModuleSummary.safeParse(row.summary);
  if (
    !parsed.success ||
    parsed.data.moduleId !== row.module_id ||
    parsed.data.coverageState !== row.coverage_state
  ) {
    corruptAudit();
  }
  return parsed.data;
}

/** Every module in the canonical taxonomy, projected from persisted rows. */
export function auditModulesFromRows(
  rows: readonly AuditModuleResultRow[],
): AuditModuleSummary[] {
  if (rows.length !== AuditModuleId.options.length) corruptAudit();
  const byId = new Map<string, AuditModuleSummary>();
  for (const row of rows) {
    if (byId.has(row.module_id)) corruptAudit();
    byId.set(row.module_id, parseAuditModuleSummary(row));
  }
  return AuditModuleId.options.map((moduleId) => {
    const summary = byId.get(moduleId);
    if (!summary) corruptAudit();
    return summary;
  });
}

/** A `no_data` module carries no observed coverage, only an honest limitation. */
export function noDataModule(
  moduleId: AuditModuleIdType,
  limitation: string,
): AuditModuleSummary {
  return {
    moduleId,
    coverageState: "no_data",
    evidenceCount: 0,
    findingCount: 0,
    sourceProviders: [],
    latestObservedAt: null,
    limitations: [limitation],
  };
}

function noDataModules(limitation: string): AuditModuleSummary[] {
  return AuditModuleId.options.map((moduleId) =>
    noDataModule(moduleId, limitation),
  );
}

/** One evidence-bearing Finding's rule and evidence count for lens rollups. */
export interface AuditLensFindingInput {
  readonly ruleId: OpportunityRuleId;
  readonly evidenceCount: number;
}

function noDataLens(
  lensId: FrontstageLensIdType,
  limitation: string,
): AuditLensSummary {
  return {
    lensId,
    coverageState: "no_data",
    evidenceCount: 0,
    findingCount: 0,
    limitations: [limitation],
  };
}

function noDataLenses(limitation: string): AuditLensSummary[] {
  return FrontstageLensId.options.map((lensId) =>
    noDataLens(lensId, limitation),
  );
}

/**
 * Derive the three frontstage lens summaries from the run's evidence-bearing
 * Findings. Modules and lenses partition the executable rules differently
 * (a module can feed two lenses), so the lens rollup is computed at rule
 * granularity from {@link RULE_OPPORTUNITY_PROJECTION}, never from module rows.
 */
export function deriveAuditLenses(
  findings: readonly AuditLensFindingInput[],
  opts: { readonly partial: boolean; readonly copy: AuditProjectionCopy },
): AuditLensSummary[] {
  return FrontstageLensId.options.map((lensId) => {
    const contributing = findings.filter(
      (finding) =>
        finding.evidenceCount > 0 &&
        RULE_OPPORTUNITY_PROJECTION[finding.ruleId].lens === lensId,
    );
    if (contributing.length === 0) {
      return noDataLens(lensId, opts.copy.lensNoData);
    }
    const evidenceCount = contributing.reduce(
      (sum, finding) => sum + finding.evidenceCount,
      0,
    );
    return {
      lensId,
      coverageState: opts.partial ? "partial" : "available",
      evidenceCount,
      findingCount: contributing.length,
      limitations: opts.partial ? [opts.copy.lensPartial] : [],
    } satisfies AuditLensSummary;
  });
}

function coverageAndLimitations(
  modules: readonly AuditModuleSummary[],
  lenses: readonly AuditLensSummary[],
): string[] {
  const seen = new Set<string>();
  for (const module of modules) {
    for (const limitation of module.limitations) seen.add(limitation);
  }
  for (const lens of lenses) {
    for (const limitation of lens.limitations) seen.add(limitation);
  }
  return [...seen].slice(0, 200);
}

/** Load the run's evidence-bearing Finding inputs for the lens rollup. */
async function loadLensFindingInputs(
  exec: Executor,
  scope: ProjectScope,
  runId: string,
): Promise<AuditLensFindingInput[]> {
  const repo = new FindingsRepository(exec);
  const runFindings: FindingRow[] = [];
  let cursor: string | null = null;
  do {
    const page = await repo.list(scope, {
      limit: 200,
      cursor,
      activeOnly: true,
    });
    for (const finding of page.rows) {
      if (
        finding.last_seen_run_id === runId &&
        OPPORTUNITY_RULES.has(finding.rule_id)
      ) {
        runFindings.push(finding);
      }
    }
    cursor = page.nextCursor;
  } while (cursor !== null);

  const evidenceByFinding = await loadEvidenceByFinding(
    exec,
    scope,
    runFindings.map((finding) => finding.id),
  );
  return runFindings.map((finding) => ({
    ruleId: finding.rule_id as OpportunityRuleId,
    evidenceCount: (evidenceByFinding.get(finding.id) ?? []).length,
  }));
}

async function projectAudit(
  exec: Executor,
  scope: AuditReadScope,
  projectId: string,
): Promise<{
  readonly auditRun: AuditRunRow;
  readonly response: GrowthAuditResponse;
}> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const project = await new ProjectsRepository(exec).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");

  const auditRun = await new AuditRunsRepository(
    exec,
  ).findLatestByProjectionVersion(
    projectScope,
    GROWTH_AUDIT_PROJECTION_VERSION,
  );
  if (!auditRun) {
    throw new ProblemError(
      "NOT_FOUND",
      "No growth audit has been run for this project.",
    );
  }
  const asyncRun = await new AsyncRunsRepository(exec).findById(
    projectScope,
    auditRun.capability_run_id,
  );
  if (!asyncRun) corruptAudit();
  const diagnosticRun = await new DiagnosticRunsRepository(exec).findById(
    projectScope,
    auditRun.diagnostic_run_id,
  );
  if (!diagnosticRun) corruptAudit();

  const status = assertAuditStatus(asyncRun.status);
  const completedAt =
    asyncRun.completed_at === null
      ? null
      : canonicalUtcTimestamptz(asyncRun.completed_at);
  const copy = auditProjectionCopy(scope.uiLocale);
  const moduleRows = await new AuditRunsRepository(exec).listModuleResults(
    projectScope,
    auditRun.id,
  );

  let modules: AuditModuleSummary[];
  let lenses: AuditLensSummary[];
  if (moduleRows.length === 0) {
    const limitation = isTerminal(status) ? copy.incomplete : copy.pending;
    modules = noDataModules(limitation);
    lenses = noDataLenses(limitation);
  } else {
    modules = auditModulesFromRows(moduleRows);
    const inputs = await loadLensFindingInputs(
      exec,
      projectScope,
      auditRun.diagnostic_run_id,
    );
    lenses = deriveAuditLenses(inputs, {
      partial: status === "partial",
      copy,
    });
  }

  const result = {
    auditRunId: auditRun.id,
    projectId,
    siteId: diagnosticRun.site_id,
    status,
    outputLocale: diagnosticRun.output_locale,
    completedAt,
    modules,
    lenses,
    coverageAndLimitations: coverageAndLimitations(modules, lenses),
  };
  const parsed = GrowthAuditResponse.safeParse(result);
  if (!parsed.success) corruptAudit();
  return { auditRun, response: parsed.data };
}

/** `getProjectGrowthAudit` (Slice 1). The latest audit run's read-only projection. */
export async function getProjectAudit(
  scope: AuditReadScope,
  projectId: string,
  exec?: Executor,
): Promise<GrowthAuditResponse> {
  if (exec) return (await projectAudit(exec, scope, projectId)).response;
  return getDb().db.transaction(
    async (tx) => (await projectAudit(tx, scope, projectId)).response,
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function projectAuditModule(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  moduleId: AuditModuleIdType,
): Promise<AuditModuleSummary> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const project = await new ProjectsRepository(exec).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");

  const auditRun = await new AuditRunsRepository(
    exec,
  ).findLatestByProjectionVersion(
    projectScope,
    GROWTH_AUDIT_PROJECTION_VERSION,
  );
  if (!auditRun) {
    throw new ProblemError(
      "NOT_FOUND",
      "No growth audit has been run for this project.",
    );
  }
  const asyncRun = await new AsyncRunsRepository(exec).findById(
    projectScope,
    auditRun.capability_run_id,
  );
  if (!asyncRun) corruptAudit();
  const status = assertAuditStatus(asyncRun.status);

  const moduleRows = await new AuditRunsRepository(exec).listModuleResults(
    projectScope,
    auditRun.id,
  );
  if (moduleRows.length === 0) {
    const copy = auditProjectionCopy(
      "uiLocale" in scope ? (scope as AuditReadScope).uiLocale : "en",
    );
    const limitation = isTerminal(status) ? copy.incomplete : copy.pending;
    return noDataModule(moduleId, limitation);
  }
  const row = moduleRows.find((candidate) => candidate.module_id === moduleId);
  if (!row) corruptAudit();
  return parseAuditModuleSummary(row);
}

/** `getProjectAuditModule` (Slice 1). One module's read-only coverage summary. */
export async function getProjectAuditModule(
  scope: AuditReadScope,
  projectId: string,
  moduleId: AuditModuleIdType,
  exec?: Executor,
): Promise<AuditModuleSummary> {
  if (exec) return projectAuditModule(exec, scope, projectId, moduleId);
  return getDb().db.transaction(
    (tx) => projectAuditModule(tx, scope, projectId, moduleId),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
