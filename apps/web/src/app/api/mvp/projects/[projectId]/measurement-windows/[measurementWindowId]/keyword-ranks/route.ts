import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectMeasurementTargetKeywordRanks } from "@/lib/services/measurement-keyword-ranks";

/**
 * Return one measured URL's governed target Keyword comparison. Measurement
 * windows are frozen by the verified Change Receipt; callers cannot choose
 * dates or substitute GSC average position for DataForSEO absolute rank.
 */
export const GET = operatorRoute<{
  projectId: string;
  measurementWindowId: string;
}>(async (request, ctx, routeCtx) => {
  const { projectId, measurementWindowId } =
    await routeCtx.params;
  const selectedProjectId = parseUuidParam(projectId);
  const selectedWindowId = parseUuidParam(
    measurementWindowId,
  );
  if (new URL(request.url).searchParams.size > 0) {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "Target Keyword rank comparison uses the Measurement Window's fixed dates.",
    );
  }
  const result =
    await getProjectMeasurementTargetKeywordRanks(
      { workspaceId: ctx.operator.workspaceId },
      selectedProjectId,
      selectedWindowId,
    );
  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
