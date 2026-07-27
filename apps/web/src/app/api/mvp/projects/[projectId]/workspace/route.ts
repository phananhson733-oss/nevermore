import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseOptionalOutputLocale,
  parseUuidParam,
} from "@/lib/http/validate";
import { getWorkspaceView, type WorkspaceViewName } from "@/lib/services/workspace-view";

/**
 * The one shipped workspace destination (stop gate §19.4). The former
 * `plan`/`studio`/`report` views left the enum with their Slice 1 screens, and
 * the restored capabilities read their own endpoints (diagnostic-runs, PATCH
 * actions, report/exports); `execution` never had an HTTP consumer.
 */
const VIEWS: readonly WorkspaceViewName[] = ["overview"];

/** `GET /api/mvp/projects/{projectId}/workspace?view=overview` — aggregate read model (spec §11.3). */
export const GET = operatorRoute<{ projectId: string }>(async (request, ctx, routeCtx) => {
  const { projectId } = await routeCtx.params;
  const id = parseUuidParam(projectId);

  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  if (view === null || !VIEWS.includes(view as WorkspaceViewName)) {
    throw new ProblemError("VALIDATION_ERROR", "Query param `view` must be one of: " + VIEWS.join(", "), {
      errors: [{ pointer: "/view", code: "invalid_enum_value", message: "Unsupported view." }],
    });
  }
  // The documented `outputLocale` query param stays validated (a malformed
  // locale is still a 422) but is not forwarded: Overview never localized, and
  // the `report` view that consumed it was retired (§19.4).
  parseOptionalOutputLocale(url.searchParams);

  const result = await getWorkspaceView(
    { workspaceId: ctx.operator.workspaceId },
    id,
    view as WorkspaceViewName,
  );
  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
