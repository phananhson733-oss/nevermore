import {
  contentHash,
  IcpProfilesRepository,
  ProjectsRepository,
  SitesRepository,
  type CanonicalValue,
  type IcpProfileRow,
  type IcpStatus,
  type WorkspaceScope,
} from "@sf/db";
import type { UpdateContextRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { toIcpProfileDto, type IcpProfileDto } from "./mappers";

/**
 * ICP context read/update (spec §6.2). Each save appends an immutable version;
 * the project points at the current one. `content_hash` covers `{status,
 * profile}` so an identical re-save is a semantic no-op (returns the existing
 * version, AC-009) while a draft→complete transition of the same content is a
 * real new version — reconciling append-only + `UNIQUE(project_id, content_hash)`.
 */

/** `GET /projects/{projectId}/context` — current profile, or null before first save. */
export async function getContext(
  scope: WorkspaceScope,
  projectId: string,
): Promise<IcpProfileDto | null> {
  const { db } = getDb();
  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (!project.current_icp_profile_id) return null;
  const icp = await new IcpProfilesRepository(db).findById(
    { workspaceId: scope.workspaceId, projectId },
    project.current_icp_profile_id,
  );
  return icp ? toIcpProfileDto(icp) : null;
}

/** Merge a draft patch over the current profile: null clears, absent inherits. */
function mergeDraft(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** `PATCH /projects/{projectId}/context` — append a draft/complete version. */
export async function updateContext(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  body: UpdateContextRequest,
): Promise<IcpProfileDto> {
  const { db } = getDb();

  return db.transaction(async (tx) => {
    const projects = new ProjectsRepository(tx);
    const icps = new IcpProfilesRepository(tx);
    const sites = new SitesRepository(tx);
    const projectScope = { workspaceId: scope.workspaceId, projectId };

    const project = await projects.findById(scope, projectId);
    if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
    if (project.archived_at) {
      throw new ProblemError(
        "PROJECT_ARCHIVED",
        "Project is archived and read-only.",
      );
    }

    const current: IcpProfileRow | null = project.current_icp_profile_id
      ? await icps.findById(projectScope, project.current_icp_profile_id)
      : null;
    const currentVersion = current?.version ?? 0;

    if (body.baseVersion !== currentVersion) {
      throw new ProblemError(
        "VERSION_CONFLICT",
        `Context was modified; expected version ${currentVersion}, got baseVersion ${body.baseVersion}.`,
      );
    }

    const status: IcpStatus = body.mode === "complete" ? "complete" : "draft";
    const profile: Record<string, unknown> =
      body.mode === "complete"
        ? (body.profile as Record<string, unknown>)
        : mergeDraft(
            current?.profile ?? {},
            body.profile as Record<string, unknown>,
          );

    const hash = contentHash({ status, profile } as CanonicalValue);

    // Semantic no-op: identical content (same status + profile) → existing version.
    const dup = await icps.findByContentHash(projectScope, hash);
    if (dup) return toIcpProfileDto(dup);

    const nextVersion = (await icps.maxVersion(projectScope)) + 1;
    const inserted = await icps.insertVersion({
      workspaceId: scope.workspaceId,
      projectId,
      version: nextVersion,
      status,
      profile,
      contentHash: hash,
      createdBy: actorId,
    });
    await projects.setCurrentIcpProfile(scope, projectId, inserted.id);

    // A complete save mirrors market/language/delivery-locale onto the read models
    // (spec §6.2); a draft save only advances the current-profile pointer.
    if (body.mode === "complete") {
      const p = body.profile;
      await sites.updatePrimaryProjections(projectScope, {
        marketCodes: [...p.marketCodes],
        languageCodes: [...p.siteLanguageCodes],
      });
      await projects.setDeliveryLocale(
        scope,
        projectId,
        p.defaultDeliveryLocale,
      );
    }

    return toIcpProfileDto(inserted);
  });
}
