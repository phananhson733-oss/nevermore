import { NextResponse, type NextRequest } from "next/server";
import { ProblemError } from "@sf/observability";
import { getOperatorContext, type OperatorContext } from "@/lib/auth/session";
import { buildRequestContext, type RequestContext } from "./context";
import { internalError, problem } from "./respond";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOGGABLE_METHODS = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

const UNKNOWN_API_ROUTE = "/api/mvp/:unknown";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Convert a concrete request path into one of the checked-in API route shapes.
 *
 * This intentionally does not log the original pathname, query, or URL. Dynamic
 * path values are customer-controlled identifiers, and malformed identifiers
 * can contain arbitrary text before path validation rejects them. An unknown
 * shape therefore collapses to one fixed marker instead of reflecting input.
 */
export function apiRouteTemplate(rawUrl: string): string {
  let segments: string[];
  try {
    const pathname = new URL(rawUrl).pathname;
    const all = pathname.split("/").filter((segment) => segment.length > 0);
    const apiIndex = all.findIndex(
      (segment, index) => segment === "api" && all[index + 1] === "mvp",
    );
    if (apiIndex < 0) return UNKNOWN_API_ROUTE;
    segments = all.slice(apiIndex + 2);
  } catch {
    return UNKNOWN_API_ROUTE;
  }

  const exact = segments.join("/");
  if (
    exact === "health/live" ||
    exact === "health/ready" ||
    exact === "health/version" ||
    exact === "oauth/google/callback"
  ) {
    return `/api/mvp/${exact}`;
  }
  if (segments[0] !== "projects") return UNKNOWN_API_ROUTE;
  if (segments.length === 1) return "/api/mvp/projects";

  const base = "/api/mvp/projects/:projectId";
  if (segments.length === 2) return base;

  const resource = segments[2];
  if (
    segments.length === 3 &&
    (resource === "context" ||
      resource === "product-profile" ||
      resource === "workspace" ||
      resource === "collection-runs" ||
      resource === "diagnostic-runs" ||
      resource === "snapshots" ||
      resource === "findings" ||
      resource === "actions" ||
      resource === "artifacts" ||
      resource === "report" ||
      resource === "exports" ||
      resource === "sources")
  ) {
    return `${base}/${resource}`;
  }
  if (
    resource === "product-profile" &&
    segments.length === 4 &&
    (segments[3] === "synthesis-runs" ||
      segments[3] === "competitors" ||
      segments[3] === "confirm")
  ) {
    return `${base}/product-profile/${segments[3]}`;
  }
  if (
    resource === "product-profile" &&
    segments.length === 5 &&
    segments[3] === "competitors"
  ) {
    return `${base}/product-profile/competitors/:candidateId`;
  }
  if (
    resource === "audit" &&
    segments.length === 4 &&
    (segments[3] === "urls" || segments[3] === "keywords")
  ) {
    return `${base}/audit/${segments[3]}`;
  }
  if (
    resource === "audit" &&
    segments.length === 5 &&
    (segments[3] === "urls" || segments[3] === "keywords")
  ) {
    const parameter = segments[3] === "urls" ? ":sitePageId" : ":keywordId";
    return `${base}/audit/${segments[3]}/${parameter}`;
  }
  if (
    segments.length === 4 &&
    (resource === "findings" ||
      resource === "actions" ||
      resource === "artifacts" ||
      resource === "exports" ||
      resource === "runs")
  ) {
    const parameter =
      resource === "findings"
        ? ":findingId"
        : resource === "actions"
          ? ":actionId"
          : resource === "artifacts"
            ? ":artifactId"
            : resource === "exports"
              ? ":exportId"
              : ":runId";
    return `${base}/${resource}/${parameter}`;
  }
  if (resource === "sources" && segments.length === 4) {
    return `${base}/sources/:sourceRef`;
  }
  if (
    resource === "sources" &&
    segments.length === 5 &&
    (segments[4] === "connect" || segments[4] === "import")
  ) {
    return `${base}/sources/:sourceRef/${segments[4]}`;
  }
  if (
    resource === "actions" &&
    segments.length === 5 &&
    segments[4] === "artifacts"
  ) {
    return `${base}/actions/:actionId/artifacts`;
  }
  return UNKNOWN_API_ROUTE;
}

function safeMethod(method: string): string {
  const normalized = method.toUpperCase();
  return LOGGABLE_METHODS.has(normalized) ? normalized : "OTHER";
}

