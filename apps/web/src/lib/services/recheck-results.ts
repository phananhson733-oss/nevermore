import {
  ActionRecheckResultsResponse,
  OpportunityRuleId,
  type ActionRecheckResultsResponse as ActionRecheckResultsResponseDto,
  type ActionRecheckRuleComparison,
  type RecheckComparisonState,
  type RecheckDisposition,
  type RecheckRuleStatus,
} from "@sf/contracts";
import {
  ActionsRepository,
  AsyncRunsRepository,
  AuditRunsRepository,
  canonicalUtcTimestamptz,
  DiagnosticRunsRepository,
  FindingsRepository,
  GROWTH_AUDIT_RECHECK_PROJECTION_VERSION,
  type AuditRunRow,
  type Executor,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import type { UiLocale } from "@sf/i18n";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";

/**
 * Recheck Results projection (Slice 1, Task 8). A recheck compares two immutable
 * runs strictly on the confirmed Action's technical rule condition. This surface
 * is read-only and deliberately makes no traffic, rank, revenue, or AI-citation
 * claim: it reports a technical condition state only ("Technical condition
 * verified"), never impact or lift. The prior run is untouched.
 */

/** Request-bound read scope; the UI locale controls the technical copy only. */
export interface ResultsReadScope extends WorkspaceScope {
  readonly uiLocale: UiLocale;
}

interface RecheckResultsCopy {
  readonly labels: Record<RecheckComparisonState, string>;
  readonly insufficientDataLimitation: string;
  readonly noRecheck: string;
}

function isZhCn(locale: string): boolean {
  return locale.toLowerCase() === "zh-cn";
}

/** Technical-condition copy. No impact/lift wording is ever produced here. */
export function recheckResultsCopy(uiLocale: UiLocale): RecheckResultsCopy {
  if (isZhCn(uiLocale)) {
    return {
      labels: {
        verified: "技术条件已验证",
        observed: "技术条件仍然存在",
        insufficient_data: "数据不足",
      },
      insufficientDataLimitation:
        "本次复查未能观测到该技术条件，因此未作出验证结论。",
      noRecheck: "尚未对任何 Action 运行复查。",
    };
  }
  return {
    labels: {
      verified: "Technical condition verified",
      observed: "Technical condition still observed",
      insufficient_data: "Insufficient data to verify the technical condition",
    },
    insufficientDataLimitation:
      "The recheck could not observe this technical condition, so no verification is claimed.",
    noRecheck: "No recheck has been run for this project.",
  };
}

interface RuleComparison {
  readonly state: RecheckComparisonState;
  readonly disposition: RecheckDisposition;
}

/**
 * Compare one confirmed rule condition across the prior and current runs. The
 * prior status must be `candidate`: the recheck only exists for a confirmed
 * Action whose Finding failed the rule in the prior run. The current status
 * drives the three technical states (裁决 1): a `pass` verifies the condition
 * resolved, a `candidate` shows it unchanged, and a `skipped`/`inconclusive`
 * observation is honest insufficient data.
 */
export function compareRule(
  priorStatus: RecheckRuleStatus,
  currentStatus: RecheckRuleStatus,
): RuleComparison {
  if (priorStatus !== "candidate") {
    throw new Error(
      "recheck comparison requires a prior candidate rule status",
    );
  }
  switch (currentStatus) {
    case "pass":
      return { state: "verified", disposition: "resolved" };
    case "candidate":
      return { state: "observed", disposition: "unchanged" };
    case "skipped":
    case "inconclusive":
      return { state: "insufficient_data", disposition: "unknown" };
    default:
      throw new Error("unknown recheck rule status");
  }
}

function corruptResults(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "The recheck Results projection failed its provenance checks.",
  );
}

function assertRuleStatus(status: string): RecheckRuleStatus {
  if (
    status === "pass" ||
    status === "candidate" ||
    status === "skipped" ||
    status === "inconclusive"
  ) {
    return status;
  }
  corruptResults();
}

function assertRuleVersion(version: number): 1 | 2 {
  if (version === 1 || version === 2) return version;
  corruptResults();
}

function observedAt(
  completedAt: string | null,
  createdAt: string,
): string {
  return canonicalUtcTimestamptz(completedAt ?? createdAt);
}

/** Read the recheck request pointers frozen on the recheck run's payload. */
function readRecheckPayload(payload: Record<string, unknown>): {
  readonly priorRunId: string;
  readonly actionId: string;
} {
  if (payload["operation"] !== "growth_audit_recheck") corruptResults();
  const priorRunId = payload["priorRunId"];
  const actionId = payload["actionId"];
  if (typeof priorRunId !== "string" || typeof actionId !== "string") {
    corruptResults();
  }
  return { priorRunId, actionId };
}

