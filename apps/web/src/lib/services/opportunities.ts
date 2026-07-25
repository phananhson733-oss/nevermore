import type { GrowthOpportunity as GrowthOpportunityDto } from "@sf/contracts";
import {
  ActionsRepository,
  FindingsRepository,
  FindingTargetsRepository,
  GrowthMapReadRepository,
  ProjectsRepository,
  TopicClusterReadRepository,
  type ActionRow,
  type Executor,
  type FindingRow,
  type FindingTargetRow,
  type GrowthMapReadableRunRow,
  type ProjectScope,
  type TopicClusterSupportingFindingRow,
  type WorkspaceScope,
} from "@sf/db";
import type { UiLocale } from "@sf/i18n";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { loadEvidenceByFinding } from "./diagnostic-load";
import { assertValidTimestampUuidListCursor } from "./list-cursor";
import {
  buildOpportunity,
  isOpportunityRule,
  primaryTopicClusterKey,
  type OpportunityActionInput,
  type OpportunityFindingInput,
  type OpportunityTargetInput,
} from "./opportunities-projection";
import {
  groupTopicClusterSupportRows,
  type TopicClusterSupportRow,
} from "./topic-cluster-projection";

/**
 * Growth Opportunity read-model service (Slice 1). It projects the latest
 * readable diagnostic run's Findings, resolved FindingTargets, canonical
 * Evidence, and Finding-owned Actions into the traceable Opportunity contract.
 * It is strictly read-only: confirmation flows through the existing
 * `PATCH .../findings/{primaryFindingId}` mutation, never a new endpoint here.
 */

export const MAX_OPPORTUNITY_PAGE_SIZE = 100;
const DEFAULT_OPPORTUNITY_PAGE_SIZE = 50;

/** Request-bound opportunity read scope; UI locale controls chrome copy only. */
export interface OpportunityReadScope extends WorkspaceScope {
  readonly uiLocale: UiLocale;
}

export interface OpportunityListOptions {
  readonly limit: number;
  readonly cursor: string | null;
  /** Test/SSR clock seam; never serialized into the response. */
  readonly now?: Date;
}

export interface ProjectOpportunityListResult {
  readonly projectId: string;
  readonly siteId: string;
  readonly diagnosticRunId: string;
  readonly data: GrowthOpportunityDto[];
  readonly meta: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasNext: boolean;
  };
}

export interface ProjectOpportunityDetailResult {
  readonly projectId: string;
  readonly siteId: string;
  readonly diagnosticRunId: string;
  readonly data: GrowthOpportunityDto;
}

function noReadableRun(): never {
  throw new ProblemError(
    "NOT_FOUND",
    "No completed growth audit is available for this project.",
  );
}

function validNow(now: Date): number {
  const ms = now.getTime();
  if (!Number.isFinite(ms)) throw new RangeError("now must be a valid Date");
  return ms;
}

function toFindingInput(row: FindingRow): OpportunityFindingInput {
  return {
    id: row.id,
    ruleId: row.rule_id,
    reviewState: row.review_state,
    active: row.active,
    title: row.summary,
  };
}

function toTargetInput(row: FindingTargetRow): OpportunityTargetInput {
  return {
    relation: row.relation,
    targetKind: row.target_kind,
    targetRef: row.target_ref,
    resolutionState: row.resolution_state,
    sitePageId: row.site_page_id,
    pageSnapshotId: row.page_snapshot_id,
  };
}

function toActionInput(row: ActionRow): OpportunityActionInput {
  return {
    id: row.id,
    sourceFindingId: row.source_finding_id,
    status: row.status,
  };
}

function toTopicClusterSupportRow(
  row: TopicClusterSupportingFindingRow,
): TopicClusterSupportRow {
  return {
    clusterKey: row.cluster_key,
    sitePageId: row.site_page_id,
    findingId: row.finding_id,
    mappingConfirmed: row.mapping_review_state === "confirmed",
  };
}

