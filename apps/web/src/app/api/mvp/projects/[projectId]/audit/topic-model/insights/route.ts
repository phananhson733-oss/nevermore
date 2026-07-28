import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectAuditTopicModelInsights } from "@/lib/services/growth-map-topic-model-insights";

/**
 * Customer-visible Keyword/content coverage for the latest confirmed Topic
 * Model. The editable draft is intentionally outside this read authority.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    if (new URL(request.url).searchParams.size > 0) {
      throw new ProblemError(
        "VALIDATION_ERROR",
        "Topic Model insights do not accept caller-authored filters.",
      );
    }
    const result = await getProjectAuditTopicModelInsights(
      { workspaceId: ctx.operator.workspaceId },
      id,
    );
    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
