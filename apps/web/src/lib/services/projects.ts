import {
  contentHash,
  IcpProfilesRepository,
  IdempotencyRepository,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  TelemetryRepository,
  type Db,
  type DbTx,
  type IcpProfileRow,
  type ProjectRow,
  type SiteRow,
  type WorkspaceScope,
} from "@sf/db";
import type { CreateProjectRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { canonicalUrlGuard, normalizeSiteOrigin, type UrlGuardResult } from "@sf/sources";
import { getDb } from "@/lib/db";
import { toProjectDto, type ProjectDto } from "./mappers";

const IDEMPOTENCY_SCOPE = "createProject";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Injectable URL guard so tests can drive SSRF cases without live DNS. */
export type UrlGuard = (rawUrl: string) => Promise<UrlGuardResult>;

export interface CreateProjectResult {
  readonly status: number;
  readonly project: ProjectDto;
  readonly location: string;
  readonly replayed: boolean;
}

function locationFor(projectId: string): string {
  return `/p/${projectId}/overview`;
}

/**
 * Create a project, its primary site, and the default Crawl source in ONE
 * transaction, then emit `project_created` (spec §6.1). URL is normalized and
 * SSRF-checked first; private/metadata/illegal URLs are rejected 422 (AC-007).
 * Idempotency-Key replays the original 201 for the same body, 409s on reuse.
 */
export async function createProject(
  scope: WorkspaceScope,
  actorId: string,
  idempotencyKey: string,
  body: CreateProjectRequest,
  guard: UrlGuard = canonicalUrlGuard,
): Promise<CreateProjectResult> {
  const requestHash = contentHash({
    clientName: body.clientName,
    projectName: body.projectName,
    siteUrl: body.siteUrl,
    marketCodes: [...body.marketCodes],
    siteLanguageCodes: [...body.siteLanguageCodes],
    defaultDeliveryLocale: body.defaultDeliveryLocale,
  });
  const { db } = getDb();

  // A completed command is immutable. Replay (or reject a different hash)
  // before DNS/reachability checks whose result can legitimately change after
  // the original 201 was committed.
  const idem = new IdempotencyRepository(db);
  const existing = await idem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
  if (existing) {
    const replay = replayOrConflict(existing, requestHash);
    if (replay) return replay;
  }

  // 1. Normalize + validate the submitted URL (scheme, host, trailing slash).
  const normalized = normalizeSiteOrigin(body.siteUrl);
  if (!normalized) {
    throw new ProblemError("VALIDATION_ERROR", "siteUrl must be a valid http(s) URL.", {
      errors: [{ pointer: "/siteUrl", code: "invalid_url", message: "Not a valid http(s) URL." }],
    });
  }
  // 2. SSRF / reachability guard: reject localhost, private, link-local, metadata.
  const verdict = await guard(normalized.origin);
  if (!verdict.safe) {
    throw new ProblemError("VALIDATION_ERROR", "siteUrl is not an allowed public address.", {
      errors: [
        {
          pointer: "/siteUrl",
          code: "blocked_url",
          message: verdict.reason ?? "URL resolves to a blocked address.",
        },
      ],
    });
  }

  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  return db.transaction(async (tx) => {
    const txIdem = new IdempotencyRepository(tx);
    const reserved = await txIdem.begin({
      workspaceId: scope.workspaceId,
      scope: IDEMPOTENCY_SCOPE,
      key: idempotencyKey,
      requestHash,
      expiresAt,
    });
    if (!reserved) {
      // Another transaction won the key between the fast-path read and here.
      const now = await txIdem.find(scope.workspaceId, IDEMPOTENCY_SCOPE, idempotencyKey);
      const replay = now ? replayOrConflict(now, requestHash) : null;
      if (replay) return replay;
      throw new ProblemError("IDEMPOTENCY_KEY_REUSED", "Idempotency key is being processed.");
    }

    const projects = new ProjectsRepository(tx);
    const sites = new SitesRepository(tx);
    const sources = new SourceConnectionsRepository(tx);
    const telemetry = new TelemetryRepository(tx);

    const project = await projects.insert({
      workspaceId: scope.workspaceId,
      clientName: body.clientName,
      projectName: body.projectName,
      defaultDeliveryLocale: body.defaultDeliveryLocale,
      createdBy: actorId,
    });
    const site = await sites.insertPrimary({
      workspaceId: scope.workspaceId,
      projectId: project.id,
      origin: normalized.origin,
      host: normalized.host,
      marketCodes: [...body.marketCodes],
      languageCodes: [...body.siteLanguageCodes],
    });
    await sources.insertDefaultCrawl({
      workspaceId: scope.workspaceId,
      projectId: project.id,
      siteId: site.id,
      createdBy: actorId,
    });
    await telemetry.emit({
      workspaceId: scope.workspaceId,
      projectId: project.id,
      eventName: "project_created",
      actorId,
      properties: {
        marketCount: body.marketCodes.length,
        languageCount: body.siteLanguageCodes.length,
      },
    });

    const dto = toProjectDto(project, site, null);
    const responseBody = { data: dto };
    await txIdem.complete(reserved.id, {
      responseStatus: 201,
      responseBody,
      resourceType: "project",
      resourceId: project.id,
    });

    return { status: 201, project: dto, location: locationFor(project.id), replayed: false };
  });
}

/** Decide replay (same body) vs 409 (different body); null when still in-progress. */
function replayOrConflict(
  row: { request_hash: string; status: string; resource_id: string | null; response_body: unknown },
  requestHash: string,
): CreateProjectResult | null {
  if (row.request_hash !== requestHash) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key was already used with a different request body.",
    );
  }
  if (row.status === "completed" && row.resource_id) {
    const body = row.response_body as { data: ProjectDto } | null;
    if (body?.data) {
      return {
        status: 201,
        project: body.data,
        location: locationFor(row.resource_id),
        replayed: true,
      };
    }
  }
  return null;
}

