import {
  buildSeoAuditPayload,
  createPublicToolError,
  normalizeSeoAuditUrl,
  scanSeoAuditSite,
  SeoAuditScanError,
  type SeoAuditPayload,
  type SeoAuditProgress,
  type SeoAuditRaw,
  type SeoAuditUrlResult,
} from "@sf/public-tools";
import {
  isCanonicalIsoTimestamp,
  isSeoAuditPayload,
} from "@sf/public-tools/seo-audit/contract";
import { extractClientIp } from "../rate-limit.ts";
import { readPublicToolJson } from "./public-tool-request.ts";
import {
  readSeoAuditInput,
  SEO_AUDIT_REQUEST_BODY_LIMIT_BYTES,
  type SeoAuditRequestInput,
} from "./seo-audit-input.ts";
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

const TOOL_NAME = "seo_audit";

/** The line-delimited progress transport, requested by the browser client only. */
const NDJSON_MEDIA_TYPE = "application/x-ndjson";

/**
 * Re-send the last real observation if nothing has gone out for this long.
 *
 * The crawler paces itself to one wire request per 250 ms, so a silence longer
 * than this means the site itself is slow, not that the run ended. Repeating a
 * number the crawl actually reported is not fabrication, and it is what stops
 * an intermediary from deciding the connection is dead.
 */
const PROGRESS_KEEPALIVE_MS = 15_000;

/**
 * The one non-terminal stage this endpoint reports: the crawl has returned and
 * the request is now building, serializing and storing the report. The client
 * cannot infer this boundary — it sees only that the page count stopped
 * moving — so it is stated on the wire.
 */
const BUILDING_REPORT_STAGE = "building_report";

export interface SeoAuditHandlerDependencies {
  readonly normalizeUrl: (value: unknown) => SeoAuditUrlResult;
  /**
   * Receives the request signal so a client disconnect aborts the crawl, and
   * an observation sink that is passed only when the caller negotiated the
   * streamed branch.
   */
  readonly scan: (
    url: string,
    signal?: AbortSignal,
    onProgress?: (progress: SeoAuditProgress) => void,
  ) => Promise<SeoAuditRaw>;
  readonly buildPayload: (raw: SeoAuditRaw) => SeoAuditPayload;
  readonly extractClientIp: (headers: Headers) => string;
  /**
   * Admission control. This handler previously imported `extractClientIp` and
   * nothing else from the limiter module: no request counter of any kind ran
   * before the crawl, so one IP could replay a 240-second, 4,500-request crawl
   * back to back indefinitely.
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
    payload: SeoAuditPayload,
  ) => Promise<void>;
}

export interface SeoAuditHandlerOptions {
  /** Keeps internal callers on the buffered JSON contract regardless of Accept. */
  readonly forceBufferedJson?: boolean;
  /**
   * An already-read, already-validated body.
   *
   * A request body can be read once. The Agent boundary has to read it to build
   * the keyword region from this visitor's queries, and it must hand the
   * request itself down rather than a copy, because a reconstructed Request
   * lost Next's own state and crashed in production. So it passes what it
   * parsed instead, which also means one parse and one validation rather than
   * two that could disagree.
   */
  readonly input?: SeoAuditRequestInput;
}

const DEFAULT_DEPENDENCIES: SeoAuditHandlerDependencies = {
  normalizeUrl: normalizeSeoAuditUrl,
  // The key is present only when there is a listener. `{ onProgress }` with an
  // undefined value is a different type under exactOptionalPropertyTypes,
  // which the packages build enforces.
  scan: (url, signal, onProgress) =>
    scanSeoAuditSite(url, signal, { ...(onProgress ? { onProgress } : {}) }),
  buildPayload: buildSeoAuditPayload,
  extractClientIp,
  openGate: (clientIp, normalizedUrl) =>
    openCrawlGate(
      clientIp,
      normalizedUrl,
      DEFAULT_CRAWL_GATE_DEPENDENCIES,
      async (host) => {
        const cached = await readCrawlCache(TOOL_NAME, host);
        return cached && cachedSeoAuditMatches(cached, normalizedUrl)
          ? cached
          : null;
      },
    ),
  cachePayload: async (normalizedUrl, payload) => {
    const host = targetHostOf(normalizedUrl);
    if (host) await writeCrawlCache(TOOL_NAME, host, payload);
  },
};

