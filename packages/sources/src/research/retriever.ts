import { createHash } from "node:crypto";
import { fetch as undiciFetch, type Dispatcher } from "undici";
import type { Availability } from "../adapter.ts";
import { parsePage } from "../crawl/parse-page.ts";
import { boundChars } from "../crawl/types.ts";
import {
  canonicalUrlGuard,
  createPinnedAgent,
  normalizeUrl,
  type UrlGuardResult,
} from "../url-safety/index.ts";

/**
 * This adapter is intentionally a Worker-invoked provider boundary. Importing
 * it creates no timers, DNS lookups, agents, or requests.
 */
export const PUBLIC_WEB_RESEARCH_ADAPTER_VERSION = "public_web_research.v1";
export const PUBLIC_WEB_RESEARCH_CONTENT_HASH_METHOD =
  "sha256_normalized_text";

export const PUBLIC_WEB_RESEARCH_LIMITS = Object.freeze({
  maxTargets: 8,
  maxBodyBytes: 256 * 1024,
  maxTotalBytes: 1024 * 1024,
  maxRedirects: 4,
  requestTimeoutMs: 15_000,
  maxWallClockMs: 60_000,
  maxUrlChars: 2_048,
  maxContentTypeChars: 256,
  maxContentTextChars: 64 * 1024,
  maxExcerptChars: 1_000,
});

export const PUBLIC_WEB_RESEARCH_USER_AGENT =
  "GenGrowth-Public-Web-Research/1.0";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ACCEPTED_MEDIA_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
]);

export type PublicWebResearchStopReason =
  | "max_total_bytes"
  | "max_wall_clock"
  | "aborted";

export type PublicWebResearchUrlGuard = (
  url: string,
  signal: AbortSignal,
) => Promise<UrlGuardResult>;

export interface PublicWebResearchFetchInit {
  readonly method: "GET";
  readonly redirect: "manual";
  readonly signal: AbortSignal;
  readonly pinnedIp: string;
  readonly dispatcher: Dispatcher;
  readonly headers: Readonly<Record<string, string>>;
}

export type PublicWebResearchFetch = (
  url: string,
  init: PublicWebResearchFetchInit,
) => Promise<Response>;

const defaultPublicWebResearchFetch: PublicWebResearchFetch = (
  url,
  init,
) =>
  undiciFetch(url, {
    method: init.method,
    redirect: init.redirect,
    signal: init.signal,
    dispatcher: init.dispatcher,
    headers: init.headers,
  }) as unknown as Promise<Response>;

export interface PublicWebResearchSnapshot {
  /** Guard-normalized initial URL, or a credential-redacted rejected input. */
  readonly requestedUrl: string;
  /** Last guard-approved URL in the request journey. */
  readonly finalUrl: string | null;
  /** SHA-256 (hex) of finalUrl; null when no URL passed the safety guard. */
  readonly urlHash: string | null;
  /**
   * SHA-256 (hex) of the full normalized extraction. When contentTruncated is
   * true, this intentionally identifies the omitted tail as well as contentText.
   */
  readonly contentHash: string | null;
  readonly capturedAt: string;
  readonly title: string | null;
  readonly excerpt: string | null;
  readonly contentText: string | null;
  readonly status: number | null;
  readonly contentType: string | null;
  /** Decoded bytes admitted under both page and batch byte budgets. */
  readonly bodyBytes: number;
  readonly wordCount: number;
  /**
   * True only when normalized contentText exceeded its fixed projection bound.
   * An ordinary shorter excerpt never sets this flag.
   */
  readonly contentTruncated: boolean;
  /** True when excerpt is a bounded preview of a longer normalized body. */
  readonly excerptTruncated: boolean;
  readonly responseMs: number;
  /** Guard-approved redirect targets, in followed order. */
  readonly redirectChain: readonly string[];
  readonly availability: Availability;
  readonly limitation: string | null;
}

export interface PublicWebResearchUsage {
  readonly targetCount: number;
  readonly attemptedTargets: number;
  readonly availableTargets: number;
  readonly partialTargets: number;
  readonly unavailableTargets: number;
  readonly bodyBytes: number;
  readonly redirectsFollowed: number;
  readonly elapsedMs: number;
}

