import { AsyncRunsRepository, type WorkspaceScope } from "@sf/db";
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

export type WorkspaceViewName = "overview" | "plan" | "studio" | "report";

const WORKSPACE_PAGE_SIZE = 100;
const WORKSPACE_MAX_PAGES_PER_RESOURCE = 100;
const WORKSPACE_MAX_ITEMS_PER_RESOURCE =
  WORKSPACE_PAGE_SIZE * WORKSPACE_MAX_PAGES_PER_RESOURCE;
const WORKSPACE_MAX_BYTES_PER_RESOURCE = 16 * 1024 * 1024;

interface WorkspacePage<Row> {
  readonly data: readonly Row[];
  readonly nextCursor: string | null;
}

type WorkspaceProjection = "Overview" | "Plan" | "Studio";
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
    if (Number.isNaN(latestTime) || candidateTime > latestTime) return candidate;
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
}): OverviewHighlights {
  const topActions = input.actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => {
      const priority =
        priorityRank(left.action.priorityBand) -
        priorityRank(right.action.priorityBand);
      return priority === 0 ? left.index - right.index : priority;
    })
    .slice(0, 5)
    .map(({ action }) => action);
  const topAction = topActions[0] ?? null;
  const sourceFinding = topAction
    ? input.findings.find((finding) => finding.id === topAction.findingId) ?? null
    : null;
  const artifact = topAction
    ? input.artifacts.find((item) => item.actionId === topAction.id) ?? null
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

export type WorkspaceView = OverviewView | PlanView | StudioView | ReportView;

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
          });
          return {
            view: "overview",
            project,
            coverage: overviewCoverage ?? EMPTY_COVERAGE,
            activeRuns: activeRunRows.map(toAsyncRunDto),
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
      }
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
