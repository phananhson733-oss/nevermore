import { resolveUiLocale, UI_LOCALE_COOKIE } from "@sf/i18n";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectAudit } from "@/lib/services/audit-projection";

/**
 * `GET /api/mvp/projects/{projectId}/audit` — the latest Growth Audit projection:
 * status projected from the canonical async run, eight customer-facing modules,
 * three frontstage lenses, and honest coverage limitations. Read-only.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const uiLocale = resolveUiLocale(
      request.cookies.get(UI_LOCALE_COOKIE)?.value,
    );
    const result = await getProjectAudit(
      { workspaceId: ctx.operator.workspaceId, uiLocale },
      id,
    );

    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
