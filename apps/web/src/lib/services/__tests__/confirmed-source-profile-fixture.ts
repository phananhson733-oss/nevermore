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
  const projects = new ProjectsRepository(handle.db);
  const profiles = new IcpProfilesRepository(handle.db);
  const project = await projects.findById(
    { workspaceId: scope.workspaceId },
    scope.projectId,
  );
  const current = project?.current_icp_profile_id
    ? await profiles.findById(scope, project.current_icp_profile_id)
    : null;
  const version = (current?.version ?? 0) + 1;
  const profile = {
    productName: "OAuth integration fixture",
    marketCodes: ["US"],
  };
  const row = await profiles.insertVersion({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    version,
    status: "complete",
    profile,
    contentHash: contentHash({
      fixture: "confirmed-source-profile.v1",
      projectId: scope.projectId,
      version,
      profile,
    }),
    createdBy: actorId,
  });
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