async function projectResults(
  exec: Executor,
  scope: ResultsReadScope,
  projectId: string,
): Promise<ActionRecheckResultsResponseDto> {
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };
  const copy = recheckResultsCopy(scope.uiLocale);

  // The current run is the latest recheck; the primary audit is never selected.
  const currentRun = await new AuditRunsRepository(
    exec,
  ).findLatestByProjectionVersion(
    projectScope,
    GROWTH_AUDIT_RECHECK_PROJECTION_VERSION,
  );
  if (!currentRun) {
    throw new ProblemError("NOT_FOUND", copy.noRecheck);
  }
  const currentAsyncRun = await new AsyncRunsRepository(exec).findById(
    projectScope,
    currentRun.capability_run_id,
  );
  if (!currentAsyncRun) corruptResults();
  const { priorRunId, actionId } = readRecheckPayload(
    currentAsyncRun.request_payload,
  );

  // Scope-check the prior run explicitly: listRuleResults takes no scope, so the
  // audit-run scope gate is the only tenant boundary on the prior rule ledger.
  const priorRun = await new AuditRunsRepository(exec).findById(
    projectScope,
    priorRunId,
  );
  if (!priorRun) corruptResults();
  const priorAsyncRun = await new AsyncRunsRepository(exec).findById(
    projectScope,
    priorRun.capability_run_id,
  );
  if (!priorAsyncRun) corruptResults();

  const action = await new ActionsRepository(exec).findById(
    projectScope,
    actionId,
  );
  if (!action) corruptResults();
  const finding = await new FindingsRepository(exec).findById(
    projectScope,
    action.source_finding_id,
  );
  if (!finding) corruptResults();
  const ruleId = OpportunityRuleId.safeParse(finding.rule_id);
  if (!ruleId.success) corruptResults();

  const rules = await buildRuleComparisons(exec, {
    priorRun,
    currentRun,
    ruleId: ruleId.data,
    copy,
  });

  const limitations = rules
    .filter((rule) => rule.state === "insufficient_data")
    .map(() => copy.insufficientDataLimitation);

  const result = {
    priorRunId: priorRun.id,
    currentRunId: currentRun.id,
    priorObservedAt: observedAt(
      priorAsyncRun.completed_at,
      priorRun.created_at,
    ),
    currentObservedAt: observedAt(
      currentAsyncRun.completed_at,
      currentRun.created_at,
    ),
    rules,
    limitations: [...new Set(limitations)],
  };
  const parsed = ActionRecheckResultsResponse.safeParse(result);
  if (!parsed.success) corruptResults();
  return parsed.data;
}

async function buildRuleComparisons(
  exec: Executor,
  input: {
    readonly priorRun: AuditRunRow;
    readonly currentRun: AuditRunRow;
    readonly ruleId: OpportunityRuleId;
    readonly copy: RecheckResultsCopy;
  },
): Promise<ActionRecheckRuleComparison[]> {
  const repo = new DiagnosticRunsRepository(exec);
  const [priorRules, currentRules] = await Promise.all([
    repo.listRuleResults(input.priorRun.diagnostic_run_id),
    repo.listRuleResults(input.currentRun.diagnostic_run_id),
  ]);
  const priorRule = priorRules.find((rule) => rule.rule_id === input.ruleId);
  const currentRule = currentRules.find(
    (rule) => rule.rule_id === input.ruleId,
  );
  if (!priorRule || !currentRule) corruptResults();

  const priorStatus = assertRuleStatus(priorRule.status);
  const currentStatus = assertRuleStatus(currentRule.status);
  const { state, disposition } = compareRule(priorStatus, currentStatus);
  return [
    {
      ruleId: input.ruleId,
      ruleVersion: assertRuleVersion(currentRule.rule_version),
      priorStatus,
      currentStatus,
      state,
      disposition,
      label: input.copy.labels[state],
    },
  ];
}

/** `getProjectResults` (Slice 1). The latest recheck's read-only comparison. */
export async function getProjectResults(
  scope: ResultsReadScope,
  projectId: string,
  exec?: Executor,
): Promise<ActionRecheckResultsResponseDto> {
  if (exec) return projectResults(exec, scope, projectId);
  return getDb().db.transaction(
    (tx) => projectResults(tx, scope, projectId),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
