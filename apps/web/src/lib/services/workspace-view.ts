import {
  ActionsRepository,
  AsyncRunsRepository,
  FindingsRepository,
  GrowthMapReadRepository,
  MAX_GROWTH_MAP_URL_PAGE_SIZE,
  ProjectsRepository,
  type ActionRow,
  type Executor,
  type FindingRow,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import {
  RULE_OPPORTUNITY_PROJECTION,
  type ArtifactType,
  type OpportunityRuleId,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getProject } from "./projects";
import type { ProjectDto } from "./mappers";
import { toAsyncRunDto, type AsyncRunDto } from "./runs";
import { listProjectActions } from "./actions-service";
import { listProjectArtifacts } from "./artifacts";
import { getProjectReport, type ReportDto } from "./report";
import { listProjectFindings } from "./findings-list";
import { listProjectSnapshots } from "./snapshots";
import type {
  ActionDto,
  CoverageDto,
  EvidenceDto,
  FindingDto,
} from "./diagnostic-mappers";
import type { ArtifactDto } from "./artifact-mappers";
import type { DataSnapshotDto } from "./source-mappers";

/**
 * Workspace aggregate read model (spec §11.3). Each view is produced by the SAME
 * canonical projection as its dedicated API (AC-036): `plan` ↔ Actions, `studio`
 * ↔ Artifacts, `report` ↔ Report. It is a read convenience, never a separate
 * store, and never recomputes priority.
 */

export type WorkspaceViewName =
  | "overview"
  | "plan"
  | "studio"
  | "report"
  | "execution";

const WORKSPACE_PAGE_SIZE = 100;
const WORKSPACE_MAX_PAGES_PER_RESOURCE = 100;
const WORKSPACE_MAX_ITEMS_PER_RESOURCE =
  WORKSPACE_PAGE_SIZE * WORKSPACE_MAX_PAGES_PER_RESOURCE;
const WORKSPACE_MAX_BYTES_PER_RESOURCE = 16 * 1024 * 1024;

interface WorkspacePage<Row> {
  readonly data: readonly Row[];
  readonly nextCursor: string | null;
}

type WorkspaceProjection = "Overview" | "Plan" | "Studio" | "Execution";
type WorkspaceResource = "actions" | "artifacts" | "findings" | "snapshots";

function workspacePaginationFailure(
  projection: WorkspaceProjection,
  resource: WorkspaceResource,
  reason: string,
): ProblemError {
  return new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    `${projection} ${resource} projection could not be completed: ${reason}`,
  );
}

/**
 * Workspace views are complete aggregates, not cursor-paginated responses. Walk
 * every canonical list page with hard production guards against a broken cursor
 * or an unexpectedly large in-memory projection. A guard breach fails the
 * request explicitly; it never returns a silently truncated view.
 */