function elapsedMilliseconds(startedAt: number): number {
  const elapsed = performance.now() - startedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return Math.round(elapsed * 100) / 100;
}

function parseConfiguredOrigin(value: string): URL {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error("invalid origin");
    }
    return url;
  } catch {
    // Configuration errors are internal and must never reflect the raw value,
    // which could contain URL credentials.
    throw new Error("Invalid APP_ORIGIN configuration.");
  }
}

function configuredMutationOrigin(request: NextRequest): string {
  const configured = process.env["APP_ORIGIN"];
  if (configured) return parseConfiguredOrigin(configured).origin;
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("Invalid APP_ORIGIN configuration.");
  }
  // Local/unit callers may omit the full server environment. Production never
  // falls back to attacker-influenced request metadata.
  return new URL(request.url).origin;
}

function rejectCrossOriginMutation(): never {
  throw new ProblemError("BAD_REQUEST", "Cross-origin mutation is not allowed.");
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function loopbackAliasesEnabled(): boolean {
  const nodeEnv = process.env["NODE_ENV"];
  return nodeEnv === "development" || nodeEnv === "test";
}

function localLoopbackMutationEnabled(expected: URL): boolean {
  return (
    loopbackAliasesEnabled() &&
    LOOPBACK_HOSTNAMES.has(expected.hostname.toLowerCase())
  );
}

function sameMutationOrigin(candidate: URL, expected: URL): boolean {
  if (candidate.origin === expected.origin) return true;
  if (!loopbackAliasesEnabled()) return false;
  return (
    candidate.protocol === expected.protocol &&
    candidate.port === expected.port &&
    LOOPBACK_HOSTNAMES.has(candidate.hostname.toLowerCase()) &&
    LOOPBACK_HOSTNAMES.has(expected.hostname.toLowerCase())
  );
}

function sameMutationHost(candidate: string, expected: URL): boolean {
  if (candidate.toLowerCase() === expected.host.toLowerCase()) return true;
  if (!localLoopbackMutationEnabled(expected)) {
    return false;
  }
  const port = expected.port === "" ? "" : `:${expected.port}`;
  const allowed = new Set([
    `localhost${port}`,
    `127.0.0.1${port}`,
    `[::1]${port}`,
  ]);
  return allowed.has(candidate.toLowerCase());
}

/**
 * Reject browser cross-site mutations before they reach a service transaction.
 * Both the effective Host and any Origin header are anchored to the configured
 * public APP_ORIGIN, rather than trusting an attacker-controlled Host to define
 * what "same origin" means. Development and test additionally normalize only
 * localhost, 127.0.0.1, and [::1], while retaining the configured scheme and
 * port. Non-local mutations require both a verified Origin and same-origin
 * Fetch Metadata; headerless CLI clients are supported only on that effective
 * local origin.
 */
export function assertSameOriginMutation(
  request: NextRequest,
  expectedOrigin = configuredMutationOrigin(request),
): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const expected = parseConfiguredOrigin(expectedOrigin);
  const requestUrl = new URL(request.url);
  if (!sameMutationOrigin(requestUrl, expected)) rejectCrossOriginMutation();

  const host = request.headers.get("host");
  if (host !== null && !sameMutationHost(host, expected)) {
    rejectCrossOriginMutation();
  }

  const allowsHeaderlessMutation = localLoopbackMutationEnabled(expected);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    (fetchSite === null && !allowsHeaderlessMutation) ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    rejectCrossOriginMutation();
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    if (allowsHeaderlessMutation) return;
    rejectCrossOriginMutation();
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    rejectCrossOriginMutation();
  }
  if (
    origin !== parsedOrigin.origin ||
    parsedOrigin.username !== "" ||
    parsedOrigin.password !== "" ||
    !sameMutationOrigin(parsedOrigin, expected)
  ) {
    rejectCrossOriginMutation();
  }
}

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

type ErrorClassification =
  | Readonly<{ kind: "problem"; response: NextResponse }>
  | Readonly<{ kind: "unexpected"; type: "internal" | "unknown" }>;

/**
 * Build a product response or a fixed unexpected-error classification in one
 * guarded operation. Both `instanceof` and property access can execute Proxy
 * traps, so a hostile thrown value must fall back to the generic 500 path rather
 * than escape this error boundary with a second exception.
 */