/** Fetch the full project aggregate (project + primary site + current ICP). */
async function loadAggregate(
  exec: Db | DbTx,
  scope: WorkspaceScope,
  project: ProjectRow,
): Promise<ProjectDto> {
  const sites = new SitesRepository(exec);
  const icps = new IcpProfilesRepository(exec);
  const site = await sites.findPrimary({ workspaceId: scope.workspaceId, projectId: project.id });
  if (!site) {
    throw new ProblemError("NOT_FOUND", "Project has no primary site.");
  }
  const currentIcp: IcpProfileRow | null = project.current_icp_profile_id
    ? await icps.findById(
        { workspaceId: scope.workspaceId, projectId: project.id },
        project.current_icp_profile_id,
      )
    : null;
  return toProjectDto(project, site as SiteRow, currentIcp);
}

/** `GET /projects/{projectId}` — 404 (not 403) when foreign/absent (AC-005, AC-010). */
export async function getProject(scope: WorkspaceScope, projectId: string): Promise<ProjectDto> {
  const { db } = getDb();
  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  return loadAggregate(db, scope, project);
}

export interface ProjectListResult {
  readonly data: ProjectDto[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

/** `GET /projects` — keyset page of the workspace's projects (spec §11.1). */
export async function listProjects(
  scope: WorkspaceScope,
  opts: { limit: number; cursor: string | null; archived: boolean },
): Promise<ProjectListResult> {
  const { db } = getDb();
  const page = await new ProjectsRepository(db).listByWorkspace(scope, opts);
  const sitesRepo = new SitesRepository(db);
  const icpsRepo = new IcpProfilesRepository(db);

  const projectIds = page.rows.map((r) => r.id);
  const siteByProject = await sitesRepo.mapPrimariesByProjects(scope, projectIds);
  const icpIds = page.rows
    .map((r) => r.current_icp_profile_id)
    .filter((id): id is string => id !== null);
  const icpById = await icpsRepo.mapByIds(scope, icpIds);

  const data = page.rows.map((project) => {
    const site = siteByProject.get(project.id);
    if (!site) throw new ProblemError("NOT_FOUND", "Project has no primary site.");
    const icp = project.current_icp_profile_id
      ? (icpById.get(project.current_icp_profile_id) ?? null)
      : null;
    return toProjectDto(project, site, icp);
  });

  return { data, nextCursor: page.nextCursor, limit: opts.limit };
}
