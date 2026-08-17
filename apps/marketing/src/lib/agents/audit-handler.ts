// @input  -- authenticated Agent POST request and existing bounded SEO audit handler
// @output -- buffered, category-projected evidence or stable auth/upstream errors
// @pos    -- shared server-only execution boundary for both of the Agent's focuses

import type {
  SeoAuditCoverage,
  SeoAuditRecord,
  SeoAuditSiteResources,
} from "@sf/public-tools";
import {
  getServerAuthenticationStatus,
  type ServerAuthenticationStatus,
} from "../auth/server-auth-status.ts";
import type { QualifyingTool } from "../credits/credits-config.ts";
import { reportFirstToolRun } from "../credits/report-first-run.ts";
import { handleSeoAuditRequest } from "../tools/seo-audit-handler.ts";
import {
  readSeoAuditInput,
  SEO_AUDIT_REQUEST_BODY_LIMIT_BYTES,
  type SeoAuditRequestInput,
} from "../tools/seo-audit-input.ts";
import { readPublicToolJson } from "../tools/public-tool-request.ts";
import { buildKeywordEvidence } from "@sf/public-tools";
import {
  isCanonicalIsoTimestamp,
  isSeoAuditUpstreamSuccessEnvelope,
  type AgentAuditResult,
  type AgentAuditSuccessData,
  type AgentKind,
} from "./audit-contract.ts";

export interface AgentAuditHandlerDependencies {
  /** Proves a real Supabase user before any part of the audit request is read. */
  readonly authenticate: () => Promise<ServerAuthenticationStatus>;
  /** Runs the existing bounded crawler, gate, and completed-result cache. */
  /**
   * Runs the crawl. Receives the request object itself, plus the body this
   * boundary already read and validated, so the body is never parsed twice and
   * the request is never rebuilt.
   */
  readonly delegate: (
    request: Request,
    input: SeoAuditRequestInput,
  ) => Promise<Response>;
  /**
   * Records that an audit completed, so a referred visitor's first qualifying
   * run can pay its reward.
   *
   * Optional, and it must never throw: this success return is the one in the
   * set that sits outside any try/catch, so a throw here would turn a finished
   * audit into a 500. A cache hit still counts — the visitor ran the audit and
   * got the evidence, and making the reward depend on whether someone else
   * crawled the same host first would be unpredictable for them and free for
   * an attacker either way.
   */
  readonly reportFirstRun?: (tool: QualifyingTool) => void;
  /**
   * Which tool the visitor actually ran.
   *
   * Owner ruling: the On-Page Checker reuses this endpoint's engine rather than
   * getting one of its own, but it still records its own credit identity from
   * day one. Those two facts only fit together if the identity comes from the
   * boundary the request arrived at — the body cannot carry it, because the
   * frozen request whitelist is `{url, targetQueries?, pageRole?}` and because a
   * client-supplied slug is a client-chosen ledger label. The checker therefore
   * has its own thin route over this same handler, and that route is the only
   * thing that changes here.
   */
  readonly reportAs: QualifyingTool;
}

/**
 * Exported so credits/first-run-wiring.test.ts can prove the reporter is
 * actually attached in production; every handler test builds its own literal
 * deps object and would stay green if it were not.
 */
export const DEFAULT_DEPENDENCIES: AgentAuditHandlerDependencies = {
  authenticate: getServerAuthenticationStatus,
  delegate: (request, input) =>
    handleSeoAuditRequest(request, undefined, {
      forceBufferedJson: true,
      input,
    }),
  reportFirstRun: reportFirstToolRun,
  reportAs: "agent-audit",
};

/**
 * The same handler, reached from the On-Page Checker's own route.
 *
 * Only the ledger label differs. Sharing the engine is what makes a second
 * check on an already-crawled host fast, and sharing the in-flight gate is what
 * keeps a checker run and an Agent run on one host from crawling it twice.
 */
export const ON_PAGE_CHECK_DEPENDENCIES: AgentAuditHandlerDependencies = {
  ...DEFAULT_DEPENDENCIES,
  reportAs: "on-page-seo-check",
};

const UPSTREAM_ERROR_BODY_LIMIT_BYTES = 4_096;

const UPSTREAM_ERROR_STATUS = {
  invalid_url: 400,
  invalid_request: 400,
  payload_too_large: 413,
  unsupported_media_type: 415,
  scan_in_progress: 409,
  rate_limited: 429,
  target_busy: 429,
  quota_unavailable: 503,
  robots_disallowed: 422,
  robots_unreachable: 422,
  scan_timeout: 504,
  scan_failed: 502,
} as const satisfies Readonly<Record<string, number>>;

