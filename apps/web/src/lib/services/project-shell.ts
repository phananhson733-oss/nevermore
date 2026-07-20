import {
  ExecutionArtifactsRepository,
  FindingsRepository,
  ProjectsRepository,
  SitesRepository,
  type Executor,
  type ProjectRow,
  type ProjectStage,
  type SiteRow,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";

const PAGE_SIZE = 100;
const PROGRAM_TOTAL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface ProjectShellProject {
  readonly id: string;
  readonly clientName: string;
  readonly projectName: string;
  readonly host: string;
  readonly stage: ProjectStage;
  readonly createdAt: string;
}

export interface ProjectShellOption {
  readonly id: string;
  readonly clientName: string;
  readonly projectName: string;
  readonly host: string;
  /** Unambiguous text used by the native, keyboard-accessible switcher. */
  readonly label: string;
  readonly selected: boolean;
}

export interface ProjectProgramPosition {
  readonly day: number;
  readonly totalDays: number;
  readonly progressPercent: number;
}

export interface ProjectShellProjection {
  readonly currentProject: ProjectShellProject;
  readonly projectOptions: readonly ProjectShellOption[];
  /** Null means no badge. Zero is never presented as fake shell activity. */
  readonly navigationBadges: {
    readonly diagnosis: number | null;
    readonly studio: number | null;
  };
  readonly program: ProjectProgramPosition;
}

export interface ProjectShellRuntime {
  readonly exec?: Executor;
  readonly now?: Date;
}

/**
 * Inclusive position in the project's 90-day program. The clock is anchored to
 * the canonical project creation timestamp and clamped so future clock skew is
 * day 1 while an older engagement remains honestly complete at day 90.
 */
export function projectProgramPosition(
  createdAt: string,
  now: Date = new Date(),
): ProjectProgramPosition {
  const createdAtMs = Date.parse(createdAt);
  const nowMs = now.getTime();
  const elapsedDays =
    Number.isFinite(createdAtMs) && Number.isFinite(nowMs)
      ? Math.floor((nowMs - createdAtMs) / DAY_MS)
      : 0;
  const day = Math.min(
    PROGRAM_TOTAL_DAYS,
    Math.max(1, elapsedDays + 1),
  );
  return {
    day,
    totalDays: PROGRAM_TOTAL_DAYS,
    progressPercent: Math.round((day / PROGRAM_TOTAL_DAYS) * 100),
  };
}

function stalledPagination(resource: string): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    `${resource} pagination did not advance while building the project shell.`,
  );
}

async function allWorkspaceProjects(
  exec: Executor,
  scope: WorkspaceScope,
): Promise<ProjectRow[]> {
  const repo = new ProjectsRepository(exec);
  const rows: ProjectRow[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const page = await repo.listByWorkspace(scope, {
      limit: PAGE_SIZE,
      cursor,
      archived: false,
    });
    rows.push(...page.rows);
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (seenCursors.has(cursor)) stalledPagination("Project list");
      seenCursors.add(cursor);
    }
  } while (cursor !== null);

  return rows;
}

async function confirmedFindingCount(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
): Promise<number> {
  const repo = new FindingsRepository(exec);
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let count = 0;

  do {
    const page = await repo.list(projectScope, {
      limit: PAGE_SIZE,
      cursor,
      activeOnly: true,
      reviewState: "confirmed",
    });
    count += page.rows.length;
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (seenCursors.has(cursor)) stalledPagination("Finding list");
      seenCursors.add(cursor);
    }
  } while (cursor !== null);

  return count;
}

async function liveArtifactCount(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
): Promise<number> {
  const repo = new ExecutionArtifactsRepository(exec);
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let count = 0;

  do {
    const page = await repo.listByProject(projectScope, {
      limit: PAGE_SIZE,
      cursor,
    });
    count += page.rows.filter((artifact) => artifact.status !== "archived").length;
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (seenCursors.has(cursor)) stalledPagination("Artifact list");
      seenCursors.add(cursor);
    }
  } while (cursor !== null);

  return count;
}

function shellProject(project: ProjectRow, site: SiteRow): ProjectShellProject {
  return {
    id: project.id,
    clientName: project.client_name,
    projectName: project.project_name,
    host: site.host,
    stage: project.stage,
    createdAt: project.created_at,
  };
}

async function projectOptions(
  exec: Executor,
  scope: WorkspaceScope,
  currentProject: ProjectRow,
  currentSite: SiteRow,
): Promise<ProjectShellOption[]> {
  const active = await allWorkspaceProjects(exec, scope);
  // Archived projects are not offered as destinations. If an already-open
  // archived project is still reachable, keep its current selection visible so
  // the native select never lies about its value.
  const rows = active.some((project) => project.id === currentProject.id)
    ? active
    : [currentProject, ...active];
  const otherIds = rows
    .map((project) => project.id)
    .filter((id) => id !== currentProject.id);
  const sites = await new SitesRepository(exec).mapPrimariesByProjects(
    scope,
    otherIds,
  );
  sites.set(currentProject.id, currentSite);

  return rows.flatMap((project) => {
    const site = sites.get(project.id);
    if (!site) return [];
    return [
      {
        id: project.id,
        clientName: project.client_name,
        projectName: project.project_name,
        host: site.host,
        label: `${project.client_name} — ${project.project_name}`,
        selected: project.id === currentProject.id,
      },
    ];
  });
}

/**
 * Server-backed project cockpit projection. The current project gate happens
 * before any project-child or workspace-list read, preserving the existing
 * foreign/absent 404 behavior. Every production count comes from workspace- and
 * project-scoped canonical repositories; the shell never imports browser data.
 */
export async function getProjectShell(
  scope: WorkspaceScope,
  projectId: string,
  runtime: ProjectShellRuntime = {},
): Promise<ProjectShellProjection | null> {
  const exec = runtime.exec ?? getDb().db;
  const currentProject = await new ProjectsRepository(exec).findById(
    scope,
    projectId,
  );
  if (!currentProject) return null;

  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const currentSite = await new SitesRepository(exec).findPrimary(projectScope);
  if (!currentSite) return null;

  const [options, findingCount, artifactCount] = await Promise.all([
    projectOptions(exec, scope, currentProject, currentSite),
    confirmedFindingCount(exec, scope, projectId),
    liveArtifactCount(exec, scope, projectId),
  ]);

  return {
    currentProject: shellProject(currentProject, currentSite),
    projectOptions: options,
    navigationBadges: {
      diagnosis: findingCount > 0 ? findingCount : null,
      studio: artifactCount > 0 ? artifactCount : null,
    },
    program: projectProgramPosition(currentProject.created_at, runtime.now),
  };
}