export interface PublicWebResearchBatch {
  readonly adapterVersion: typeof PUBLIC_WEB_RESEARCH_ADAPTER_VERSION;
  readonly sources: readonly PublicWebResearchSnapshot[];
  readonly availability: Availability;
  readonly limitation: string | null;
  readonly stopReason: PublicWebResearchStopReason | null;
  readonly usage: PublicWebResearchUsage;
}

export interface PublicWebResearchOptions {
  readonly signal?: AbortSignal;
  /** Test seam; production always uses canonicalUrlGuard. */
  readonly guard?: PublicWebResearchUrlGuard;
  /** Test seam; production always uses undici with the pinned dispatcher. */
  readonly fetch?: PublicWebResearchFetch;
  /** Test seam for timestamps and deterministic wall-clock assertions. */
  readonly now?: () => number;
}

interface BatchAbortScope {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly dispose: () => void;
}

interface RequestAbortScope {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly dispose: () => void;
}

interface AttemptContext {
  readonly guard: PublicWebResearchUrlGuard;
  readonly fetch: PublicWebResearchFetch;
  readonly now: () => number;
  readonly batchSignal: AbortSignal;
  readonly batchTimedOut: () => boolean;
  readonly remainingTotalBytes: number;
}

interface AttemptResult {
  readonly source: PublicWebResearchSnapshot;
  readonly stopReason: PublicWebResearchStopReason | null;
}

type GuardRace =
  | { readonly kind: "value"; readonly value: UrlGuardResult }
  | { readonly kind: "error" }
  | { readonly kind: "aborted" };

type FetchRace =
  | { readonly kind: "value"; readonly value: Response }
  | { readonly kind: "error" }
  | { readonly kind: "aborted" };

type BodyReadResult =
  | { readonly kind: "ok"; readonly text: string; readonly bytes: number }
  | { readonly kind: "page_limit"; readonly bytes: number }
  | { readonly kind: "total_limit"; readonly bytes: number }
  | { readonly kind: "aborted"; readonly bytes: number }
  | { readonly kind: "error"; readonly bytes: number };

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function timerUnref(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

function createBatchAbortScope(
  externalSignal: AbortSignal | undefined,
): BatchAbortScope {
  const controller = new AbortController();
  let timeoutReached = false;
  const abortFromCaller = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException("research retrieval aborted", "AbortError"));
    }
  };
  if (externalSignal?.aborted) {
    abortFromCaller();
  } else {
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timer = setTimeout(() => {
    timeoutReached = true;
    if (!controller.signal.aborted) {
      controller.abort(
        new DOMException("research batch timed out", "TimeoutError"),
      );
    }
  }, PUBLIC_WEB_RESEARCH_LIMITS.maxWallClockMs);
  timerUnref(timer);
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    dispose: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function createRequestAbortScope(
  batchSignal: AbortSignal,
): RequestAbortScope {
  const controller = new AbortController();
  let timeoutReached = false;
  const abortFromBatch = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(batchSignal.reason);
    }
  };
  if (batchSignal.aborted) {
    abortFromBatch();
  } else {
    batchSignal.addEventListener("abort", abortFromBatch, { once: true });
  }
  const timer = setTimeout(() => {
    timeoutReached = true;
    if (!controller.signal.aborted) {
      controller.abort(
        new DOMException("research request timed out", "TimeoutError"),
      );
    }
  }, PUBLIC_WEB_RESEARCH_LIMITS.requestTimeoutMs);
  timerUnref(timer);
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    dispose: () => {
      clearTimeout(timer);
      batchSignal.removeEventListener("abort", abortFromBatch);
    },
  };
}

function raceWithSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "error" }
  | { readonly kind: "aborted" }
> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (
      result:
        | { readonly kind: "value"; readonly value: T }
        | { readonly kind: "error" }
        | { readonly kind: "aborted" },
    ): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish({ kind: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => finish({ kind: "value", value }),
      () => finish({ kind: "error" }),
    );
    if (signal.aborted) onAbort();
  });
}

function cancelBestEffort(cancel: () => unknown): void {
  try {
    const result = cancel();
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // Cleanup must never replace the stable retrieval result.
  }
}

function cancelResponseBody(response: Response): void {
  cancelBestEffort(() => response.body?.cancel());
}

