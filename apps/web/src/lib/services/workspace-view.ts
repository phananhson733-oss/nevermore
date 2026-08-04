import {
  AsyncRunsRepository,
  ContentDecayMonitorRepository,
  GrowthMapReadRepository,
  MAX_CONTENT_DECAY_PAGE_LOOKUP,
  MAX_GROWTH_MAP_URL_PAGE_SIZE,
  type Executor,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import {
  buildContentDecayMonitor,
  compareContentDecayAlerts,
  resolveContentDecayTimeZone,
  type ContentDecayAvailability,
  type ContentDecayMonitor,
  type ContentDecayObservationCandidate,
  type ContentDecayPage,
  type ContentDecaySnapshotCandidate,
} from "@sf/engine";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getProject } from "./projects";
import type { ProjectDto } from "./mappers";
import { toAsyncRunDto, type AsyncRunDto } from "./runs";
import { listProjectActions } from "./actions-service";
import { listProjectArtifacts } from "./artifacts";
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
 * Workspace aggregate read model (spec §11.3). Overview is the only view a
 * shipped screen consumes (stop gate §19.4): the former `plan`/`studio`/
 * `report` views left with their Slice 1 screens, and the restored
 * capabilities read their own endpoints instead. The projection is produced by
 * the SAME canonical readers as the dedicated APIs (AC-036): it is a read
 * convenience, never a separate store, and never recomputes priority.
 */

export type WorkspaceViewName = "overview";

const WORKSPACE_PAGE_SIZE = 100;
const WORKSPACE_MAX_PAGES_PER_RESOURCE = 100;
const WORKSPACE_MAX_ITEMS_PER_RESOURCE =
  WORKSPACE_PAGE_SIZE * WORKSPACE_MAX_PAGES_PER_RESOURCE;
const WORKSPACE_MAX_BYTES_PER_RESOURCE = 16 * 1024 * 1024;

interface WorkspacePage<Row> {
  readonly data: readonly Row[];
  readonly nextCursor: string | null;
}

type WorkspaceProjection = "Overview";
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
  decisionReminders: OverviewDecisionReminderDto[];
  contentDecayMonitor: ContentDecayMonitor;
  latestSnapshot: DataSnapshotDto | null;
  topActionEvidence: EvidenceDto[];
  deliveryFocus: OverviewDeliveryFocusDto | null;
}

/**
 * One still-active Finding that has remained without any Action or customer
 * review decision for at least fourteen complete days. This is a read
 * projection over the persistent Finding/Action authorities, not a second
 * opportunity store.
 */
export interface OverviewDecisionReminderDto {
  findingId: string;
  sitePageId: string | null;
  summary: string;
  summaryLocale: string;
  severity: "critical" | "high" | "medium" | "low";
  reviewState: "unreviewed" | "needs_more_data";
  firstSeenAt: string;
  lastSeenAt: string;
  staleForDays: number;
}

/**
 * Minimal delivery sidecar for the Overview. Artifact bodies/revisions remain
 * on the Artifacts API; Overview only needs the canonical action association
 * and status.
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
  decisionReminders: OverviewDecisionReminderDto[];
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

export const OVERVIEW_STALE_DECISION_DAYS = 14;
export const OVERVIEW_MAX_DECISION_REMINDERS = 3;
export const OVERVIEW_MAX_CONTENT_DECAY_ALERTS = 3;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
const CONTENT_DECAY_LOOKBACK_DAYS = 150;

function priorityRank(priorityBand: string): number {
  return PRIORITY_ORDER[priorityBand] ?? Number.MAX_SAFE_INTEGER;
}

function reminderSeverity(
  severity: string,
): OverviewDecisionReminderDto["severity"] | null {
  return severity === "critical" ||
    severity === "high" ||
    severity === "medium" ||
    severity === "low"
    ? severity
    : null;
}

function reminderReviewState(
  reviewState: string,
): OverviewDecisionReminderDto["reviewState"] | null {
  return reviewState === "unreviewed" ||
    reviewState === "needs_more_data"
    ? reviewState
    : null;
}

/**
 * Project one bounded, deterministic reminder queue from canonical persistent
 * Findings. Invalid/future chronology is omitted rather than converted into a
 * fabricated age. Any Action, including a completed or dismissed one, proves
 * that the opportunity already received a decision and suppresses the
 * reminder.
 */