function classifyError(
  error: unknown,
  ctx: RequestContext,
): ErrorClassification {
  try {
    if (error instanceof ProblemError) {
      return {
        kind: "problem",
        response: problem(error.code, error.message, ctx.requestId, {
          ...(error.fieldErrors ? { errors: error.fieldErrors } : {}),
          ...(error.extraHeaders ? { headers: error.extraHeaders } : {}),
          ...(error.current !== undefined ? { current: error.current } : {}),
        }),
      };
    }
    return {
      kind: "unexpected",
      type: error instanceof Error ? "internal" : "unknown",
    };
  } catch {
    return { kind: "unexpected", type: "unknown" };
  }
}

function handleError(error: unknown, ctx: RequestContext): NextResponse {
  const classified = classifyError(error, ctx);
  if (classified.kind === "problem") {
    return classified.response;
  }
  try {
    ctx.logger.error("unhandled_error", {
      code: "INTERNAL_ERROR",
      type: classified.type,
    });
  } catch {
    // Returning the fixed 500 takes precedence over a broken logging sink.
  }
  return internalError(ctx.requestId);
}

const emptyRouteCtx: RouteContext = { params: Promise.resolve({}) };

/**
 * Next may pass an empty context object for a static App Router endpoint even
 * though dynamic endpoints receive `params`. Route parameters are used here
 * only to enrich trusted logging context, so a missing/hostile/rejected value
 * must degrade to no project id rather than prevent the actual handler running.
 */
async function projectIdForLogging(routeCtx: unknown): Promise<string | null> {
  try {
    if (typeof routeCtx !== "object" || routeCtx === null) return null;
    const rawParams = (routeCtx as { readonly params?: unknown }).params;
    const params = await rawParams;
    if (typeof params !== "object" || params === null) return null;
    const projectId = (params as Record<string, unknown>)["projectId"];
    return typeof projectId === "string" && UUID.test(projectId)
      ? projectId
      : null;
  } catch {
    return null;
  }
}

async function executeRoute(
  request: NextRequest,
  context: () => RequestContext,
  operation: () => Promise<NextResponse> | NextResponse,
): Promise<NextResponse> {
  const startedAt = performance.now();
  let response: NextResponse;
  try {
    response = await operation();
  } catch (error) {
    response = handleError(error, context());
  }

  try {
    context().logger.info("http_request_completed", {
      method: safeMethod(request.method),
      route: apiRouteTemplate(request.url),
      statusCode: response.status,
      durationMs: elapsedMilliseconds(startedAt),
    });
  } catch {
    // Metrics must never become the request failure path. The logger itself is
    // fail-closed, but this guard also protects an injected/test logger.
  }
  return response;
}

/** Wrap a route: build context, map ProblemError → problem+json, catch unknowns. */
export function route<P extends Record<string, string> = Record<string, string>>(
  handler: RouteHandler<P>,
) {
  return async (request: NextRequest, routeCtx?: RouteContext<P>): Promise<NextResponse> => {
    const ctx = buildRequestContext(request.headers);
    return executeRoute(request, () => ctx, () =>
      handler(request, ctx, routeCtx ?? (emptyRouteCtx as RouteContext<P>)),
    );
  };
}

/** Wrap a route that requires authentication: 401 when no operator resolves. */
export function operatorRoute<P extends Record<string, string> = Record<string, string>>(
  handler: OperatorRouteHandler<P>,
) {
  return async (request: NextRequest, routeCtx?: RouteContext<P>): Promise<NextResponse> => {
    const ctx = buildRequestContext(request.headers);
    let activeCtx: RequestContext = ctx;
    return executeRoute(request, () => activeCtx, async () => {
      const operator = await getOperatorContext();
      if (!operator) {
        return problem("AUTH_REQUIRED", "Authentication required.", ctx.requestId);
      }
      assertSameOriginMutation(request);
      const activeRouteCtx =
        routeCtx ?? (emptyRouteCtx as RouteContext<P>);
      let operatorCtx: RequestContext & { operator: OperatorContext } = {
        ...ctx,
        operator,
        logger: ctx.logger.child({ workspaceId: operator.workspaceId }),
      };
      activeCtx = operatorCtx;
      const projectId = await projectIdForLogging(activeRouteCtx);
      if (projectId !== null) {
        operatorCtx = {
          ...operatorCtx,
          logger: operatorCtx.logger.child({ projectId }),
        };
      }
      activeCtx = operatorCtx;
      return await handler(request, operatorCtx, activeRouteCtx);
    });
  };
}