function releaseDispatcher(
  dispatcher: ReturnType<typeof createPinnedAgent>,
): void {
  // Every Agent is single-hop and never reused. Force-closing it after the body
  // is consumed/cancelled prevents hostile keep-alive or cleanup behavior from
  // extending the fixed request/batch wall-clock boundaries.
  cancelBestEffort(() => dispatcher.destroy());
}

function declaredContentLength(response: Response): number | null {
  const value = response.headers.get("content-length")?.trim();
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function readBoundedBody(
  response: Response,
  remainingTotalBytes: number,
  signal: AbortSignal,
): Promise<BodyReadResult> {
  const declared = declaredContentLength(response);
  if (
    declared !== null &&
    declared > PUBLIC_WEB_RESEARCH_LIMITS.maxBodyBytes
  ) {
    cancelResponseBody(response);
    return { kind: "page_limit", bytes: 0 };
  }
  if (declared !== null && declared > remainingTotalBytes) {
    cancelResponseBody(response);
    return { kind: "total_limit", bytes: 0 };
  }

  const body = response.body;
  if (!body) return { kind: "ok", text: "", bytes: 0 };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const read = await raceWithSignal(
        Promise.resolve().then(() => reader.read()),
        signal,
      );
      if (read.kind === "aborted") {
        cancelBestEffort(() => reader.cancel());
        return { kind: "aborted", bytes };
      }
      if (read.kind === "error") {
        cancelBestEffort(() => reader.cancel());
        return { kind: "error", bytes };
      }
      const next = read.value;
      if (next.done) break;
      const chunk = next.value;
      if (!chunk || chunk.byteLength === 0) continue;
      if (
        bytes + chunk.byteLength >
        PUBLIC_WEB_RESEARCH_LIMITS.maxBodyBytes
      ) {
        cancelBestEffort(() => reader.cancel());
        return { kind: "page_limit", bytes };
      }
      if (bytes + chunk.byteLength > remainingTotalBytes) {
        cancelBestEffort(() => reader.cancel());
        return { kind: "total_limit", bytes };
      }
      chunks.push(chunk);
      bytes += chunk.byteLength;
    }
  } finally {
    cancelBestEffort(() => reader.releaseLock());
  }

  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    kind: "ok",
    text: new TextDecoder().decode(joined),
    bytes,
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(-?(?:x[0-9a-f]+|\d+));/gi, (_match, raw: string) => {
      const number = raw.toLowerCase().startsWith("x")
        ? Number.parseInt(raw.slice(1), 16)
        : Number.parseInt(raw, 10);
      const validScalar =
        Number.isSafeInteger(number) &&
        number > 0 &&
        number <= 0x10ffff &&
        (number < 0xd800 || number > 0xdfff);
      return validScalar ? String.fromCodePoint(number) : "\ufffd";
    });
}

/**
 * `parsePage` remains the authority for title/excerpt/wordCount. Its persisted
 * paragraph/headings projections have their own smaller caps, so contentText
 * must be derived from the full bounded response to tell whether THIS adapter's
 * 64 KiB projection omitted a tail.
 */
function extractNormalizedHtmlBody(html: string): string {
  const body =
    html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ?? html;
  return normalizeText(
    decodeHtmlText(
      body
        .replace(
          /<\s*(script|style|noscript|template|svg|canvas|iframe|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi,
          " ",
        )
        .replace(/<[^>]+>/g, " "),
    ).replace(/\u00a0/g, " "),
  );
}

function boundedProjection(
  value: string,
  maxChars: number,
): {
  readonly value: string;
  readonly truncated: boolean;
} {
  const points = [...value];
  if (points.length <= maxChars) {
    return { value, truncated: false };
  }
  return {
    value: points.slice(0, Math.max(0, maxChars)).join(""),
    truncated: true,
  };
}

function extractContent(
  body: string,
  contentType: string,
  finalUrl: string,
): {
  readonly title: string | null;
  readonly excerpt: string | null;
  readonly contentText: string | null;
  readonly contentHashText: string | null;
  readonly wordCount: number;
  readonly contentTruncated: boolean;
  readonly excerptTruncated: boolean;
} {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "text/plain") {
    const normalized = normalizeText(body);
    const content = boundedProjection(
      normalized,
      PUBLIC_WEB_RESEARCH_LIMITS.maxContentTextChars,
    );
    const excerpt = boundedProjection(
      normalized,
      PUBLIC_WEB_RESEARCH_LIMITS.maxExcerptChars,
    );
    return {
      title: null,
      excerpt: normalized ? excerpt.value : null,
      contentText: normalized ? content.value : null,
      contentHashText: normalized || null,
      wordCount: normalized ? normalized.split(/\s+/).length : 0,
      contentTruncated: normalized ? content.truncated : false,
      excerptTruncated: normalized ? excerpt.truncated : false,
    };
  }

  const parsed = parsePage(body, finalUrl);
  const normalizedBody = extractNormalizedHtmlBody(body);
  const extracted = [parsed.title, normalizedBody]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .trim();
  const content = boundedProjection(
    extracted,
    PUBLIC_WEB_RESEARCH_LIMITS.maxContentTextChars,
  );
  const normalizedExcerpt = normalizeText(parsed.bodyExcerpt ?? "");
  const excerptTruncated =
    normalizedExcerpt.length > 0 &&
    [...normalizedBody].length > [...normalizedExcerpt].length;
  return {
    title: parsed.title,
    excerpt: normalizedExcerpt || null,
    contentText: extracted ? content.value : null,
    contentHashText: extracted || null,
    wordCount: parsed.wordCount,
    contentTruncated: extracted ? content.truncated : false,
    excerptTruncated,
  };
}

