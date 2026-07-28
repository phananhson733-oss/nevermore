import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseUuidParam } from "@/lib/http/validate";
import { getProjectMeasurementGeoCitations } from "@/lib/services/measurement-geo-citations";

/**
 * Return the immutable GEO query/citation evidence frozen into one measured
 * URL. The Measurement Window owns target, dates, and canonical source lineage.
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
      "GEO citation evidence uses the Measurement Window's fixed URL and dates.",
    );
  }
  const result = await getProjectMeasurementGeoCitations(
    { workspaceId: ctx.operator.workspaceId },
    selectedProjectId,
    selectedWindowId,
  );
  return ok(result, ctx.requestId);
});

export const dynamic = "force-dynamic";
