import { resolveUiLocale, UI_LOCALE_COOKIE } from "@sf/i18n";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectOpportunity } from "@/lib/services/opportunities";

/**
 * `GET /api/mvp/projects/{projectId}/opportunities/{opportunityId}` — one
 * traceable Growth Opportunity keyed by its primary Finding id. Read-only.
 */
export const GET = operatorRoute<{
  projectId: string;
  opportunityId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, opportunityId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const selectedOpportunityId = parseUuidParam(opportunityId);
  const uiLocale = resolveUiLocale(request.cookies.get(UI_LOCALE_COOKIE)?.value);
  const result = await getProjectOpportunity(
    { workspaceId: ctx.operator.workspaceId, uiLocale },
    id,
    selectedOpportunityId,
  );

  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
