// @input  -- authenticated Agent POST request and existing bounded SEO audit handler
// @output -- buffered, category-projected evidence or stable auth/upstream errors
// @pos    -- shared server-only execution boundary for both of the Agent's focuses

import type {
  SeoAuditCoverage,
  SeoAuditTargetPageExtract,
  SeoAuditRecord,
  SeoAuditReport,
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
import { readAgentSearchPerformance } from "./search-performance.ts";
import {
  buildKeywordEvidenceRecords,
  type HeadingShapeInput,
} from "@sf/public-tools/seo-audit/keyword-evidence/records";
import { AGENT_AUDIT_HEADING_PRESETS } from "@sf/public-tools/agent-audit";
import {
  buildPagePerformanceRecords,
  buildPageWeightRecords,
  buildImageWeightRecords,
  type PagePerformanceGap,
  type PagePerformanceRaw,
  type PageWeightRaw,
  type ImageWeightRaw,
} from "@sf/public-tools/seo-audit/page-performance";
import { createImageWeightReader } from "./image-weight-reader.ts";
import {
  defaultPagePerformanceReader,
  type PagePerformanceReadResult,
} from "./page-performance-reader.ts";
import {
  buildSerpShapeRecords,
  type SerpShapeGap,
  type SerpShapeRaw,
} from "@sf/public-tools/seo-audit/serp-shape";

import { buildKeywordEvidence } from "@sf/public-tools";
import { readSerpLandscape } from "../tools/serp-landscape.ts";
import {
  AGENT_SERP_SHAPE_VERSION,
  AGENT_PAGE_PERFORMANCE_VERSION,
  AGENT_KEYWORD_CHECKS_VERSION,
  isCanonicalIsoTimestamp,
  isSeoAuditUpstreamSuccessEnvelope,
  type AgentAuditResult,
  type AgentAuditSuccessData,
  type AgentSearchPerformance,
  type AgentKind,
  type SerpLandscape,
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
   * The visitor's own Search Console numbers for the audited host, or null.
   *
   * Optional and best-effort by contract. An audit that cannot reach Search
   * Console — no grant, no property covering this host, an expired token, a
   * slow response — is a complete audit with the search checks reporting the
   * authorization they need. It is never a failed audit, so a throw here is
   * caught and read as "no grant" rather than surfaced to the visitor.
   *
   * Takes the collected pages because coverage is a statement about the pages
   * this crawl saw, and the projected result deliberately drops them.
   */
  /**
   * CrUX field data for the collected target page, or null.
   *
   * Optional and best-effort, exactly like Search Console: a run with no key,
   * no field data or a slow PageSpeed response is a complete audit whose
   * performance checks report the source they need. Never a failed audit.
   */
  readonly readPagePerformance?: (input: {
    readonly url: string;
  }) => Promise<PagePerformanceReadResult> | undefined;
  /**
   * Transferred bytes for the target page's own images, or nothing.
   *
   * Best-effort like the two above. These are the only subresource requests
   * this product makes, and they are bounded twice over: to the target page,
   * and to the first images in document order.
   */
  readonly readImageWeights?: (input: {
    readonly sources: readonly string[];
  }) => Promise<
    | {
        readonly status: "ok";
        readonly images: readonly ImageWeightRaw[];
        readonly complete: boolean;
      }
    | { readonly status: "unavailable"; readonly reason: string }
  >;
  readonly readSearchPerformance?: (input: {
    readonly siteOrigin: string;
    readonly pages: SeoAuditReport["pages"];
    readonly targetPageUrl: string | null;
    readonly targetQueries: readonly string[];
    readonly sitemapUrls: readonly string[];
    readonly sitemapUrlsComplete: boolean;
  }) => Promise<AgentSearchPerformance | null>;
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
  /**
   * Reads page one for the primary query, when this boundary wants it.
   *
   * Absent on the SEO Agent's own route: the Agent's cost profile is its own
   * decision, and a seam attached to the shared handler would have spent a
   * provider call on every Agent run without anyone asking for one. The
   * On-Page Checker attaches it, because "who is already on page one, and are
   * you" is the context its report was missing.
   *
   * It must resolve rather than throw: the crawl has already finished by the
   * time this runs, and losing it to a provider timeout would trade the thing
   * the visitor asked for against the thing they did not.
   */
  readonly readSerpLandscape?: (input: {
    readonly query: string | null;
    readonly market: string | null;
    readonly language: string | null;
    readonly targetUrl: string;
  }) => Promise<SerpLandscape>;
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
  readSearchPerformance: (input) => readAgentSearchPerformance(input),
  // Undefined, not a fabricated result. Substituting `no_field_data` here
  // reintroduced the exact lie the reason union exists to prevent: with no key
  // configured — which is production today — all four Core Web Vitals records
  // published "CrUX reported no field data for this URL", a claim about the
  // visitor's own traffic that this run never went and looked for. Leaving it
  // undefined lets the handler's `source_not_configured` initial value stand.
  readPagePerformance: (input) => defaultPagePerformanceReader()?.(input),
  readImageWeights: createImageWeightReader(),
};

/**
 * The same handler, reached from the On-Page Checker's own route.
 *
 * The checker also requires evidence for the submitted page itself, so its
 * delegate rejects an entry redirect that replaces that page before the full
 * crawl starts. Sharing the engine still makes a second check on an
 * already-crawled host fast, and sharing the in-flight gate keeps a checker run
 * and an Agent run on one host from crawling it twice.
 */
export const ON_PAGE_CHECK_DEPENDENCIES: AgentAuditHandlerDependencies = {
  ...DEFAULT_DEPENDENCIES,
  delegate: (request, input) =>
    handleSeoAuditRequest(request, undefined, {
      forceBufferedJson: true,
      input,
      requireSameEntrySubject: true,
    }),
  reportAs: "on-page-seo-check",
  readSerpLandscape: (input) => readSerpLandscape(input),
};

/**
 * The URL the crawl actually landed on for the submitted page, or null.
 *
 * Search Console keys its rows by the URL it indexed, which is the end of the
 * redirect journey. The report carries both: `inspectedTargetUrl` is what was
 * requested and each page's `finalUrl` is where it arrived.
 */
function landedTargetUrl(result: {
  readonly targetInspected: boolean;
  readonly inspectedTargetUrl: string | null;
  readonly targetUrl: string;
  readonly pages: SeoAuditReport["pages"];
}): string | null {
  if (!result.targetInspected) return null;
  const requested = result.inspectedTargetUrl ?? result.targetUrl;
  const page = result.pages.find((entry) => entry.url === requested);
  return page?.finalUrl ?? requested;
}

/**
 * The heading shape the confirmed page type asks for, or null.
 *
 * Null when the visitor confirmed no page type — the checks then report that
 * there is no reviewed range to compare against, which is the honest answer.
 * The range travels with the finding so a reader can judge the judgement.
 */
function headingShapeFor(
  pageRole: string | null | undefined,
  result: { readonly targetPageExtract: SeoAuditTargetPageExtract | null },
): HeadingShapeInput | null {
  if (!pageRole) return null;
  const preset = AGENT_AUDIT_HEADING_PRESETS[pageRole];
  const levels = result.targetPageExtract?.headingLevels;
  if (preset === undefined || levels === undefined || levels === null) {
    return null;
  }
  return {
    levels,
    pageType: preset.pageType,
    h2: preset.h2,
    h3: preset.h3,
    substanceWords: preset.substanceWords,
    wordsUnderEachH3: result.targetPageExtract?.wordsUnderEachH3 ?? [],
  };
}

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
    // Carried, not blanked. This is the population A1 divides by, and an empty
    // list here does not read as "we could not measure" — it reads as "this
    // site declares no sitemap URLs", which is a statement about the site.
    sitemapUrls: [...siteResources.sitemapUrls],
    sitemapUrlsComplete: siteResources.sitemapUrlsComplete,
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
    // Whether the submitted page was inside that population. Without it a
    // conditional rule can only say "not covered", which is false for a page
    // that did qualify and was clean.
    targetTested: record.targetTested,
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
    staticBodyUnits:
      extract.staticBodyUnits === null
        ? null
        : {
            units: extract.staticBodyUnits.units,
            basis: extract.staticBodyUnits.basis,
          },
    termFrequencies:
      extract.termFrequencies === null
        ? null
        : extract.termFrequencies.map((table) => ({
            size: table.size,
            rows: table.rows.map((row) => ({
              phrase: row.phrase,
              count: row.count,
            })),
          })),
    truncatedLists: extract.truncatedLists,
    // Rebuilt field by field like every other projected value, so the browser
    // gets what this boundary decided to publish and not whatever the payload
    // happened to carry.
    headingLevels:
      extract.headingLevels === null ? null : [...extract.headingLevels],
    wordsUnderEachH3:
      extract.wordsUnderEachH3 === null ? null : [...extract.wordsUnderEachH3],
    response: {
      status: extract.response.status,
      finalStatus: extract.response.finalStatus,
      redirectHops: extract.response.redirectHops,
      responseMs: extract.response.responseMs,
      contentType: extract.response.contentType,
      canonicalTarget: extract.response.canonicalTarget,
      robotsIndexable: extract.response.robotsIndexable,
      robotsDirectives: [...extract.response.robotsDirectives],
      sitemapMember: extract.response.sitemapMember,
      jsonLdTypes: [...extract.response.jsonLdTypes],
      jsonLdErrorCount: extract.response.jsonLdErrorCount,
      internalOutlinks: extract.response.internalOutlinks,
      internalOutlinksWithoutAnchorText:
        extract.response.internalOutlinksWithoutAnchorText,
    },
    // Passed through rather than re-listed field by field: a hand-written copy
    // of this shape is a copy that silently drops whatever the parser learns
    // next, and this file already lost `images.first` that way.
    declared: extract.declared,
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
  // Never lets Search Console decide whether the audit succeeded — but the two
  // ways it can produce nothing are different facts, and only one of them is
  // fixed by authorizing.
  let searchPerformance: AgentSearchPerformance | null = null;
  let searchUnavailable = false;
  try {
    searchPerformance =
      (await dependencies.readSearchPerformance?.({
        siteOrigin: result.siteOrigin,
        pages: result.pages,
        // The URL the crawl LANDED on — `finalUrl`, not `inspectedTargetUrl`.
        //
        // `inspectedTargetUrl` is the URL the crawl requested, so on any site
        // that redirects (trailing slash, http to https) the equality filter
        // was sent the pre-redirect form, matched nothing, and 9.5 published
        // "Search Console reported no impressions for this URL" about a page
        // that ranks. This comment described that failure while the line below
        // it caused it.
        targetPageUrl: landedTargetUrl(result),
        // A1's denominator: the pages this site declares it wants indexed.
        sitemapUrls: result.siteResources.sitemapUrls,
        sitemapUrlsComplete: result.siteResources.sitemapUrlsComplete,
        // The visitor's own spelling, not the lowercase identity: it is echoed
        // back in the evidence, and the match lowercases both sides anyway.
        targetQueries: (input.value.targetQueries ?? []).map(
          (query) => query.displayQuery,
        ),
      })) ?? null;
  } catch {
    searchPerformance = null;
    searchUnavailable = true;
  }

  // Never lets PageSpeed decide whether the audit succeeded. Every way it can
  // produce nothing — no key, no field data, a slow answer, a shared-quota 429
  // — is the same settled outcome, and the records name which one.
  let pagePerformance: PagePerformanceRaw | null = null;
  let pageWeight: PageWeightRaw | null = null;
  let imageWeights: readonly ImageWeightRaw[] | null = null;
  let imageWeightLimitation = "no_image_weights_were_measured_for_this_run";
  let imageWeightsComplete = true;
  let pagePerformanceGap: PagePerformanceGap = "source_not_configured";
  if (result.targetInspected) {
    try {
      const read = await dependencies.readPagePerformance?.({
        // The landed URL, for the same reason the search region above uses it:
        // `inspectedTargetUrl` is what the crawl REQUESTED, so on a site that
        // redirects we were asking PageSpeed about a URL that 301s. CrUX has no
        // url-level sample for a redirect, so 8.1-8.4 quietly fell back to the
        // whole origin's p75 on every such site — the fast page inheriting the
        // slow site's verdict that this module's own comment warns about.
        url: landedTargetUrl(result) ?? result.targetUrl,
      });
      if (read?.status === "ok") {
        pagePerformance = read.field;
      } else if (read !== undefined) {
        pagePerformanceGap = read.reason;
      }
      // Independent of the field block: a page too new for CrUX still weighs
      // something, and that is exactly the page 8.5 is worth running on.
      pageWeight = read?.weight ?? null;
    } catch {
      pagePerformanceGap = "provider_unavailable";
    }
    try {
      const sources = result.targetPageExtract?.declared?.images.sources ?? [];
      const weighed = await dependencies.readImageWeights?.({ sources });
      if (weighed?.status === "ok") {
        imageWeights = weighed.images;
        imageWeightsComplete = weighed.complete;
      } else if (weighed?.status === "unavailable") {
        imageWeightLimitation =
          weighed.reason === "no_images_declared"
            ? "the_page_declared_no_images_to_weigh"
            : "no_declared_image_could_be_fetched_this_run";
      }
    } catch {
      pagePerformanceGap = "provider_unavailable";
    }
  }

  const evidence =
    input.value.targetQueries === null
      ? null
      : buildKeywordEvidence(
          result.targetPageExtract,
          input.value.targetQueries,
          input.value.pageRole,
          result.targetInspected,
        );

  // One paid call, for the query the evidence layer already chose as primary.
  // Choosing again here would let the results page and the coverage table
  // disagree about which word this page is being judged on.
  const primaryQuery =
    evidence !== null && evidence.availability === "available"
      ? ((
          evidence.queries.find((query) => query.isPrimary) ??
          evidence.queries[0]
        )?.displayQuery ?? null)
      : null;
  // Wrapped even though the seam's own contract is that it resolves. The crawl
  // has already succeeded and the credit is already spent by the time this
  // runs, so the cost of a throw here is the whole check — and this is the
  // frame that would return the 500. A seam that breaks its contract should
  // cost its own section, not the report.
  let landscape: SerpLandscape | null = null;
  if (dependencies.readSerpLandscape !== undefined) {
    try {
      landscape = await dependencies.readSerpLandscape({
        query: primaryQuery,
        market: input.value.market,
        language: input.value.language,
        targetUrl: result.inspectedTargetUrl ?? result.targetUrl,
      });
    } catch {
      landscape = {
        availability: "unavailable",
        reason: "provider_unavailable",
      };
    }
  }

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
      ...(evidence === null
        ? {}
        : {
            keywordEvidence: evidence,
            // The same region restated as records, so the checks about the
            // confirmed query read evidence rather than an empty form.
            keywordChecks: {
              version: AGENT_KEYWORD_CHECKS_VERSION,
              records: buildKeywordEvidenceRecords(
                result.inspectedTargetUrl ?? result.targetUrl,
                evidence,
                headingShapeFor(input.value.pageRole, result),
                result.targetPageExtract?.response.jsonLdTypes ?? null,
              ),
            },
          }),
      ...(landscape === null ? {} : { serpLandscape: landscape }),
      // 9.1 and 9.4 read the landscape the checker already paid for. They add
      // no provider call of their own: a second lookup for the same query in
      // the same run doubles the cost of every audit to learn the same fact.
      ...(landscape === null
        ? {}
        : {
            serpShape: {
              version: AGENT_SERP_SHAPE_VERSION,
              records: buildSerpShapeRecords(
                landscape.availability === "available"
                  ? {
                      keyword: landscape.query,
                      itemTypes: landscape.features,
                      unresolvedItemCount: 0,
                      organicCount: landscape.resultsObserved,
                      domainTraffic: landscape.domainTraffic,
                      marketCode: landscape.market,
                      languageCode: landscape.language,
                    }
                  : null,
                landscape.availability === "available"
                  ? "no_confirmed_query"
                  : landscape.reason === "no_target_query"
                    ? "no_confirmed_query"
                    : landscape.reason === "market_not_supported"
                      ? "market_not_supported"
                      : landscape.reason === "provider_not_configured"
                        ? "source_not_configured"
                        : "provider_unavailable",
              ),
            },
          }),
      // Same reason, one step further: a cache row is shared by host and these
      // numbers belong to one visitor's verified property.
      ...(searchPerformance === null ? {} : { searchPerformance }),
      ...(result.targetInspected
        ? {
            pagePerformance: {
              version: AGENT_PAGE_PERFORMANCE_VERSION,
              records: [
                ...buildPagePerformanceRecords(
                  pagePerformance,
                  pagePerformanceGap,
                ),
                // Rides in the same region because it shares the region's whole
                // reason for existing: it is one visitor's paid measurement of
                // one page, and `page_performance` is excluded from
                // CRAWL_CATEGORIES so it can never reach the shared cache row.
                ...buildPageWeightRecords(pageWeight, pagePerformanceGap),
                ...buildImageWeightRecords(
                  imageWeights,
                  imageWeightLimitation,
                  imageWeightsComplete,
                ),
              ],
            },
          }
        : {}),
      ...(searchUnavailable ? { searchPerformanceUnavailable: true } : {}),
    },
  };

  dependencies.reportFirstRun?.(dependencies.reportAs);
  return Response.json(
    { data: projected },
    { status: upstream.status, headers: successHeaders(cache) },
  );
}