function mediaTypeOf(contentType: string | null): string | null {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() || null;
}

function boundedContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  return boundChars(
    contentType,
    PUBLIC_WEB_RESEARCH_LIMITS.maxContentTypeChars,
  );
}

function redactedRequestedUrl(rawUrl: string): string {
  const input = typeof rawUrl === "string" ? rawUrl.trim() : "";
  try {
    // Parse and clear credentials BEFORE bounding. Bounding first can cut an
    // overlong hostname/userinfo section into an invalid URL, after which a raw
    // fallback would persist the very credential the safety guard rejected.
    const parsed = new URL(input);
    parsed.username = "";
    parsed.password = "";
    return boundChars(
      parsed.href,
      PUBLIC_WEB_RESEARCH_LIMITS.maxUrlChars,
    );
  } catch {
    return "[invalid or overlong public-web URL]";
  }
}

function validateGuardedUrl(
  result: UrlGuardResult | null | undefined,
): URL | null {
  if (!result?.safe || !result.normalizedUrl || !result.pinnedIp) return null;
  const normalized = normalizeUrl(result.normalizedUrl);
  if (!normalized || normalized.url.port !== "") return null;
  if (
    normalized.url.href.length > PUBLIC_WEB_RESEARCH_LIMITS.maxUrlChars
  ) {
    return null;
  }
  return normalized.url;
}

function isoTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

interface SnapshotInput {
  readonly rawUrl: string;
  readonly requestedUrl: string | null;
  readonly finalUrl: string | null;
  readonly contentHash: string | null;
  readonly completedAt: number;
  readonly startedAt: number;
  readonly title: string | null;
  readonly excerpt: string | null;
  readonly contentText: string | null;
  readonly status: number | null;
  readonly contentType: string | null;
  readonly bodyBytes: number;
  readonly wordCount: number;
  readonly contentTruncated?: boolean;
  readonly excerptTruncated?: boolean;
  readonly redirectChain: readonly string[];
  readonly availability: Availability;
  readonly limitation: string | null;
}

function snapshot(input: SnapshotInput): PublicWebResearchSnapshot {
  return {
    requestedUrl:
      input.requestedUrl ?? redactedRequestedUrl(input.rawUrl),
    finalUrl: input.finalUrl,
    urlHash: input.finalUrl ? sha256(input.finalUrl) : null,
    contentHash: input.contentHash,
    capturedAt: isoTime(input.completedAt),
    title: input.title,
    excerpt: input.excerpt,
    contentText: input.contentText,
    status: input.status,
    contentType: boundedContentType(input.contentType),
    bodyBytes: input.bodyBytes,
    wordCount: input.wordCount,
    contentTruncated: input.contentTruncated ?? false,
    excerptTruncated: input.excerptTruncated ?? false,
    responseMs: Math.max(
      0,
      Math.round(input.completedAt - input.startedAt),
    ),
    redirectChain: [...input.redirectChain],
    availability: input.availability,
    limitation: input.limitation,
  };
}

