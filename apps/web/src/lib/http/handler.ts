import { NextResponse, type NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { getOperatorContext, type OperatorContext } from "@/lib/auth/session";
import { buildRequestContext, type RequestContext } from "./context";
import { internalError, problem } from "./respond";

/** Handler receiving request + correlation context. */
export type RouteHandler = (
  request: NextRequest,
  ctx: RequestContext,
) => Promise<NextResponse> | NextResponse;

/** Handler that additionally requires an authenticated operator. */
export type OperatorRouteHandler = (
  request: NextRequest,
  ctx: RequestContext & { operator: OperatorContext },
) => Promise<NextResponse> | NextResponse;

function handleError(error: unknown, ctx: RequestContext): NextResponse {
  if (error instanceof ProblemError) {
    return problem(error.code, error.message, ctx.requestId, {
      ...(error.fieldErrors ? { errors: error.fieldErrors } : {}),
      ...(error.extraHeaders ? { headers: error.extraHeaders } : {}),
    });
  }
  ctx.logger.error("unhandled_error", {
    message: error instanceof Error ? error.message : String(error),
  });
  return internalError(ctx.requestId);
}

/** Wrap a route: build context, map ProblemError → problem+json, catch unknowns. */
export function route(handler: RouteHandler) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const ctx = buildRequestContext(request.headers);
    try {
      return await handler(request, ctx);
    } catch (error) {
      return handleError(error, ctx);
    }
  };
}

/** Wrap a route that requires authentication: 401 when no operator resolves. */
export function operatorRoute(handler: OperatorRouteHandler) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const ctx = buildRequestContext(request.headers);
    try {
      const operator = await getOperatorContext();
      if (!operator) {
        return problem("AUTH_REQUIRED", "Authentication required.", ctx.requestId);
      }
      return await handler(request, { ...ctx, operator });
    } catch (error) {
      return handleError(error, ctx);
    }
  };
}
