import { NextResponse, type NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { getOperatorContext, type OperatorContext } from "@/lib/auth/session";
import { buildRequestContext, type RequestContext } from "./context";
import { internalError, problem } from "./respond";

/**
 * Next.js App Router passes dynamic segments as the second handler argument,
 * with `params` resolved asynchronously (Next 16). Route handlers receive it as
 * `routeCtx` so they can read e.g. `await routeCtx.params` for `projectId`.
 */
export interface RouteContext<P extends Record<string, string> = Record<string, string>> {
  readonly params: Promise<P>;
}

/** Handler receiving request + correlation context + route params. */
export type RouteHandler<P extends Record<string, string> = Record<string, string>> = (
  request: NextRequest,
  ctx: RequestContext,
  routeCtx: RouteContext<P>,
) => Promise<NextResponse> | NextResponse;

/** Handler that additionally requires an authenticated operator. */
export type OperatorRouteHandler<P extends Record<string, string> = Record<string, string>> = (
  request: NextRequest,
  ctx: RequestContext & { operator: OperatorContext },
  routeCtx: RouteContext<P>,
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

const emptyRouteCtx: RouteContext = { params: Promise.resolve({}) };

/** Wrap a route: build context, map ProblemError → problem+json, catch unknowns. */
export function route<P extends Record<string, string> = Record<string, string>>(
  handler: RouteHandler<P>,
) {
  return async (request: NextRequest, routeCtx?: RouteContext<P>): Promise<NextResponse> => {
    const ctx = buildRequestContext(request.headers);
    try {
      return await handler(request, ctx, routeCtx ?? (emptyRouteCtx as RouteContext<P>));
    } catch (error) {
      return handleError(error, ctx);
    }
  };
}

/** Wrap a route that requires authentication: 401 when no operator resolves. */
export function operatorRoute<P extends Record<string, string> = Record<string, string>>(
  handler: OperatorRouteHandler<P>,
) {
  return async (request: NextRequest, routeCtx?: RouteContext<P>): Promise<NextResponse> => {
    const ctx = buildRequestContext(request.headers);
    try {
      const operator = await getOperatorContext();
      if (!operator) {
        return problem("AUTH_REQUIRED", "Authentication required.", ctx.requestId);
      }
      return await handler(
        request,
        { ...ctx, operator },
        routeCtx ?? (emptyRouteCtx as RouteContext<P>),
      );
    } catch (error) {
      return handleError(error, ctx);
    }
  };
}