/**
 * One bounded TopicCluster read for a whole Opportunity page. The cluster keys
 * come from `primaryTopicClusterKey`, so this never loads a cluster no
 * Opportunity on the page is actually projected onto, and a page without a
 * single topic Opportunity issues no query at all.
 */
async function loadTopicClusterRows(
  exec: Executor,
  scope: ProjectScope,
  diagnosticRunId: string,
  clusterKeys: readonly string[],
): Promise<Map<string, readonly TopicClusterSupportRow[]>> {
  if (clusterKeys.length === 0) return new Map();
  const rows = await new TopicClusterReadRepository(exec).listSupportingFindings(
    scope,
    diagnosticRunId,
    clusterKeys,
  );
  return groupTopicClusterSupportRows(rows.map(toTopicClusterSupportRow));
}

function groupTargets(
  targets: readonly FindingTargetRow[],
): Map<string, FindingTargetRow[]> {
  const byFinding = new Map<string, FindingTargetRow[]>();
  for (const target of targets) {
    const rows = byFinding.get(target.finding_id) ?? [];
    rows.push(target);
    byFinding.set(target.finding_id, rows);
  }
  return byFinding;
}

function firstActiveActionByFinding(
  actions: readonly ActionRow[],
): Map<string, ActionRow> {
  const byFinding = new Map<string, ActionRow>();
  for (const action of actions) {
    if (!byFinding.has(action.source_finding_id)) {
      byFinding.set(action.source_finding_id, action);
    }
  }
  return byFinding;
}

async function loadReadableRun(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
): Promise<{ projectScope: ProjectScope; run: GrowthMapReadableRunRow }> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const project = await new ProjectsRepository(exec).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  const run = await new GrowthMapReadRepository(exec).findLatestReadableRun(
    projectScope,
  );
  if (!run) noReadableRun();
  return { projectScope, run };
}

async function listOpportunitiesInSnapshot(
  exec: Executor,
  scope: OpportunityReadScope,
  projectId: string,
  opts: OpportunityListOptions,
): Promise<ProjectOpportunityListResult> {
  const now = validNow(opts.now ?? new Date());
  const { projectScope, run } = await loadReadableRun(exec, scope, projectId);

  const page = await new FindingsRepository(exec).list(projectScope, {
    limit: opts.limit,
    cursor: opts.cursor,
    activeOnly: true,
  });
  const runFindings = page.rows.filter(
    (finding) =>
      finding.last_seen_run_id === run.id && isOpportunityRule(finding.rule_id),
  );
  const findingIds = runFindings.map((finding) => finding.id);

  const targets = await new FindingTargetsRepository(exec).listForFindings(
    projectScope,
    run.id,
    findingIds,
  );
  const evidenceByFinding = await loadEvidenceByFinding(
    exec,
    projectScope,
    findingIds,
  );
  const actionRows = await new GrowthMapReadRepository(exec).listActiveActions(
    projectScope,
    findingIds,
  );
  const targetsByFinding = groupTargets(targets);
  const actionByFinding = firstActiveActionByFinding(actionRows);
  const targetInputsByFinding = new Map<string, OpportunityTargetInput[]>(
    runFindings.map((finding) => [
      finding.id,
      (targetsByFinding.get(finding.id) ?? []).map(toTargetInput),
    ]),
  );
  const topicClusterRows = await loadTopicClusterRows(
    exec,
    projectScope,
    run.id,
    [
      ...new Set(
        [...targetInputsByFinding.values()]
          .map(primaryTopicClusterKey)
          .filter((key): key is string => key !== null),
      ),
    ],
  );

  const data: GrowthOpportunityDto[] = [];
  for (const finding of runFindings) {
    const action = actionByFinding.get(finding.id);
    const opportunity = buildOpportunity({
      finding: toFindingInput(finding),
      targets: targetInputsByFinding.get(finding.id) ?? [],
      evidence: evidenceByFinding.get(finding.id) ?? [],
      action: action ? toActionInput(action) : null,
      diagnosticRunId: run.id,
      now,
      topicClusterRows,
    });
    if (opportunity) data.push(opportunity);
  }

  return {
    projectId,
    siteId: run.site_id,
    diagnosticRunId: run.id,
    data,
    meta: {
      limit: opts.limit,
      nextCursor: page.nextCursor,
      hasNext: page.nextCursor !== null,
    },
  };
}

