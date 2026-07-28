import { resolveUiLocale, UI_LOCALE_COOKIE } from "@sf/i18n";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectAuditBacklinks } from "@/lib/services/growth-map-backlinks";

/**
 * Read the project's immutable backlink authority inside Growth Map. Backlink
 * providers remain built-in evidence sources and are not customer-managed
 * connection entries.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const uiLocale = resolveUiLocale(
      request.cookies.get(UI_LOCALE_COOKIE)?.value,
    );
    const result = await getProjectAuditBacklinks(
      { workspaceId: ctx.operator.workspaceId, uiLocale },
      id,
    );
    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
