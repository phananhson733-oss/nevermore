import {
  ActionsRepository,
  ProjectsRepository,
  type WorkspaceScope,
} from "@sf/db";
import type { UpdateActionRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { toActionDto, type ActionDto } from "./diagnostic-mappers";

/**
 * Actions read + override (spec §9.3). `listProjectActions` returns the 30/60/90
 * plan. `updateProjectAction` applies a human status/priority/lane override — a
 * reason is required, `baseRevision` guards concurrency (409 VERSION_CONFLICT),
 * and the old/new values are appended to `action_override_audit`. The next
 * diagnostic never overwrites a human value.
 */

export async function listProjectActions(
  scope: WorkspaceScope,
  projectId: string,
  opts: { limit: number; cursor: string | null },
): Promise<{ data: ActionDto[]; nextCursor: string | null; limit: number }> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();
  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");

  const page = await new ActionsRepository(db).list(projectScope, opts);
  return { data: page.rows.map(toActionDto), nextCursor: page.nextCursor, limit: opts.limit };
}

export async function updateProjectAction(
  scope: WorkspaceScope,
  projectId: string,
  actionId: string,
  actorId: string,
  body: UpdateActionRequest,
): Promise<ActionDto> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at) throw new ProblemError("PROJECT_ARCHIVED", "Project is archived.");

  const actions = new ActionsRepository(db);
  const action = await actions.findById(projectScope, actionId);
  if (!action) throw new ProblemError("NOT_FOUND", "Action not found.");
  if (action.revision !== body.baseRevision) {
    throw new ProblemError("VERSION_CONFLICT", "Action was modified; refetch and retry.");
  }

  const oldValues: Record<string, unknown> = {
    status: action.status,
    priorityBand: action.priority_band,
    roadmapLane: action.roadmap_lane,
  };
  const newValues: Record<string, unknown> = {
    ...(body.status ? { status: body.status } : {}),
    ...(body.priorityBand ? { priorityBand: body.priorityBand } : {}),
    ...(body.roadmapLane ? { roadmapLane: body.roadmapLane } : {}),
  };
  const toRevision = action.revision + 1;

  await db.transaction(async (tx) => {
    const repo = new ActionsRepository(tx);
    await repo.applyOverride(projectScope, actionId, {
      ...(body.status ? { status: body.status } : {}),
      ...(body.priorityBand ? { priorityBand: body.priorityBand } : {}),
      ...(body.roadmapLane ? { roadmapLane: body.roadmapLane } : {}),
      toRevision,
    });
    await repo.appendOverrideAudit({
      workspaceId: scope.workspaceId,
      projectId,
      actionId,
      fromRevision: action.revision,
      toRevision,
      oldValues,
      newValues,
      reason: body.reason,
      note: body.note ?? null,
      actorId,
    });
  });

  const updated = await actions.findById(projectScope, actionId);
  return toActionDto(updated ?? action);
}
