import {
  buildInternalLinkAuditPayload,
  createPublicToolError,
  normalizeInternalLinkAuditUrl,
  scanInternalLinkAuditSite,
  InternalLinkAuditScanError,
  type InternalLinkAuditRaw,
  type InternalLinkAuditPayload,
  type InternalLinkAuditUrlResult,
} from "@sf/public-tools";
import { extractClientIp } from "../rate-limit.ts";
import { readPublicToolJson } from "./public-tool-request.ts";
import {
  openCrawlGate,
  type CrawlGateResult,
  DEFAULT_CRAWL_GATE_DEPENDENCIES,
} from "./crawl-gate.ts";
import {
  cacheCompletedCrawl,
  readCrawlCache,
  writeCrawlCache,
  targetHostOf,
} from "./crawl-cache.ts";

// Keep cached payloads isolated by response contract. Otherwise a v2 result
// can survive a deploy and reach the v3 UI for up to the cache TTL.
const CACHE_NAMESPACE = "internal_link_audit.v3";

const REQUEST_BODY_LIMIT_BYTES = 4_096;

export interface InternalLinkAuditHandlerDependencies {
  readonly normalizeUrl: (value: unknown) => InternalLinkAuditUrlResult;
  /** Receives the request signal so a client disconnect aborts the crawl. */
  readonly scan: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<InternalLinkAuditRaw>;
  readonly buildPayload: (
    raw: InternalLinkAuditRaw,
  ) => InternalLinkAuditPayload;
  readonly extractClientIp: (headers: Headers) => string;
  /**
   * Shared with seo-audit. The old fuse here was a per-isolate Map, so it reset
   * on every cold start, and it was keyed per tool — a caller who spent it
   * simply moved to /api/tools/seo-audit, which runs the identical crawl.
   */
  readonly openGate: (
    clientIp: string,
    normalizedUrl: string,
  ) => Promise<CrawlGateResult>;
  /**
   * Store a fresh result so the next caller asking about this same site does
   * not send it another crawl's worth of traffic. Never allowed to fail the
   * request it just served, and reached only for a run that finished on its
   * own terms — see `cacheCompletedCrawl`.
   */
  readonly cachePayload: (
    normalizedUrl: string,
    payload: InternalLinkAuditPayload,
  ) => Promise<void>;
}

const DEFAULT_DEPENDENCIES: InternalLinkAuditHandlerDependencies = {
  normalizeUrl: normalizeInternalLinkAuditUrl,
  scan: scanInternalLinkAuditSite,
  buildPayload: buildInternalLinkAuditPayload,
  extractClientIp,
  openGate: (clientIp, normalizedUrl) =>
    openCrawlGate(
      clientIp,
      normalizedUrl,
      DEFAULT_CRAWL_GATE_DEPENDENCIES,
      (host) => readCrawlCache(CACHE_NAMESPACE, host),
    ),
  cachePayload: async (normalizedUrl, payload) => {
    const host = targetHostOf(normalizedUrl);
    if (host) await writeCrawlCache(CACHE_NAMESPACE, host, payload);
  },
};

function json(
  body: unknown,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function inputUrl(
  body: unknown,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, "url")
  ) {
    return { ok: false };
  }
  return { ok: true, value: (body as { readonly url?: unknown }).url };
}

export async function handleInternalLinkAuditRequest(
  request: Request,
  dependencies: InternalLinkAuditHandlerDependencies = DEFAULT_DEPENDENCIES,
): Promise<Response> {
  const body = await readPublicToolJson(request, REQUEST_BODY_LIMIT_BYTES);
  if (!body.ok) {
    const status =
      body.code === "unsupported_media_type"
        ? 415
        : body.code === "payload_too_large"
          ? 413
          : 400;
    return json(createPublicToolError(body.code), status);
  }
  const input = inputUrl(body.value);
  if (!input.ok) return json(createPublicToolError("invalid_request"), 400);
  const normalized = dependencies.normalizeUrl(input.value);
  if (!normalized.ok) return json(createPublicToolError(normalized.code), 400);

  const ip = dependencies.extractClientIp(request.headers);
  const gate = await dependencies.openGate(ip, normalized.url);
  if (!gate.ok) return gate.response;
  if (gate.kind === "cached") {
    gate.release();
    // The payload carries the timestamp of the crawl that produced it, which
    // both tools render, so a cached answer never reads as a fresh one.
    return json({ data: gate.payload }, 200, {
      "X-Crawl-Cache": "hit",
      "X-Crawl-Captured-At": gate.capturedAt,
    });
  }
  try {
    const raw = await dependencies.scan(normalized.url, request.signal);
    const payload = dependencies.buildPayload(raw);
    await cacheCompletedCrawl({
      raw,
      payload,
      normalizedUrl: normalized.url,
      cachePayload: dependencies.cachePayload,
    });
    return json({ data: payload }, 200);
  } catch (error) {
    if (error instanceof InternalLinkAuditScanError) {
      if (error.code === "timeout") {
        return json(createPublicToolError("scan_timeout"), 504);
      }
      if (error.code === "blocked") {
        return json(createPublicToolError("invalid_url"), 400);
      }
      // The site made a decision, or we could not read its rules. Neither is
      // "the audit failed", and the reader deserves to know which it was.
      if (
        error.code === "robots_disallowed" ||
        error.code === "robots_unreachable"
      ) {
        return json(createPublicToolError(error.code), 422);
      }
    }
    return json(createPublicToolError("scan_failed"), 502);
  } finally {
    gate.release();
  }
}