function emptySnapshot(
  rawUrl: string,
  now: number,
  limitation: string,
): PublicWebResearchSnapshot {
  return snapshot({
    rawUrl,
    requestedUrl: null,
    finalUrl: null,
    contentHash: null,
    completedAt: now,
    startedAt: now,
    title: null,
    excerpt: null,
    contentText: null,
    status: null,
    contentType: null,
    bodyBytes: 0,
    wordCount: 0,
    redirectChain: [],
    availability: "unavailable",
    limitation,
  });
}

function abortOutcome(
  scope: RequestAbortScope,
  context: AttemptContext,
): {
  readonly stopReason: PublicWebResearchStopReason | null;
  readonly limitation: string;
} {
  if (scope.timedOut()) {
    return {
      stopReason: null,
      limitation:
        "Public-web research request exceeded the fixed 15 second request timeout.",
    };
  }
  if (context.batchTimedOut()) {
    return {
      stopReason: "max_wall_clock",
      limitation:
        "Public-web research stopped at the fixed 60 second wall-clock budget.",
    };
  }
  return {
    stopReason: "aborted",
    limitation: "Public-web research was aborted by the caller.",
  };
}

async function retrieveOne(
  rawUrl: string,
  context: AttemptContext,
): Promise<AttemptResult> {
  const startedAt = context.now();
  if (
    typeof rawUrl !== "string" ||
    rawUrl.trim().length === 0 ||
    rawUrl.length > PUBLIC_WEB_RESEARCH_LIMITS.maxUrlChars
  ) {
    return {
      stopReason: null,
      source: emptySnapshot(
        rawUrl,
        startedAt,
        "Public-web research rejected a target outside the fixed 2,048-character URL length boundary.",
      ),
    };
  }
  let current = rawUrl;
  let requestedUrl: string | null = null;
  let finalUrl: string | null = null;
  let previousFetchedUrl: string | null = null;
  let status: number | null = null;
  let contentType: string | null = null;
  let bodyBytes = 0;
  const redirectChain: string[] = [];

  for (;;) {
    const requestScope = createRequestAbortScope(context.batchSignal);
    let dispatcher: ReturnType<typeof createPinnedAgent> | null = null;
    try {
      const guardRace: GuardRace = await raceWithSignal(
        Promise.resolve().then(() =>
          context.guard(current, requestScope.signal),
        ),
        requestScope.signal,
      );
      if (guardRace.kind === "aborted") {
        const aborted = abortOutcome(requestScope, context);
        const completedAt = context.now();
        return {
          stopReason: aborted.stopReason,
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: null,
            excerpt: null,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: 0,
            redirectChain,
            availability: status === null ? "unavailable" : "partial",
            limitation: aborted.limitation,
          }),
        };
      }
      if (guardRace.kind === "error") {
        const completedAt = context.now();
        return {
          stopReason: null,
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: null,
            excerpt: null,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: 0,
            redirectChain,
            availability: status === null ? "unavailable" : "partial",
            limitation:
              "URL was rejected by the public-web safety guard.",
          }),
        };
      }
      const target = validateGuardedUrl(guardRace.value);
      if (!target) {
        const completedAt = context.now();
        return {
          stopReason: null,
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: null,
            excerpt: null,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: 0,
            redirectChain,
            availability: status === null ? "unavailable" : "partial",
            limitation:
              "URL was rejected by the public-web safety guard.",
          }),
        };
      }

      const guardedUrl = target.href;
      requestedUrl ??= guardedUrl;
      if (
        previousFetchedUrl !== null &&
        new URL(previousFetchedUrl).protocol === "https:" &&
        target.protocol === "http:"
      ) {
        const completedAt = context.now();
        return {
          stopReason: null,
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: null,
            excerpt: null,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: 0,
            redirectChain,
            availability: "partial",
            limitation:
              "Public-web research rejected an HTTPS-to-HTTP redirect downgrade.",
          }),
        };
      }
      if (previousFetchedUrl !== null) redirectChain.push(guardedUrl);
      finalUrl = guardedUrl;

      try {
        dispatcher = createPinnedAgent(
          target.hostname,
          guardRace.value.pinnedIp!,
        );
      } catch {
        const completedAt = context.now();
        return {
          stopReason: null,
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: null,
            excerpt: null,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: 0,
            redirectChain,
            availability: status === null ? "unavailable" : "partial",
            limitation:
              "URL was rejected by the public-web safety guard.",
          }),
        };
      }

      const fetchRace: FetchRace = await raceWithSignal(
        Promise.resolve().then(() =>
          context.fetch(guardedUrl, {
            method: "GET",
            redirect: "manual",
            signal: requestScope.signal,
            pinnedIp: guardRace.value.pinnedIp!,
            dispatcher: dispatcher!,
            headers: {
              accept: "text/html, application/xhtml+xml, text/plain",
              "accept-encoding": "identity",
              "user-agent": PUBLIC_WEB_RESEARCH_USER_AGENT,
            },
          }),
        ),
        requestScope.signal,
      );
      if (fetchRace.kind === "aborted") {
        const aborted = abortOutcome(requestScope, context);
        const completedAt = context.now();
        return {
          stopReason: aborted.stopReason,
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: null,
            excerpt: null,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: 0,
            redirectChain,
            availability: status === null ? "unavailable" : "partial",
            limitation: aborted.limitation,
          }),
        };
      }
      if (fetchRace.kind === "error") {
        const completedAt = context.now();
        return {
          stopReason: null,
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: null,
            excerpt: null,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: 0,
            redirectChain,
            availability: status === null ? "unavailable" : "partial",
            limitation:
              "Public-web research transport failed before a usable response was captured.",
          }),
        };
      }

      const response = fetchRace.value;
      status = response.status;
      contentType = response.headers.get("content-type");
      if (REDIRECT_STATUSES.has(status)) {
        const location = response.headers.get("location");
        if (location) {
          cancelResponseBody(response);
          if (
            redirectChain.length >=
            PUBLIC_WEB_RESEARCH_LIMITS.maxRedirects
          ) {
            const completedAt = context.now();
            return {
              stopReason: null,
              source: snapshot({
                rawUrl,
                requestedUrl,
                finalUrl,
                contentHash: null,
                completedAt,
                startedAt,
                title: null,
                excerpt: null,
                contentText: null,
                status,
                contentType,
                bodyBytes,
                wordCount: 0,
                redirectChain,
                availability: "partial",
                limitation:
                  "Public-web research stopped at the fixed four-redirect limit.",
              }),
            };
          }
          let redirected: URL;
          try {
            redirected = new URL(location, guardedUrl);
          } catch {
            const completedAt = context.now();
            return {
              stopReason: null,
              source: snapshot({
                rawUrl,
                requestedUrl,
                finalUrl,
                contentHash: null,
                completedAt,
                startedAt,
                title: null,
                excerpt: null,
                contentText: null,
                status,
                contentType,
                bodyBytes,
                wordCount: 0,
                redirectChain,
                availability: "partial",
                limitation:
                  "Public-web research rejected an invalid redirect target.",
              }),
            };
          }
          if (
            redirected.href.length >
            PUBLIC_WEB_RESEARCH_LIMITS.maxUrlChars
          ) {
            const completedAt = context.now();
            return {
              stopReason: null,
              source: snapshot({
                rawUrl,
                requestedUrl,
                finalUrl,
                contentHash: null,
                completedAt,
                startedAt,
                title: null,
                excerpt: null,
                contentText: null,
                status,
                contentType,
                bodyBytes,
                wordCount: 0,
                redirectChain,
                availability: "partial",
                limitation:
                  "Public-web research rejected an invalid redirect target.",
              }),
            };
          }
          previousFetchedUrl = guardedUrl;
          current = redirected.href;
          continue;
        }
      }

      const boundedType = boundedContentType(contentType);
      if (!ACCEPTED_MEDIA_TYPES.has(mediaTypeOf(boundedType) ?? "")) {
        cancelResponseBody(response);
        const completedAt = context.now();
        return {
          stopReason: null,
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: null,
            excerpt: null,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: 0,
            redirectChain,
            availability: "unavailable",
            limitation:
              "Unsupported response content type; only HTML, XHTML, and plain text are accepted.",
          }),
        };
      }

      const read = await readBoundedBody(
        response,
        context.remainingTotalBytes,
        requestScope.signal,
      );
      bodyBytes += read.bytes;
      if (read.kind === "aborted") {
        const aborted = abortOutcome(requestScope, context);
        const completedAt = context.now();
        return {
          stopReason: aborted.stopReason,
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: null,
            excerpt: null,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: 0,
            redirectChain,
            availability: "partial",
            limitation: aborted.limitation,
          }),
        };
      }
      if (read.kind === "error") {
        const completedAt = context.now();
        return {
          stopReason: null,
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: null,
            excerpt: null,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: 0,
            redirectChain,
            availability: "partial",
            limitation:
              "Public-web research could not decode the response body.",
          }),
        };
      }
      if (read.kind === "page_limit") {
        const completedAt = context.now();
        return {
          stopReason: null,
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: null,
            excerpt: null,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: 0,
            redirectChain,
            availability: "partial",
            limitation:
              "Public-web research response exceeded the fixed 256 KiB decoded-body limit.",
          }),
        };
      }
      if (read.kind === "total_limit") {
        const completedAt = context.now();
        return {
          stopReason: "max_total_bytes",
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: null,
            excerpt: null,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: 0,
            redirectChain,
            availability: "partial",
            limitation:
              "Public-web research stopped before exceeding the fixed 1 MiB total decoded-body budget.",
          }),
        };
      }

      let extracted: ReturnType<typeof extractContent>;
      try {
        extracted = extractContent(
          read.text,
          boundedType ?? "",
          guardedUrl,
        );
      } catch {
        const completedAt = context.now();
        return {
          stopReason: null,
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: null,
            excerpt: null,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: 0,
            redirectChain,
            availability: "partial",
            limitation:
              "Public-web research could not normalize the accepted response body.",
          }),
        };
      }
      const completedAt = context.now();
      if (!extracted.contentText) {
        return {
          stopReason: null,
          source: snapshot({
            rawUrl,
            requestedUrl,
            finalUrl,
            contentHash: null,
            completedAt,
            startedAt,
            title: extracted.title,
            excerpt: extracted.excerpt,
            contentText: null,
            status,
            contentType,
            bodyBytes,
            wordCount: extracted.wordCount,
            contentTruncated: extracted.contentTruncated,
            excerptTruncated: extracted.excerptTruncated,
            redirectChain,
            availability: "partial",
            limitation:
              "Accepted response contained no extractable research text.",
          }),
        };
      }
      const successfulStatus = status >= 200 && status < 300;
      const contentKind =
        mediaTypeOf(boundedType) === "text/plain" ? "plain-text" : "HTML";
      const statusLimitation = successfulStatus
        ? null
        : `Public-web research captured accepted content from HTTP status ${status}; treat it as partial evidence.`;
      const contentTruncationLimitation = extracted.contentTruncated
        ? `Normalized ${contentKind} content projection exceeded the fixed 64 KiB (65,536-code-point) bound and was truncated; contentHash identifies the full normalized extraction, including the omitted tail.`
        : null;
      const excerptTruncationLimitation = extracted.excerptTruncated
        ? `Excerpt is a bounded preview and was truncated to ${[...(extracted.excerpt ?? "")].length} code points; inspect contentText for the retained normalized projection.`
        : null;
      const limitations = [
        statusLimitation,
        contentTruncationLimitation,
        excerptTruncationLimitation,
      ].filter((value): value is string => value !== null);
      return {
        stopReason: null,
        source: snapshot({
          rawUrl,
          requestedUrl,
          finalUrl,
          contentHash: sha256(
            extracted.contentHashText ?? extracted.contentText,
          ),
          completedAt,
          startedAt,
          title: extracted.title,
          excerpt: extracted.excerpt,
          contentText: extracted.contentText,
          status,
          contentType,
          bodyBytes,
          wordCount: extracted.wordCount,
          contentTruncated: extracted.contentTruncated,
          excerptTruncated: extracted.excerptTruncated,
          redirectChain,
          availability:
            successfulStatus && !extracted.contentTruncated
              ? "available"
              : "partial",
          limitation:
            limitations.length === 0 ? null : limitations.join(" "),
        }),
      };
    } finally {
      requestScope.dispose();
      if (dispatcher) releaseDispatcher(dispatcher);
    }
  }
}

