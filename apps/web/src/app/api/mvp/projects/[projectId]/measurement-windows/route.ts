import {
  CreateMeasurementWindowRequest,
  MeasurementTarget,
  MeasurementWindowAccepted,
} from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { operatorRoute } from "@/lib/http/handler";
import { assertWorkspaceRateLimit } from "@/lib/http/rate-limit";
import { asyncAccepted, ok } from "@/lib/http/respond";
import {
  parseJsonBody,
  parseQueryLimit,
  parseQueryValue,
  parseUuidParam,
  requireIdempotencyKey,
} from "@/lib/http/validate";
import {
  createMeasurementWindow,
  DEFAULT_MEASUREMENT_WINDOW_HISTORY_LIMIT,
  listProjectMeasurementWindowHistory,
} from "@/lib/services/measurement";

function missingTargetQuery(
  sitePageId: string | null,
  targetRef: string | null,
): never {
  const errors = [
    ...(sitePageId === null
      ? [
          {
            pointer: "/sitePageId",
            code: "required",
            message: "Query parameter is required.",
          },
        ]
      : []),
    ...(targetRef === null
      ? [
          {
            pointer: "/targetRef",
            code: "required",
            message: "Query parameter is required.",
          },
        ]
      : []),
  ];
  throw new ProblemError(
    "VALIDATION_ERROR",
    "Query parameter failed validation.",
    { errors },
  );
}

/**
 * `GET /api/mvp/projects/{projectId}/measurement-windows` — immutable,
 * observational before/after history for one exact SitePage target.
 */
export const GET = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const searchParams = new URL(request.url).searchParams;
    const sitePageId = parseQueryValue(
      searchParams,
      "sitePageId",
      MeasurementTarget.shape.sitePageId,
    );
    const targetRef = parseQueryValue(
      searchParams,
      "targetRef",
      MeasurementTarget.shape.targetRef,
    );
    if (sitePageId === null || targetRef === null) {
      missingTargetQuery(sitePageId, targetRef);
    }
    const target = MeasurementTarget.parse({
      kind: "url",
      sitePageId,
      targetRef,
    });
    const limit = parseQueryLimit(
      searchParams,
      DEFAULT_MEASUREMENT_WINDOW_HISTORY_LIMIT,
    );
    const history = await listProjectMeasurementWindowHistory(
      { workspaceId: ctx.operator.workspaceId },
      id,
      target,
      { limit },
    );
    return ok(history, ctx.requestId);
  },
);

/**
 * Start one immutable observational before/after window from an exact verified
 * Change Receipt. The browser cannot author target, interval, provider, result,
 * or Delivery Receipt authority; those facts are re-resolved under lock.
 */
export const POST = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const idempotencyKey = requireIdempotencyKey(request);
    await assertWorkspaceRateLimit(ctx.operator.workspaceId, {
      idempotencyKey,
      scope: "measurement_window",
      maxAttempts: 20,
      windowMs: 15 * 60 * 1_000,
    });
    const body = await parseJsonBody(
      request,
      CreateMeasurementWindowRequest,
    );
    const result = await createMeasurementWindow(
      { workspaceId: ctx.operator.workspaceId },
      id,
      ctx.operator.userId,
      idempotencyKey,
      body,
    );
    const accepted = MeasurementWindowAccepted.parse({
      measurementWindowId: result.measurementWindowId,
      asyncRunId: result.asyncRunId,
      state: result.state,
      replayed: result.replayed,
    });
    return asyncAccepted(accepted, ctx.requestId, result.location);
  },
);

export const dynamic = "force-dynamic";
