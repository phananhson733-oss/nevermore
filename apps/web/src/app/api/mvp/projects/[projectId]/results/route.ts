import { resolveUiLocale, UI_LOCALE_COOKIE } from "@sf/i18n";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectResults } from "@/lib/services/recheck-results";

/**
 * `GET /api/mvp/projects/{projectId}/results` — the latest recheck's read-only
 * comparison of two immutable runs (Slice 1, Task 8). Reports the confirmed
 * Action's technical condition state only; it never claims traffic, rank,
 * revenue, or AI-citation movement. Read-only.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const uiLocale = resolveUiLocale(
      request.cookies.get(UI_LOCALE_COOKIE)?.value,
    );
    const result = await getProjectResults(
      { workspaceId: ctx.operator.workspaceId, uiLocale },
      id,
    );

    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