function availabilityFor(
  sources: readonly PublicWebResearchSnapshot[],
): Availability {
  if (sources.every((source) => source.availability === "available")) {
    return "available";
  }
  if (sources.every((source) => source.availability === "unavailable")) {
    return "unavailable";
  }
  return "partial";
}

function limitationFor(
  sources: readonly PublicWebResearchSnapshot[],
  stopReason: PublicWebResearchStopReason | null,
): string | null {
  const impaired = sources.filter(
    (source) => source.availability !== "available",
  ).length;
  if (impaired === 0 && stopReason === null) return null;
  const count =
    `${impaired} of ${sources.length} public-web research source(s) ` +
    "were partial or unavailable.";
  if (stopReason === "max_total_bytes") {
    return (
      "Public-web research stopped at the fixed 1 MiB total decoded-body budget. " +
      count
    );
  }
  if (stopReason === "max_wall_clock") {
    return (
      "Public-web research stopped at the fixed 60 second wall-clock budget. " +
      count
    );
  }
  if (stopReason === "aborted") {
    return `Public-web research was aborted by the caller. ${count}`;
  }
  return count;
}

function stopLimitation(
  stopReason: PublicWebResearchStopReason,
): string {
  if (stopReason === "max_total_bytes") {
    return "Source was not attempted because the fixed 1 MiB total decoded-body budget was exhausted.";
  }
  if (stopReason === "max_wall_clock") {
    return "Source was not attempted because the fixed 60 second wall-clock budget was exhausted.";
  }
  return "Source was not attempted because public-web research was aborted by the caller.";
}