function json(
  body: unknown,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

/**
 * One mapping from a scan failure to the code the reader sees, shared by both
 * branches so the streamed and buffered answers can never drift apart.
 */
export function seoAuditErrorCode(error: unknown): string {
  if (error instanceof SeoAuditScanError) {
    if (error.code === "timeout") return "scan_timeout";
    if (error.code === "blocked") return "invalid_url";
    // The site made a decision, or we could not read its rules. Neither is
    // "the audit failed", and the reader deserves to know which it was.
    if (
      error.code === "robots_disallowed" ||
      error.code === "robots_unreachable"
    ) {
      return error.code;
    }
  }
  return "scan_failed";
}

const SCAN_ERROR_STATUS: Readonly<Record<string, number>> = {
  scan_timeout: 504,
  invalid_url: 400,
  robots_disallowed: 422,
  robots_unreachable: 422,
  scan_failed: 502,
};

/** A cache row is reusable only when both its payload and provenance are current. */
function cachedSeoAuditMatches(
  cached: { readonly payload: unknown; readonly capturedAt: string },
  normalizedUrl: string,
): boolean {
  return (
    isCanonicalIsoTimestamp(cached.capturedAt) &&
    isSeoAuditPayload(cached.payload) &&
    cached.payload.result.targetUrl === normalizedUrl
  );
}

export async function handleSeoAuditRequest(
  request: Request,
  dependencies: SeoAuditHandlerDependencies = DEFAULT_DEPENDENCIES,
  options: SeoAuditHandlerOptions = {},
): Promise<Response> {
  const preParsed = options.input;
  const body =
    preParsed === undefined
      ? await readPublicToolJson(request, SEO_AUDIT_REQUEST_BODY_LIMIT_BYTES)
      : ({ ok: true, value: undefined } as const);
  if (!body.ok) {
    const status =
      body.code === "unsupported_media_type"
        ? 415
        : body.code === "payload_too_large"
          ? 413
          : 400;
    return json(createPublicToolError(body.code), status);
  }

  const input =
    preParsed === undefined
      ? readSeoAuditInput(body.value)
      : ({ ok: true, value: preParsed } as const);
  if (!input.ok) {
    return json(createPublicToolError("invalid_request"), 400);
  }
  const normalized = dependencies.normalizeUrl(input.value.url);
  if (!normalized.ok) {
    return json(createPublicToolError(normalized.code), 400);
  }

  const ip = dependencies.extractClientIp(request.headers);
  const gate = await dependencies.openGate(ip, normalized.url);
  if (!gate.ok) return gate.response;
  if (gate.kind === "cached" && cachedSeoAuditMatches(gate, normalized.url)) {
    gate.release();
    // The payload carries the timestamp of the crawl that produced it, which
    // both tools render, so a cached answer never reads as a fresh one.
    return json({ data: gate.payload }, 200, {
      "X-Crawl-Cache": "hit",
      "X-Crawl-Captured-At": gate.capturedAt,
    });
  }

  if (options.forceBufferedJson !== true && wantsProgressStream(request)) {
    return streamSeoAudit(request, normalized.url, gate.release, dependencies);
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
    const code = seoAuditErrorCode(error);
    return json(createPublicToolError(code), SCAN_ERROR_STATUS[code] ?? 502);
  } finally {
    gate.release();
  }
}

/**
 * A caller that did not ask for NDJSON gets today's code path, byte for byte,
 * including every status code. Only the browser client sends this header, and
 * that gate is what keeps the change contract-safe.
 */
function wantsProgressStream(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes(NDJSON_MEDIA_TYPE);
}

/**
 * The wire shape of one observation: both figures, always together, so a
 * reader never has one of them updated and the other stale. `pagesCrawled` is
 * the crawl engine's collected-page count — the same figure the terminal
 * payload states as `coverage.pagesInspected` — and `requestsSent` counts wire
 * requests, which run ahead of it.
 */
function progressLine(progress: SeoAuditProgress): {
  readonly pagesCrawled: number;
  readonly requestsSent: number;
} {
  return {
    pagesCrawled: progress.pagesCrawled,
    requestsSent: progress.requestsSent,
  };
}

/**
 * Leave a server-side record of a failure the status code can no longer carry.
 *
 * Once the NDJSON headers are flushed the answer is 200 and the failure is a
 * body line — and every real browser negotiates this branch, so essentially
 * all traffic takes it. Without this, both signals an operator has go dark at
 * once: no status code moves, and nothing is written down. The buffered branch
 * still maps to 502/504/422/400 and is observable that way.
 *
 * Host only, as the crawl-gate and traffic-drop logs do: it is the whole
 * target of an origin-scoped crawl, and the submitted URL never reaches the
 * log. `clientGone` separates a reader who left mid-crawl — which is not our
 * failure — from one that is.
 */
function logStreamedFailure(
  code: string,
  normalizedUrl: string,
  error: unknown,
  clientGone: boolean,
): void {
  console.error(
    "[seo-audit] streamed crawl failed:",
    JSON.stringify({
      code,
      targetHost: targetHostOf(normalizedUrl),
      clientGone,
      reason: error instanceof Error ? error.message : String(error),
    }),
  );
}

/**
 * The same crawl, narrated while it runs.
 *
 * Four disjoint top-level keys, one JSON value per newline: `progress` zero or
 * more times, at most one `stage` once the crawl has returned, then exactly
 * one terminal `data` or `error`. The terminal `data` line is the identical
 * body the buffered branch returns.
 *
 * The keepalive keeps running after `stage`, so a repeat of the crawl's last
 * observation can follow it. That is deliberate: building and storing the
 * report takes seconds on a large site, and an intermediary that hears nothing
 * decides the connection is dead.
 *
 * Elapsed time is deliberately absent from the wire. The client measures it
 * against its own clock, and two elapsed numbers would invite a blended one.
 */
function streamSeoAudit(
  request: Request,
  normalizedUrl: string,
  release: () => void,
  dependencies: SeoAuditHandlerDependencies,
): Response {
  const encoder = new TextEncoder();
  // Linked, not shared: a client disconnect and a cancelled response body must
  // both end the crawl, and neither may be the only way to do it.
  const abort = new AbortController();
  const abortNow = (): void => abort.abort();
  if (request.signal.aborted) abortNow();
  else request.signal.addEventListener("abort", abortNow, { once: true });

  let closed = false;
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastWriteAt = 0;
      let lastSent: SeoAuditProgress | null = null;
      let latest: SeoAuditProgress | null = null;

      const write = (value: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
          lastWriteAt = Date.now();
        } catch {
          // The reader went away between the guard and the enqueue. Nobody is
          // listening now, so the crawl must end here: left running it spends
          // its whole budget at the target site and holds this IP's in-flight
          // slot. `release()` stays with the scan's own finally.
          closed = true;
          abortNow();
        }
      };

      /**
       * Every number on the wire is one the crawl reported, at the moment it
       * reported it. This handler keeps no counter of its own and never
       * interpolates between two observations.
       */
      const observe = (progress: SeoAuditProgress): void => {
        const unchanged =
          lastSent !== null &&
          lastSent.pagesCrawled === progress.pagesCrawled &&
          lastSent.requestsSent === progress.requestsSent;
        latest = progress;
        if (unchanged) return;
        lastSent = progress;
        write({ progress: progressLine(progress) });
      };

      keepAlive = setInterval(() => {
        if (latest === null) return;
        if (Date.now() - lastWriteAt < PROGRESS_KEEPALIVE_MS) return;
        write({ progress: progressLine(latest) });
      }, PROGRESS_KEEPALIVE_MS);

      // Not returned from start(): start()'s promise gates `pull` and turns a
      // crawl rejection into a stream error. Queued chunks are readable either
      // way, so no test distinguishes the two forms.
      void (async () => {
        try {
          const raw = await dependencies.scan(
            normalizedUrl,
            abort.signal,
            observe,
          );
          // The crawl has stopped here; nothing further is fetched from the
          // site. Everything below — the report over up to 2,000 pages, its
          // serialization, the cache round trip — is this window, and the
          // panel would otherwise keep claiming a crawl through all of it.
          write({ stage: BUILDING_REPORT_STAGE });
          const payload = dependencies.buildPayload(raw);
          // Cache first: an early close must not be able to skip the write
          // that spares the next visitor a whole crawl of this site.
          await cacheCompletedCrawl({
            raw,
            payload,
            normalizedUrl,
            cachePayload: dependencies.cachePayload,
          });
          write({ data: payload });
        } catch (error) {
          const code = seoAuditErrorCode(error);
          logStreamedFailure(code, normalizedUrl, error, abort.signal.aborted);
          write({ error: { code } });
        } finally {
          clearInterval(keepAlive);
          release();
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by cancel(); the run is over either way.
          }
        }
      })();
    },
    cancel() {
      clearInterval(keepAlive);
      closed = true;
      abortNow();
      release();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": NDJSON_MEDIA_TYPE,
      // no-transform keeps a compressing proxy from buffering the whole run.
      "Cache-Control": "no-store, no-transform",
      Vary: "Accept",
      "X-Accel-Buffering": "no",
      "X-Public-Tool-Stream": "ndjson",
    },
  });
}
