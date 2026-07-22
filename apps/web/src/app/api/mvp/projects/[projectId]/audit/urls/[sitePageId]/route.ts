import { resolveUiLocale, UI_LOCALE_COOKIE } from "@sf/i18n";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectAuditUrl } from "@/lib/services/growth-map";

/**
 * `GET /api/mvp/projects/{projectId}/audit/urls/{sitePageId}` — exact selected
 * canonical SitePage detail for the latest readable DiagnosticRun.
 */
export const GET = operatorRoute<{
  projectId: string;
  sitePageId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, sitePageId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const selectedSitePageId = parseUuidParam(sitePageId);
  const uiLocale = resolveUiLocale(
    request.cookies.get(UI_LOCALE_COOKIE)?.value,
  );
  const result = await getProjectAuditUrl(
    { workspaceId: ctx.operator.workspaceId, uiLocale },
    id,
    selectedSitePageId,
  );

  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