async function loadCompleteWorkspaceResource<Row>(
  projection: WorkspaceProjection,
  resource: WorkspaceResource,
  load: (cursor: string | null) => Promise<WorkspacePage<Row>>,
): Promise<Row[]> {
  const data: Row[] = [];
  const seenCursors = new Set<string>();
  const encoder = new TextEncoder();
  let cursor: string | null = null;
  let pageCount = 0;
  let serializedBytes = 0;

  while (true) {
    const page = await load(cursor);
    pageCount += 1;
    data.push(...page.data);
    serializedBytes += encoder.encode(JSON.stringify(page.data)).byteLength;

    if (data.length > WORKSPACE_MAX_ITEMS_PER_RESOURCE) {
      throw workspacePaginationFailure(
        projection,
        resource,
        `the ${WORKSPACE_MAX_ITEMS_PER_RESOURCE}-item safety budget was exceeded.`,
      );
    }
    if (serializedBytes > WORKSPACE_MAX_BYTES_PER_RESOURCE) {
      throw workspacePaginationFailure(
        projection,
        resource,
        `the ${WORKSPACE_MAX_BYTES_PER_RESOURCE}-byte safety budget was exceeded.`,
      );
    }

    const nextCursor = page.nextCursor;
    if (nextCursor === null) return data;
    if (nextCursor === cursor || seenCursors.has(nextCursor)) {
      throw workspacePaginationFailure(
        projection,
        resource,
        "pagination did not advance.",
      );
    }
    if (pageCount >= WORKSPACE_MAX_PAGES_PER_RESOURCE) {
      throw workspacePaginationFailure(
        projection,
        resource,
        `the ${WORKSPACE_MAX_PAGES_PER_RESOURCE}-page safety budget was exceeded.`,
      );
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

export interface OverviewView {
  view: "overview";
  project: ProjectDto;
  coverage: CoverageDto;
  activeRuns: AsyncRunDto[];
  frozenDiagnosticRunId: string | null;
  topActions: ActionDto[];
  latestSnapshot: DataSnapshotDto | null;
  topActionEvidence: EvidenceDto[];
  deliveryFocus: OverviewDeliveryFocusDto | null;
}

/**
 * Minimal delivery sidecar for the Overview. Artifact bodies/revisions remain
 * on Studio; Overview only needs the canonical action association and status.
 */
export interface OverviewDeliveryFocusDto {
  artifactId: string;
  actionId: string;
  artifactType: ArtifactDto["artifactType"];
  status: ArtifactDto["status"];
  updatedAt: string;
}

export interface OverviewHighlights {
  topActions: ActionDto[];
  latestSnapshot: DataSnapshotDto | null;
  topActionEvidence: EvidenceDto[];
  deliveryFocus: OverviewDeliveryFocusDto | null;
}

const PRIORITY_ORDER: Readonly<Record<string, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function priorityRank(priorityBand: string): number {
  return PRIORITY_ORDER[priorityBand] ?? Number.MAX_SAFE_INTEGER;
}

function latestSnapshot(
  snapshots: readonly DataSnapshotDto[],
): DataSnapshotDto | null {
  return snapshots.reduce<DataSnapshotDto | null>((latest, candidate) => {
    if (latest === null) return candidate;
    const latestTime = Date.parse(latest.capturedAt);
    const candidateTime = Date.parse(candidate.capturedAt);
    if (Number.isNaN(candidateTime)) return latest;
    if (
      Number.isNaN(latestTime) ||
      candidateTime > latestTime ||
      // Snapshot ids are canonical UUID text. Lowest ASCII id matches the DB's
      // ascending UUID tie-break and makes equal-time selection input-order free.
      (candidateTime === latestTime && candidate.id < latest.id)
    ) {
      return candidate;
    }
    return latest;
  }, null);
}

function uniqueEvidence(evidence: readonly EvidenceDto[]): EvidenceDto[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * Produce Overview-only highlights from the same DTO rows used by Sources,
 * Diagnosis, Plan, and Studio. Priority bands/statuses are read as persisted;
 * this function selects and associates rows but never re-scores an action.
 */
export function buildOverviewHighlights(input: {
  readonly actions: readonly ActionDto[];
  readonly snapshots: readonly DataSnapshotDto[];
  readonly findings: readonly FindingDto[];
  readonly artifacts: readonly ArtifactDto[];
  readonly currentRunFindingIds?: ReadonlySet<string>;
}): OverviewHighlights {
  const exactRunActions = input.currentRunFindingIds
    ? input.actions.filter((action) =>
        input.currentRunFindingIds?.has(action.findingId),
      )
    : input.actions;
  const topActions = exactRunActions
    .filter(
      (action) => action.status !== "done" && action.status !== "dismissed",
    )
    .map((action, index) => ({ action, index }))
    .sort((left, right) => {
      const priority =
        priorityRank(left.action.priorityBand) -
        priorityRank(right.action.priorityBand);
      return priority === 0 ? left.index - right.index : priority;
    })
    .slice(0, 3)
    .map(({ action }) => action);
  const topAction = topActions[0] ?? null;
  const sourceFinding = topAction
    ? (input.findings.find((finding) => finding.id === topAction.findingId) ??
      null)
    : null;
  const artifact = topAction
    ? (input.artifacts.find((item) => item.actionId === topAction.id) ?? null)
    : null;

  return {
    topActions,
    latestSnapshot: latestSnapshot(input.snapshots),
    topActionEvidence: uniqueEvidence(sourceFinding?.evidence ?? []),
    deliveryFocus: artifact
      ? {
          artifactId: artifact.id,
          actionId: artifact.actionId,
          artifactType: artifact.artifactType,
          status: artifact.status,
          updatedAt: artifact.updatedAt,
        }
      : null,
  };
}

/**
 * Resolve the Finding membership of the exact latest frozen Growth Map audit.
 * Overview must not mix old project Actions into today's customer decisions.
 * The target ledger is the canonical per-run membership boundary; the
 * cross-run Finding row by itself is insufficient.
 */
interface FrozenAuditMembership {
  readonly diagnosticRunId: string | null;
  readonly findingIds: ReadonlySet<string>;
}

async function loadLatestFrozenAuditMembership(
  exec: Executor,
  projectScope: ProjectScope,
): Promise<FrozenAuditMembership> {
  const repository = new GrowthMapReadRepository(exec);
  const run = await repository.findLatestReadableRun(projectScope);
  if (!run) return { diagnosticRunId: null, findingIds: new Set() };

  const findingIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pageCount = 0;

  while (true) {
    const page = await repository.listCurrentRunUrls(projectScope, run.id, {
      limit: MAX_GROWTH_MAP_URL_PAGE_SIZE,
      cursor,
    });
    pageCount += 1;
    const targets = await repository.listResolvedTargets(
      projectScope,
      run.id,
      page.rows.map((row) => row.site_page_id),
    );
    targets.forEach((target) => findingIds.add(target.finding_id));

    if (page.nextCursor === null) {
      return { diagnosticRunId: run.id, findingIds };
    }
    if (
      page.nextCursor === cursor ||
      seenCursors.has(page.nextCursor) ||
      pageCount >= WORKSPACE_MAX_PAGES_PER_RESOURCE
    ) {
      throw workspacePaginationFailure(
        "Overview",
        "findings",
        "the frozen audit URL membership could not be paginated safely.",
      );
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

/**
 * Honest empty coverage for a project with no diagnostic run yet. The OpenAPI
 * `OverviewView.coverage` is required + non-nullable, and `overall: "unavailable"`
 * is the canonical "no data" marker (spec §1.3 — unavailable, never fabricated).
 * Empty `domains` renders every domain as "missing" in the overview.
 */
const EMPTY_COVERAGE: CoverageDto = {
  overall: "unavailable",
  domains: {},
  limitations: [],
};

export interface PlanView {
  view: "plan";
  actions: ActionDto[];
}

export interface StudioView {
  view: "studio";
  artifacts: ArtifactDto[];
}

export interface ReportView {
  view: "report";
  report: ReportDto;
}

/**
 * Read-side audit-recheck state for one canonical chain, derived purely from
 * persisted lineage (never a new column):
 *  - `resolved`: the Finding was resolved in a later audit run (`resolvedAt`).
 *  - `drifted`: the Finding moved beyond the audit run its Action froze
 *    (`lastSeenRunId !== action.sourceDiagnosticRunId`, or it `regressed`) —
 *    the same divergence run-artifact.ts and artifacts.ts treat as a conflict.
 *  - `current`: the Action still points at the Finding's latest audit run.
 */
export type AuditRecheckState = "current" | "drifted" | "resolved";

export interface ExecutionChainActionSummary {
  readonly id: string;
  readonly status: string;
}

export interface ExecutionChainArtifactSummary {
  readonly id: string;
  readonly status: string;
  readonly currentRevision: number;
}

/**
 * One canonical Execution chain: a confirmed primary Finding, its single
 * Finding-owned Action, and the template-fixed Artifact that Action produces.
 * The Artifact type is read from `RULE_OPPORTUNITY_PROJECTION`, never recomputed.
 */
export interface ExecutionChainDto {
  readonly primaryFindingId: string;
  readonly ruleId: OpportunityRuleId;
  readonly targetRef: string;
  readonly action: ExecutionChainActionSummary;
  readonly fixedArtifactType: ArtifactType;
  readonly artifact: ExecutionChainArtifactSummary | null;
  readonly auditRecheckState: AuditRecheckState;
}

export interface ExecutionView {
  view: "execution";
  chains: ExecutionChainDto[];
}

/** Minimal Finding projection input for the single-chain join. */
export interface ExecutionChainFindingInput {
  readonly id: string;
  readonly ruleId: string;
  readonly reviewState: string;
  readonly regressed: boolean;
  readonly resolvedAt: string | null;
  readonly lastSeenRunId: string;
  readonly subjectRefs: readonly string[];
}

/** Minimal Action projection input; the Action stays Finding-owned. */
export interface ExecutionChainActionInput {
  readonly id: string;
  readonly findingId: string;
  readonly status: string;
  readonly sourceDiagnosticRunId: string;
}

function isOpportunityRuleId(ruleId: string): ruleId is OpportunityRuleId {
  return Object.prototype.hasOwnProperty.call(
    RULE_OPPORTUNITY_PROJECTION,
    ruleId,
  );
}

/** First non-dismissed Action per source Finding (one canonical Action, spec §9.1). */
function firstActiveActionByFinding(
  actions: readonly ExecutionChainActionInput[],
): Map<string, ExecutionChainActionInput> {
  const byFinding = new Map<string, ExecutionChainActionInput>();
  for (const action of actions) {
    if (action.status === "dismissed") continue;
    if (!byFinding.has(action.findingId))
      byFinding.set(action.findingId, action);
  }
  return byFinding;
}

function deriveAuditRecheckState(
  finding: ExecutionChainFindingInput,
  action: ExecutionChainActionInput,
): AuditRecheckState {
  if (finding.resolvedAt !== null) return "resolved";
  if (
    finding.regressed ||
    finding.lastSeenRunId !== action.sourceDiagnosticRunId
  ) {
    return "drifted";
  }
  return "current";
}

function executionTargetRef(
  finding: ExecutionChainFindingInput,
  ruleId: OpportunityRuleId,
): string {
  const ref = finding.subjectRefs.find((value) => value.length > 0);
  return ref ?? ruleId;
}

/**
 * Project the read-only Execution single chains. For each confirmed primary
 * Finding on an opportunity rule with a live (non-dismissed) Action, associate
 * its template-fixed Artifact. This selects and joins persisted rows; it never
 * re-scores priority, recomputes the Artifact type, or writes an Action.
 */
export function buildExecutionChain(input: {
  readonly findings: readonly ExecutionChainFindingInput[];
  readonly actions: readonly ExecutionChainActionInput[];
  readonly artifacts: readonly ArtifactDto[];
}): ExecutionChainDto[] {
  const actionByFinding = firstActiveActionByFinding(input.actions);
  const chains: ExecutionChainDto[] = [];
  for (const finding of input.findings) {
    if (finding.reviewState !== "confirmed") continue;
    if (!isOpportunityRuleId(finding.ruleId)) continue;
    const action = actionByFinding.get(finding.id);
    if (!action) continue;

    const ruleId = finding.ruleId;
    const fixedArtifactType = RULE_OPPORTUNITY_PROJECTION[ruleId].artifactType;
    const artifact =
      input.artifacts.find(
        (item) =>
          item.actionId === action.id &&
          item.artifactType === fixedArtifactType &&
          item.status !== "archived",
      ) ?? null;

    chains.push({
      primaryFindingId: finding.id,
      ruleId,
      targetRef: executionTargetRef(finding, ruleId),
      action: { id: action.id, status: action.status },
      fixedArtifactType,
      artifact: artifact
        ? {
            id: artifact.id,
            status: artifact.status,
            currentRevision: artifact.currentRevision,
          }
        : null,
      auditRecheckState: deriveAuditRecheckState(finding, action),
    });
  }
  return chains;
}

function toExecutionFindingInput(row: FindingRow): ExecutionChainFindingInput {
  return {
    id: row.id,
    ruleId: row.rule_id,
    reviewState: row.review_state,
    regressed: row.regressed,
    resolvedAt: row.resolved_at,
    lastSeenRunId: row.last_seen_run_id,
    subjectRefs: row.subject_refs.filter(
      (ref): ref is string => typeof ref === "string",
    ),
  };
}

function toExecutionActionInput(row: ActionRow): ExecutionChainActionInput {
  return {
    id: row.id,
    findingId: row.source_finding_id,
    status: row.status,
    sourceDiagnosticRunId: row.source_diagnostic_run_id,
  };
}

export type WorkspaceView =
  | OverviewView
  | PlanView
  | StudioView
  | ReportView
  | ExecutionView;

export async function getWorkspaceView(
  scope: WorkspaceScope,
  projectId: string,
  view: WorkspaceViewName,
  outputLocale: string | null,
): Promise<WorkspaceView> {
  if (view === "report") {
    const report = await getProjectReport(
      scope,
      projectId,
      outputLocale,
      new Date().toISOString(),
    );
    return { view: "report", report };
  }

  const { db } = getDb();
  return db.transaction(
    async (tx): Promise<WorkspaceView> => {
      switch (view) {
        case "overview": {
          const projectScope = { workspaceId: scope.workspaceId, projectId };
          const project = await getProject(scope, projectId, tx);
          let overviewCoverage: CoverageDto | null | undefined;
          // One PostgreSQL transaction executor is shared by every reader. Run
          // the loaders sequentially so a failed/capped paginator cannot leave
          // sibling queries enqueueing work after the callback rejects and the
          // transaction begins rollback.
          const activeRunRows = await new AsyncRunsRepository(
            tx,
          ).listActiveByProject(projectScope);
          const frozenAudit = await loadLatestFrozenAuditMembership(
            tx,
            projectScope,
          );
          const findings = await loadCompleteWorkspaceResource(
            "Overview",
            "findings",
            async (cursor) => {
              const page = await listProjectFindings(
                scope,
                projectId,
                {
                  limit: WORKSPACE_PAGE_SIZE,
                  cursor,
                  // A persisted action may still point to a now-resolved finding.
                  // Keep that canonical association visible rather than dropping it.
                  activeOnly: false,
                },
                tx,
              );
              if (overviewCoverage === undefined) {
                overviewCoverage = page.meta.coverage;
              }
              return {
                data: page.data,
                nextCursor: page.meta.nextCursor,
              };
            },
          );
          const plan = await loadCompleteWorkspaceResource(
            "Overview",
            "actions",
            (cursor) =>
              listProjectActions(
                scope,
                projectId,
                { limit: WORKSPACE_PAGE_SIZE, cursor },
                tx,
              ),
          );
          const snapshots = await loadCompleteWorkspaceResource(
            "Overview",
            "snapshots",
            (cursor) =>
              listProjectSnapshots(
                scope,
                projectId,
                { limit: WORKSPACE_PAGE_SIZE, cursor },
                tx,
              ),
          );
          const studio = await loadCompleteWorkspaceResource(
            "Overview",
            "artifacts",
            (cursor) =>
              listProjectArtifacts(
                scope,
                projectId,
                { limit: WORKSPACE_PAGE_SIZE, cursor },
                tx,
              ),
          );
          const highlights = buildOverviewHighlights({
            actions: plan,
            snapshots,
            findings,
            artifacts: studio,
            currentRunFindingIds: frozenAudit.findingIds,
          });
          return {
            view: "overview",
            project,
            coverage: overviewCoverage ?? EMPTY_COVERAGE,
            activeRuns: activeRunRows.map(toAsyncRunDto),
            frozenDiagnosticRunId: frozenAudit.diagnosticRunId,
            ...highlights,
          };
        }
        case "plan": {
          const actions = await loadCompleteWorkspaceResource(
            "Plan",
            "actions",
            (cursor) =>
              listProjectActions(
                scope,
                projectId,
                { limit: WORKSPACE_PAGE_SIZE, cursor },
                tx,
              ),
          );
          return { view: "plan", actions };
        }
        case "studio": {
          const artifacts = await loadCompleteWorkspaceResource(
            "Studio",
            "artifacts",
            (cursor) =>
              listProjectArtifacts(
                scope,
                projectId,
                { limit: WORKSPACE_PAGE_SIZE, cursor },
                tx,
              ),
          );
          return { view: "studio", artifacts };
        }
        case "execution": {
          const projectScope = { workspaceId: scope.workspaceId, projectId };
          // Validate project membership on the shared executor, then walk the
          // canonical Artifact/Finding/Action projections sequentially (never a
          // separate store) so buildExecutionChain joins persisted rows only.
          const project = await new ProjectsRepository(tx).findById(
            scope,
            projectId,
          );
          if (!project)
            throw new ProblemError("NOT_FOUND", "Project not found.");
          const artifacts = await loadCompleteWorkspaceResource(
            "Execution",
            "artifacts",
            (cursor) =>
              listProjectArtifacts(
                scope,
                projectId,
                { limit: WORKSPACE_PAGE_SIZE, cursor },
                tx,
              ),
          );
          const findings = await loadCompleteWorkspaceResource(
            "Execution",
            "findings",
            async (cursor) => {
              const page = await new FindingsRepository(tx).list(projectScope, {
                limit: WORKSPACE_PAGE_SIZE,
                cursor,
                // A persisted Action may point at a now-resolved Finding; keep
                // the canonical chain visible and mark it via auditRecheckState.
                activeOnly: false,
              });
              return {
                data: page.rows.map(toExecutionFindingInput),
                nextCursor: page.nextCursor,
              };
            },
          );
          const actions = await loadCompleteWorkspaceResource(
            "Execution",
            "actions",
            async (cursor) => {
              const page = await new ActionsRepository(tx).list(projectScope, {
                limit: WORKSPACE_PAGE_SIZE,
                cursor,
              });
              return {
                data: page.rows.map(toExecutionActionInput),
                nextCursor: page.nextCursor,
              };
            },
          );
          return {
            view: "execution",
            chains: buildExecutionChain({ findings, actions, artifacts }),
          };
        }
      }
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
