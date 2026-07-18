import { UpdateArtifactRequest } from "@sf/contracts";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import { getProjectArtifact } from "@/lib/services/artifacts";
import { updateProjectArtifact } from "@/lib/services/artifact-update";

/**
 * `GET/PATCH /api/mvp/projects/{projectId}/artifacts/{artifactId}` — read the
 * artifact + current revision (spec §10.1), or create a manual revision / change
 * status (spec §10.3). `baseRevision` guards concurrency (409 STALE_REVISION).
 */
export const GET = operatorRoute<{ projectId: string; artifactId: string }>(
  async (_request, ctx, routeCtx) => {
    const { projectId, artifactId } = await routeCtx.params;
    const pid = parseUuidParam(projectId);
    const aid = parseUuidParam(artifactId);
    const artifact = await getProjectArtifact({ workspaceId: ctx.operator.workspaceId }, pid, aid);
    return ok(artifact, ctx.requestId);
  },
);

export const PATCH = operatorRoute<{ projectId: string; artifactId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId, artifactId } = await routeCtx.params;
    const pid = parseUuidParam(projectId);
    const aid = parseUuidParam(artifactId);
    const body = await parseJsonBody(request, UpdateArtifactRequest);
    const artifact = await updateProjectArtifact(
      { workspaceId: ctx.operator.workspaceId },
      pid,
      aid,
      ctx.operator.userId,
      body,
    );
    return ok(artifact, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