/** `listProjectOpportunities` (Slice 1). One bounded cursor page of Opportunities. */
export async function listProjectOpportunities(
  scope: OpportunityReadScope,
  projectId: string,
  opts: OpportunityListOptions,
  exec?: Executor,
): Promise<ProjectOpportunityListResult> {
  assertValidTimestampUuidListCursor(opts.cursor);
  if (
    !Number.isSafeInteger(opts.limit) ||
    opts.limit < 1 ||
    opts.limit > MAX_OPPORTUNITY_PAGE_SIZE
  ) {
    throw new RangeError("Invalid opportunity list options");
  }
  if (exec) return listOpportunitiesInSnapshot(exec, scope, projectId, opts);
  return getDb().db.transaction(
    (tx) => listOpportunitiesInSnapshot(tx, scope, projectId, opts),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function getOpportunityInSnapshot(
  exec: Executor,
  scope: OpportunityReadScope,
  projectId: string,
  opportunityId: string,
  now: number,
): Promise<ProjectOpportunityDetailResult> {
  const { projectScope, run } = await loadReadableRun(exec, scope, projectId);

  const finding = await new FindingsRepository(exec).findById(
    projectScope,
    opportunityId,
  );
  if (
    !finding ||
    !finding.active ||
    finding.last_seen_run_id !== run.id ||
    !isOpportunityRule(finding.rule_id)
  ) {
    throw new ProblemError(
      "NOT_FOUND",
      "This opportunity is not part of the latest growth audit.",
    );
  }

  const targets = await new FindingTargetsRepository(exec).listForFindings(
    projectScope,
    run.id,
    [finding.id],
  );
  const evidenceByFinding = await loadEvidenceByFinding(exec, projectScope, [
    finding.id,
  ]);
  const action = await new ActionsRepository(exec).findActiveByFinding(
    projectScope,
    finding.id,
  );

  const targetInputs = targets.map(toTargetInput);
  const clusterKey = primaryTopicClusterKey(targetInputs);
  const topicClusterRows = await loadTopicClusterRows(
    exec,
    projectScope,
    run.id,
    clusterKey === null ? [] : [clusterKey],
  );

  const opportunity = buildOpportunity({
    finding: toFindingInput(finding),
    targets: targetInputs,
    evidence: evidenceByFinding.get(finding.id) ?? [],
    action: action ? toActionInput(action) : null,
    diagnosticRunId: run.id,
    now,
    topicClusterRows,
  });
  if (!opportunity) {
    throw new ProblemError(
      "NOT_FOUND",
      "This finding is not an actionable opportunity.",
    );
  }

  return {
    projectId,
    siteId: run.site_id,
    diagnosticRunId: run.id,
    data: opportunity,
  };
}

/** `getProjectOpportunity` (Slice 1). One Opportunity keyed by its primary Finding. */
export async function getProjectOpportunity(
  scope: OpportunityReadScope,
  projectId: string,
  opportunityId: string,
  exec?: Executor,
): Promise<ProjectOpportunityDetailResult> {
  const now = validNow(new Date());
  if (exec) {
    return getOpportunityInSnapshot(exec, scope, projectId, opportunityId, now);
  }
  return getDb().db.transaction(
    (tx) => getOpportunityInSnapshot(tx, scope, projectId, opportunityId, now),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Documented default page size for the opportunities read surface. */
export { DEFAULT_OPPORTUNITY_PAGE_SIZE };
