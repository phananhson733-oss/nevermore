import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseOptionalOutputLocale,
  parseUuidParam,
} from "@/lib/http/validate";
import { getWorkspaceView, type WorkspaceViewName } from "@/lib/services/workspace-view";

const VIEWS: readonly WorkspaceViewName[] = ["overview", "plan", "studio", "report"];

/** `GET /api/mvp/projects/{projectId}/workspace?view=...` — aggregate read model (spec §11.3). */
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
  const outputLocale = parseOptionalOutputLocale(url.searchParams);

  const result = await getWorkspaceView(
    { workspaceId: ctx.operator.workspaceId },
    id,
    view as WorkspaceViewName,
    outputLocale,
  );
  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
