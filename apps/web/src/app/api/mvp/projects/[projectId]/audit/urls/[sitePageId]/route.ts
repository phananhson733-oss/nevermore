import { Uuid } from "@sf/contracts";
import { resolveUiLocale, UI_LOCALE_COOKIE } from "@sf/i18n";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseQueryValue,
  parseUuidParam,
} from "@/lib/http/validate";
import { getProjectAuditUrl } from "@/lib/services/growth-map";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const GrowthMapDiagnosticRunId = Uuid.refine((value) =>
  CANONICAL_UUID.test(value),
);

function queryPointer(name: string): string {
  return `/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

function parseDiagnosticRunId(request: Request): string | null {
  const searchParams = new URL(request.url).searchParams;
  for (const key of searchParams.keys()) {
    if (key === "diagnosticRunId") continue;
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Query parameter failed validation.",
      {
        errors: [
          {
            pointer: queryPointer(key),
            code: "unknown_query_parameter",
            message: "Unknown query parameter.",
          },
        ],
      },
    );
  }
  return parseQueryValue(
    searchParams,
    "diagnosticRunId",
    GrowthMapDiagnosticRunId,
  );
}

/**
 * `GET /api/mvp/projects/{projectId}/audit/urls/{sitePageId}` — exact selected
 * canonical SitePage detail for the latest or one exact published
 * DiagnosticRun.
 */
export const GET = operatorRoute<{
  projectId: string;
  sitePageId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, sitePageId } = await routeCtx.params;
  const id = parseUuidParam(projectId);
  const selectedSitePageId = parseUuidParam(sitePageId);
  const expectedDiagnosticRunId = parseDiagnosticRunId(request);
  const uiLocale = resolveUiLocale(
    request.cookies.get(UI_LOCALE_COOKIE)?.value,
  );
  const result = await getProjectAuditUrl(
    { workspaceId: ctx.operator.workspaceId, uiLocale },
    id,
    selectedSitePageId,
    { diagnosticRunId: expectedDiagnosticRunId },
  );

  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
