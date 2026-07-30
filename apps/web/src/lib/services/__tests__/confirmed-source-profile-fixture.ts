import { contentHash, IcpProfilesRepository, ProjectsRepository } from "@sf/db";
import type { DbHandle } from "@sf/db/client";

/**
 * OAuth integration fixtures must cross the same confirmed Product/ICP gate as
 * production. The minimal legacy-shaped payload is intentional: these tests
 * exercise source credentials rather than the Product Profile schema itself.
 */
export async function seedConfirmedSourceProfile(
  handle: DbHandle,
  scope: { readonly workspaceId: string; readonly projectId: string },
  actorId: string,
): Promise<string> {
  const profile = {
    productName: "OAuth integration fixture",
    marketCodes: ["US"],
  };
  const row = await new IcpProfilesRepository(handle.db).insertVersion({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    version: 1,
    status: "complete",
    profile,
    contentHash: contentHash({
      fixture: "confirmed-source-profile.v1",
      projectId: scope.projectId,
      profile,
    }),
    createdBy: actorId,
  });
  const projects = new ProjectsRepository(handle.db);
  await projects.setCurrentIcpProfile(
    { workspaceId: scope.workspaceId },
    scope.projectId,
    row.id,
  );
  await projects.setConfirmedIcpProfile(
    { workspaceId: scope.workspaceId },
    scope.projectId,
    row.id,
  );
  return row.id;
}
