import { Uuid } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import {
  parseQueryValue,
  parseUuidParam,
} from "@/lib/http/validate";
import { getProjectAuditInternalLinkMap } from "@/lib/services/growth-map-internal-link-map";

function queryPointer(name: string): string {
  return `/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

function selectedSitePageId(request: Request): string | null {
  const searchParams = new URL(request.url).searchParams;
  for (const key of searchParams.keys()) {
    if (key === "sitePageId") continue;
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
  return parseQueryValue(searchParams, "sitePageId", Uuid);
}

/**
 * Return the frozen Internal Link Map inside Growth Map. `sitePageId` selects
 * one page's inbound evidence and governed recommendations; it never changes
 * the graph authority or creates an Action.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const selectedPageId = selectedSitePageId(request);
    const result = await getProjectAuditInternalLinkMap(
      { workspaceId: ctx.operator.workspaceId },
      id,
      selectedPageId,
    );
    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
