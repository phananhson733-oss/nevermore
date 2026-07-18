import {
  DataSnapshotsRepository,
  ProjectsRepository,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { toDataSnapshotDto, type DataSnapshotDto } from "./source-mappers";

/** `listProjectSnapshots` — keyset page of a project's snapshots (spec §11.2). */
export async function listProjectSnapshots(
  scope: WorkspaceScope,
  projectId: string,
  opts: { limit: number; cursor: string | null },
): Promise<{ data: DataSnapshotDto[]; nextCursor: string | null; limit: number }> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { db } = getDb();

  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");

  const page = await new DataSnapshotsRepository(db).listByProject(projectScope, opts);
  return {
    data: page.rows.map(toDataSnapshotDto),
    nextCursor: page.nextCursor,
    limit: opts.limit,
  };
}