/**
 * Retrieve one to eight public pages under fixed SSRF, redirect, byte, time, and
 * cancellation limits. Operational failures are returned as per-source
 * availability records; only an invalid batch cardinality rejects the call.
 */
export async function retrievePublicWebResearch(
  targets: readonly string[],
  options: PublicWebResearchOptions = {},
): Promise<PublicWebResearchBatch> {
  if (
    !Array.isArray(targets) ||
    targets.length < 1 ||
    targets.length > PUBLIC_WEB_RESEARCH_LIMITS.maxTargets
  ) {
    throw new RangeError(
      "Public-web research requires between 1 and 8 targets.",
    );
  }

  const guard: PublicWebResearchUrlGuard =
    options.guard ??
    ((url) => canonicalUrlGuard(url));
  const fetchImpl = options.fetch ?? defaultPublicWebResearchFetch;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const batchScope = createBatchAbortScope(options.signal);
  const sources: PublicWebResearchSnapshot[] = [];
  let stopReason: PublicWebResearchStopReason | null = null;
  let attemptedTargets = 0;
  let bodyBytes = 0;
  let redirectsFollowed = 0;

  try {
    for (const target of targets) {
      if (stopReason === null && batchScope.signal.aborted) {
        stopReason = batchScope.timedOut()
          ? "max_wall_clock"
          : "aborted";
      }
      if (
        stopReason === null &&
        now() - startedAt >= PUBLIC_WEB_RESEARCH_LIMITS.maxWallClockMs
      ) {
        stopReason = "max_wall_clock";
      }
      if (
        stopReason === null &&
        bodyBytes >= PUBLIC_WEB_RESEARCH_LIMITS.maxTotalBytes
      ) {
        stopReason = "max_total_bytes";
      }
      if (stopReason !== null) {
        sources.push(
          emptySnapshot(target, now(), stopLimitation(stopReason)),
        );
        continue;
      }

      attemptedTargets += 1;
      const attempt = await retrieveOne(target, {
        guard,
        fetch: fetchImpl,
        now,
        batchSignal: batchScope.signal,
        batchTimedOut: batchScope.timedOut,
        remainingTotalBytes:
          PUBLIC_WEB_RESEARCH_LIMITS.maxTotalBytes - bodyBytes,
      });
      sources.push(attempt.source);
      bodyBytes += attempt.source.bodyBytes;
      redirectsFollowed += attempt.source.redirectChain.length;
      stopReason ??= attempt.stopReason;
    }
  } finally {
    batchScope.dispose();
  }

  const availability = availabilityFor(sources);
  const completedAt = now();
  return {
    adapterVersion: PUBLIC_WEB_RESEARCH_ADAPTER_VERSION,
    sources,
    availability,
    limitation: limitationFor(sources, stopReason),
    stopReason,
    usage: {
      targetCount: targets.length,
      attemptedTargets,
      availableTargets: sources.filter(
        (source) => source.availability === "available",
      ).length,
      partialTargets: sources.filter(
        (source) => source.availability === "partial",
      ).length,
      unavailableTargets: sources.filter(
        (source) => source.availability === "unavailable",
      ).length,
      bodyBytes,
      redirectsFollowed,
      elapsedMs: Math.max(0, Math.round(completedAt - startedAt)),
    },
  };
}