type UpstreamErrorCode = keyof typeof UPSTREAM_ERROR_STATUS;

const SAFE_UPSTREAM_ERROR_HEADERS = [
  "Retry-After",
  "RateLimit-Limit",
  "RateLimit-Remaining",
  "RateLimit-Reset",
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "X-RateLimit-Reset",
] as const;

type CacheProvenance =
  | {
      readonly status: "hit";
      readonly capturedAt: string;
      readonly explicitStatus: true;
    }
  | {
      readonly status: "miss";
      readonly capturedAt: null;
      readonly explicitStatus: boolean;
    };

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function isUpstreamErrorCode(value: unknown): value is UpstreamErrorCode {
  return (
    typeof value === "string" && Object.hasOwn(UPSTREAM_ERROR_STATUS, value)
  );
}

function upstreamErrorCodeOf(value: unknown): UpstreamErrorCode | null {
  if (!isObject(value) || !hasExactKeys(value, ["error"])) return null;
  const error = value.error;
  if (!isObject(error) || !hasExactKeys(error, ["code"])) return null;
  return isUpstreamErrorCode(error.code) ? error.code : null;
}

function isJsonContentType(headers: Headers): boolean {
  const mediaType = (headers.get("content-type") ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return (
    mediaType === "application/json" || mediaType?.endsWith("+json") === true
  );
}

async function readBoundedJson(response: Response): Promise<unknown | null> {
  if (!isJsonContentType(response.headers) || response.body === null)
    return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > UPSTREAM_ERROR_BODY_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function safeErrorHeaders(upstream: Headers): Headers {
  const headers = new Headers({ "Cache-Control": "no-store, private" });
  for (const name of SAFE_UPSTREAM_ERROR_HEADERS) {
    const value = upstream.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function cacheProvenanceOf(headers: Headers): CacheProvenance | null {
  const cacheStatus = headers.get("X-Crawl-Cache");
  const capturedAt = headers.get("X-Crawl-Captured-At");

  if (cacheStatus === null || cacheStatus === "miss") {
    return capturedAt === null
      ? {
          status: "miss",
          capturedAt: null,
          explicitStatus: cacheStatus === "miss",
        }
      : null;
  }
  if (cacheStatus !== "hit" || !isCanonicalIsoTimestamp(capturedAt)) {
    return null;
  }
  return { status: "hit", capturedAt, explicitStatus: true };
}

function successHeaders(cache: CacheProvenance): Headers {
  const headers = new Headers({ "Cache-Control": "no-store, private" });
  if (cache.explicitStatus) headers.set("X-Crawl-Cache", cache.status);
  if (cache.status === "hit") {
    headers.set("X-Crawl-Captured-At", cache.capturedAt);
  }
  return headers;
}

function projectCoverage(coverage: SeoAuditCoverage): SeoAuditCoverage {
  return {
    availability: coverage.availability,
    pagesInspected: coverage.pagesInspected,
    linksObserved: coverage.linksObserved,
    sitemapUrlsObserved: coverage.sitemapUrlsObserved,
    urlsSkipped: coverage.urlsSkipped,
    urlsBlocked: coverage.urlsBlocked,
    urlsDisallowed: coverage.urlsDisallowed,
    urlsErrored: coverage.urlsErrored,
    stopReason: coverage.stopReason,
  };
}

function projectSiteResources(
  siteResources: SeoAuditSiteResources,
): SeoAuditSiteResources {
  return {
    robotsFetched: siteResources.robotsFetched,
    robotsGroupsObserved: siteResources.robotsGroupsObserved,
    sitemapReferencesObserved: siteResources.sitemapReferencesObserved,
    sitemapFetched: siteResources.sitemapFetched,
  };
}

function projectRecord(record: SeoAuditRecord): SeoAuditRecord {
  return {
    id: record.id,
    category: record.category,
    state: record.state,
    unit: record.unit,
    // The evaluator needs this to know whether a page's absence from the
    // observations is evidence about that page. Dropping it here would silently
    // downgrade every page-level check to unverified.
    population: record.population,
    tested: record.tested,
    affected: record.affected,
    observations: record.observations.map((observation) => ({
      url: observation.url,
      values: observation.values.map((entry) => ({
        label: entry.label,
        value: entry.value,
      })),
    })),
    limitation: record.limitation,
  };
}

function errorResponse(
  code: string,
  status: number,
  headers: Headers = new Headers({ "Cache-Control": "no-store, private" }),
): Response {
  return Response.json(
    { error: { code } },
    {
      status,
      headers,
    },
  );
}

async function projectUpstreamError(upstream: Response): Promise<Response> {
  const envelope = await readBoundedJson(upstream);
  const code = upstreamErrorCodeOf(envelope);
  if (code === null || upstream.status !== UPSTREAM_ERROR_STATUS[code]) {
    return errorResponse("audit_response_invalid", 502);
  }
  return errorResponse(
    code,
    upstream.status,
    safeErrorHeaders(upstream.headers),
  );
}

/**
 * Copy exactly the extract fields the Agent contract names.
 *
 * The upstream guard bounds the values; this decides what leaves the boundary.
 */
function projectTargetPageExtract(
  extract: AgentAuditResult["targetPageExtract"],
): AgentAuditResult["targetPageExtract"] {
  if (extract === null) return null;
  return {
    url: extract.url,
    title: extract.title,
    metaDescription: extract.metaDescription,
    h1: [...extract.h1],
    subHeadings: extract.subHeadings === null ? null : [...extract.subHeadings],
    openingText: extract.openingText,
    staticBodyWords: extract.staticBodyWords,
    truncatedLists: extract.truncatedLists,
  };
}

export async function handleAgentAuditRequest(
  request: Request,
  agent: AgentKind,
  dependencies: AgentAuditHandlerDependencies = DEFAULT_DEPENDENCIES,
): Promise<Response> {
  let authentication: ServerAuthenticationStatus = "unavailable";
  try {
    authentication = await dependencies.authenticate();
  } catch {
    authentication = "unavailable";
  }

  if (authentication === "unavailable") {
    return errorResponse("auth_unavailable", 503);
  }
  if (authentication === "unauthenticated") {
    return errorResponse("auth_required", 401);
  }

  // Both layers need the body: this one to build the keyword region, the
  // delegate to run the crawl. A body can only be read once, so this reads a
  // clone and hands the delegate the request it was given — rebuilding it
  // would drop everything a NextRequest carries beyond method, headers and
  // bytes. Both sides go through the same bounded reader and the same
  // validator, so they cannot disagree about what the visitor asked for, and
  // neither can be made to hold an unbounded body.
  const body = await readPublicToolJson(
    request,
    SEO_AUDIT_REQUEST_BODY_LIMIT_BYTES,
  );
  if (!body.ok) {
    return errorResponse(body.code, UPSTREAM_ERROR_STATUS[body.code]);
  }
  const input = readSeoAuditInput(body.value);
  if (!input.ok) return errorResponse("invalid_request", 400);

  const upstream = await dependencies.delegate(request, input.value);
  if (!upstream.ok) return projectUpstreamError(upstream);

  if (
    !(upstream.headers.get("content-type") ?? "")
      .toLowerCase()
      .includes("application/json")
  ) {
    return errorResponse("audit_response_invalid", 502);
  }

  let envelope: unknown;
  try {
    envelope = await upstream.json();
  } catch {
    return errorResponse("audit_response_invalid", 502);
  }
  if (!isSeoAuditUpstreamSuccessEnvelope(envelope)) {
    return errorResponse("audit_response_invalid", 502);
  }

  const cache = cacheProvenanceOf(upstream.headers);
  if (cache === null) return errorResponse("audit_response_invalid", 502);

  const { run, result } = envelope.data;
  const projected: AgentAuditSuccessData = {
    run: {
      agent,
      mode: "authenticated_agent",
      persistence: "none",
      source: {
        tool: "seo_audit",
        schemaVersion: run.schemaVersion,
        completedAt: run.completedAt,
        cache: {
          status: cache.status,
          capturedAt: cache.capturedAt,
        },
      },
    },
    result: {
      targetUrl: result.targetUrl,
      siteOrigin: result.siteOrigin,
      scannedAt: result.scannedAt,
      targetInspected: result.targetInspected,
      inspectedTargetUrl: result.inspectedTargetUrl,
      // Rebuilt field by field, like every other projected value. Forwarding
      // the object would publish whatever an upstream or cached payload
      // happened to carry beside these fields.
      targetPageExtract: projectTargetPageExtract(result.targetPageExtract),
      coverage: projectCoverage(result.coverage),
      siteResources: projectSiteResources(result.siteResources),
      records: result.records.map(projectRecord),
      // Derived here, never cached: a cache row is shared by host, so a stored
      // region would answer the next visitor with this one's queries.
      ...(input.value.targetQueries === null
        ? {}
        : {
            keywordEvidence: buildKeywordEvidence(
              result.targetPageExtract,
              input.value.targetQueries,
              input.value.pageRole,
              result.targetInspected,
            ),
          }),
    },
  };

  dependencies.reportFirstRun?.(dependencies.reportAs);
  return Response.json(
    { data: projected },
    { status: upstream.status, headers: successHeaders(cache) },
  );
}
