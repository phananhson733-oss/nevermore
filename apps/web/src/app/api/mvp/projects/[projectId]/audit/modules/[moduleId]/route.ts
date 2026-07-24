import { AuditModuleId } from "@sf/contracts";
import { resolveUiLocale, UI_LOCALE_COOKIE } from "@sf/i18n";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectAuditModule } from "@/lib/services/audit-projection";

/**
 * `GET /api/mvp/projects/{projectId}/audit/modules/{moduleId}` — one audit
 * module's read-only coverage summary from the latest Growth Audit. Empty
 * modules report `no_data` with a limitation, never a zero score.
 */
export const GET = operatorRoute<{ projectId: string; moduleId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId, moduleId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const module = AuditModuleId.safeParse(moduleId);
    if (!module.success) {
      throw new ProblemError("NOT_FOUND", "Unknown audit module.");
    }
    const uiLocale = resolveUiLocale(
      request.cookies.get(UI_LOCALE_COOKIE)?.value,
    );
    const result = await getProjectAuditModule(
      { workspaceId: ctx.operator.workspaceId, uiLocale },
      id,
      module.data,
    );

    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