export function buildOverviewDecisionReminders(input: {
  readonly findings: readonly FindingDto[];
  readonly actions: readonly ActionDto[];
  readonly currentRunFindingIds: ReadonlySet<string>;
  readonly sitePageByFindingId?: ReadonlyMap<string, string>;
  readonly asOf: string;
}): OverviewDecisionReminderDto[] {
  const asOfTime = Date.parse(input.asOf);
  if (!Number.isFinite(asOfTime)) return [];

  const findingIdsWithActions = new Set(
    input.actions.map((action) => action.findingId),
  );
  return input.findings
    .flatMap((finding): OverviewDecisionReminderDto[] => {
      const severity = reminderSeverity(finding.severity);
      const reviewState = reminderReviewState(finding.reviewState);
      if (
        !finding.active ||
        !input.currentRunFindingIds.has(finding.id) ||
        findingIdsWithActions.has(finding.id) ||
        severity === null ||
        reviewState === null
      ) {
        return [];
      }

      const firstSeenAt = Date.parse(finding.firstSeenAt);
      const lastSeenAt = Date.parse(finding.lastSeenAt);
      if (
        !Number.isFinite(firstSeenAt) ||
        !Number.isFinite(lastSeenAt) ||
        firstSeenAt > lastSeenAt ||
        lastSeenAt > asOfTime
      ) {
        return [];
      }
      const staleForDays = Math.floor(
        (asOfTime - firstSeenAt) / MILLISECONDS_PER_DAY,
      );
      if (staleForDays < OVERVIEW_STALE_DECISION_DAYS) return [];

      return [
        {
          findingId: finding.id,
          sitePageId:
            input.sitePageByFindingId?.get(finding.id) ?? null,
          summary: finding.summary,
          summaryLocale: finding.summaryLocale,
          severity,
          reviewState,
          firstSeenAt: finding.firstSeenAt,
          lastSeenAt: finding.lastSeenAt,
          staleForDays,
        },
      ];
    })
    .sort((left, right) => {
      const age = right.staleForDays - left.staleForDays;
      if (age !== 0) return age;
      const severity =
        priorityRank(left.severity) - priorityRank(right.severity);
      if (severity !== 0) return severity;
      return left.findingId.localeCompare(right.findingId);
    })
    .slice(0, OVERVIEW_MAX_DECISION_REMINDERS);
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
 * Diagnosis, and the Actions/Artifacts APIs. Priority bands/statuses are read
 * as persisted; this function selects and associates rows but never re-scores
 * an action.
 */
export function buildOverviewHighlights(input: {
  readonly actions: readonly ActionDto[];
  readonly snapshots: readonly DataSnapshotDto[];
  readonly findings: readonly FindingDto[];
  readonly artifacts: readonly ArtifactDto[];
  readonly currentRunFindingIds?: ReadonlySet<string>;
  readonly sitePageByFindingId?: ReadonlyMap<string, string>;
  readonly asOf?: string;
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
    decisionReminders:
      input.currentRunFindingIds && input.asOf
        ? buildOverviewDecisionReminders({
            findings: input.findings,
            actions: input.actions,
            currentRunFindingIds: input.currentRunFindingIds,
            ...(input.sitePageByFindingId
              ? { sitePageByFindingId: input.sitePageByFindingId }
              : {}),
            asOf: input.asOf,
          })
        : [],
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
  readonly sitePageByFindingId: ReadonlyMap<string, string>;
  readonly siteId: string | null;
  readonly pages: readonly ContentDecayPage[];
}

async function loadLatestFrozenAuditMembership(
  exec: Executor,
  projectScope: ProjectScope,
): Promise<FrozenAuditMembership> {
  const repository = new GrowthMapReadRepository(exec);
  const run = await repository.findLatestReadableRun(projectScope);
  if (!run) {
    return {
      diagnosticRunId: null,
      findingIds: new Set(),
      sitePageByFindingId: new Map(),
      siteId: null,
      pages: [],
    };
  }

  const findingIds = new Set<string>();
  const sitePageByFindingId = new Map<string, string>();
  const pagesById = new Map<string, ContentDecayPage>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pageCount = 0;

  while (true) {
    const page = await repository.listCurrentRunUrls(projectScope, run.id, {
      limit: MAX_GROWTH_MAP_URL_PAGE_SIZE,
      cursor,
      opportunitiesOnly: false,
    });
    pageCount += 1;
    const targets = await repository.listResolvedTargets(
      projectScope,
      run.id,
      page.rows.map((row) => row.site_page_id),
    );
    page.rows.forEach((row) => {
      if (
        typeof row.site_page_id === "string" &&
        typeof row.normalized_url === "string" &&
        !pagesById.has(row.site_page_id)
      ) {
        pagesById.set(row.site_page_id, {
          sitePageId: row.site_page_id,
          normalizedUrl: row.normalized_url,
        });
      }
    });
    targets.forEach((target) => {
      findingIds.add(target.finding_id);
      if (
        typeof target.site_page_id === "string" &&
        !sitePageByFindingId.has(target.finding_id)
      ) {
        sitePageByFindingId.set(
          target.finding_id,
          target.site_page_id,
        );
      }
    });

    if (page.nextCursor === null) {
      return {
        diagnosticRunId: run.id,
        findingIds,
        sitePageByFindingId,
        siteId: typeof run.site_id === "string" ? run.site_id : null,
        pages: [...pagesById.values()],
      };
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

function monitorAvailability(value: string): ContentDecayAvailability {
  return value === "available" ||
    value === "partial" ||
    value === "unavailable"
    ? value
    : "unavailable";
}

function emptyContentDecayMonitor(asOf: string): ContentDecayMonitor {
  return buildContentDecayMonitor({
    asOf,
    timeZone: resolveContentDecayTimeZone({
      providerTimeZone: null,
      projectTimeZone: null,
    }),
    pages: [],
    snapshots: [],
    observations: [],
  });
}

/**
 * Read-only content-decay projection over immutable GSC facts for the exact
 * latest frozen Growth Map URL inventory. It intentionally does not create a
 * Finding/Action from a GET. The pure engine boundary is reusable by a future
 * monthly scheduler, whose absence remains explicit in the returned metadata.
 */
export async function loadOverviewContentDecayMonitor(
  exec: Executor,
  projectScope: ProjectScope,
  authority: {
    readonly siteId: string | null;
    readonly pages: readonly ContentDecayPage[];
  },
  asOf: string,
): Promise<ContentDecayMonitor> {
  const asOfTime = Date.parse(asOf);
  if (
    authority.siteId === null ||
    authority.pages.length === 0 ||
    !Number.isFinite(asOfTime)
  ) {
    return emptyContentDecayMonitor(asOf);
  }

  const repository = new ContentDecayMonitorRepository(exec);
  const startedAt = new Date(
    asOfTime - CONTENT_DECAY_LOOKBACK_DAYS * MILLISECONDS_PER_DAY,
  ).toISOString();
  const checkpointRows = await repository.listMonthlyCheckpoints(
    projectScope,
    {
      siteId: authority.siteId,
      startedAt,
      endedAt: new Date(asOfTime).toISOString(),
    },
  );
  const latestCheckpoint = checkpointRows[0] ?? null;
  const timeZone = resolveContentDecayTimeZone({
    providerTimeZone: latestCheckpoint?.providerTimeZone ?? null,
    // Project has no persisted confirmed timezone field today. Market/locale
    // must never be reinterpreted as one; the pure resolver discloses UTC.
    projectTimeZone: null,
  });
  const snapshots: ContentDecaySnapshotCandidate[] = checkpointRows.map(
    (row) => ({
      snapshotId: row.snapshotId,
      provider: row.provider,
      datasetKey: row.datasetKey,
      methodVersion: row.methodVersion,
      availability: monitorAvailability(row.availability),
      capturedAt: row.capturedAt,
      sourceWindow: row.sourceWindow,
    }),
  );
  if (snapshots.length === 0) {
    return buildContentDecayMonitor({
      asOf,
      timeZone,
      pages: authority.pages,
      snapshots,
      observations: [],
    });
  }

  const snapshotIds = snapshots.map((snapshot) => snapshot.snapshotId);
  const batchResults: ContentDecayMonitor[] = [];
  for (
    let offset = 0;
    offset < authority.pages.length;
    offset += MAX_CONTENT_DECAY_PAGE_LOOKUP
  ) {
    const pages = authority.pages.slice(
      offset,
      offset + MAX_CONTENT_DECAY_PAGE_LOOKUP,
    );
    const rows = await repository.listPageObservations(
      projectScope,
      snapshotIds,
      pages.map((page) => page.sitePageId),
    );
    const observations: ContentDecayObservationCandidate[] = rows.map(
      (row) => ({
        observationId: row.observationId,
        snapshotId: row.snapshotId,
        sitePageId: row.sitePageId,
        subjectRef: row.subjectRef,
        provider: row.provider,
        metricKey: row.metricKey,
        availability: monitorAvailability(row.availability),
        observedAt: row.observedAt,
        current28d: row.current28d,
      }),
    );
    batchResults.push(
      buildContentDecayMonitor({
        asOf,
        timeZone,
        pages,
        snapshots,
        observations,
      }),
    );
  }

  const status: ContentDecayAvailability = batchResults.some(
    (result) => result.status === "unavailable",
  )
    ? "unavailable"
    : batchResults.some((result) => result.status === "partial")
      ? "partial"
      : "available";
  const first = batchResults[0] ?? emptyContentDecayMonitor(asOf);
  return {
    ...first,
    status,
    limitations: [...new Set(batchResults.flatMap((item) => item.limitations))],
    alerts: batchResults
      .flatMap((item) => item.alerts)
      .sort(compareContentDecayAlerts)
      .slice(0, OVERVIEW_MAX_CONTENT_DECAY_ALERTS),
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

export type WorkspaceView = OverviewView;

export async function getWorkspaceView(
  scope: WorkspaceScope,
  projectId: string,
  view: WorkspaceViewName,
): Promise<WorkspaceView> {
  const { db } = getDb();
  return db.transaction(
    async (tx): Promise<WorkspaceView> => {
      const projectScope = { workspaceId: scope.workspaceId, projectId };
      const project = await getProject(scope, projectId, tx);
      const asOf = new Date().toISOString();
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
      const contentDecayMonitor = await loadOverviewContentDecayMonitor(
        tx,
        projectScope,
        frozenAudit,
        asOf,
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
      const artifacts = await loadCompleteWorkspaceResource(
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
        artifacts,
        currentRunFindingIds: frozenAudit.findingIds,
        sitePageByFindingId: frozenAudit.sitePageByFindingId,
        asOf,
      });
      return {
        view,
        project,
        coverage: overviewCoverage ?? EMPTY_COVERAGE,
        activeRuns: activeRunRows.map(toAsyncRunDto),
        frozenDiagnosticRunId: frozenAudit.diagnosticRunId,
        contentDecayMonitor,
        ...highlights,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
