/**
 * The SSRF-safe crawl engine (spec §7.2, §7.3). Vendor-copied and reshaped from
 * the old `packages/crawler/src/crawl.ts` BFS loop (commit 72af9300…): the
 * `undici` pinned-agent transport is replaced by the injected `CrawlFetcher`
 * (defaults to native `globalThis.fetch` with `redirect: "manual"`), the old
 * `@signalframe/core` `SiteSnapshot` shape is replaced by `CrawlRaw`, and every
 * budget from `CRAWL_BUDGET` is enforced.
 *
 * The engine records RAW facts only (no page-role inference). On any budget cut
 * it returns `availability: "partial"` with a specific `stopReason` and KEEPS
 * the pages already collected. The SSRF guard runs before every fetch and on
 * every redirect hop; a hop that resolves to a private/blocked address is
 * refused and never fetched.
 */

import { canonicalizeUrl } from "../canonical-url.ts";
import type { Availability, CollectionContext } from "../adapter.ts";
import type { CrawlPageProjection } from "../observations.ts";
import { canonicalUrlGuard } from "../url-safety/index.ts";
import type { UrlGuardResult } from "../url-safety/index.ts";
import { directivesIndexable, parsePage } from "./parse-page.ts";
import { emptyRobots, isPathAllowed, parseRobots } from "./robots.ts";
import { collectSitemap } from "./sitemap.ts";
import { CRAWL_BUDGET } from "./types.ts";
import type {
  CrawlConfig,
  CrawlFetcher,
  CrawlPageRecord,
  CrawlParams,
  CrawlRaw,
} from "./types.ts";

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);
const PER_REQUEST_TIMEOUT_MS = 30_000;

const STOP_MAX_URLS = "max_urls";
const STOP_MAX_DEPTH = "max_depth";
const STOP_MAX_DURATION = "max_duration";

/** The crawl budget shape with widened numeric fields (CRAWL_BUDGET is assignable). */
export interface CrawlBudgetLimits {
  readonly maxUrls: number;
  readonly maxDepth: number;
  readonly maxWallClockMs: number;
  readonly maxRedirects: number;
  readonly maxBodyBytes: number;
  readonly perHostConcurrency: number;
  readonly minHostDelayMs: number;
}

/** Injectable seams (production uses the defaults). `budget` is TEST-ONLY. */
export interface CrawlEngineOptions {
  readonly guard?: (url: string) => Promise<UrlGuardResult>;
  readonly now?: () => number;
  /** Test-only budget override; the adapter always uses the fixed CRAWL_BUDGET. */
  readonly budget?: CrawlBudgetLimits;
}

/**
 * The default `CrawlFetcher`: native `fetch` with MANUAL redirect handling (so
 * the engine re-runs the SSRF guard on each hop) and the product user agent.
 */
export function createDefaultCrawlFetcher(userAgent: string): CrawlFetcher {
  return {
    fetch(url, init) {
      return globalThis.fetch(url, {
        signal: init.signal,
        redirect: "manual",
        headers: { "user-agent": userAgent },
      });
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function robotsPath(fetchUrl: string): string {
  try {
    const url = new URL(fetchUrl);
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}

function isHtmlContentType(contentType: string | null): boolean {
  if (contentType === null) return true;
  return /^\s*(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType);
}

function mergeRobotsDirectives(
  meta: readonly string[],
  xRobotsTag: string | null,
): readonly string[] {
  const header = xRobotsTag
    ? xRobotsTag
        .split(",")
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length > 0)
    : [];
  return [...new Set([...meta, ...header])];
}

// ---------------------------------------------------------------------------
// Guarded fetch with manual redirect following and a byte-capped body read.
// ---------------------------------------------------------------------------

interface GuardedFetchDeps {
  readonly fetcher: CrawlFetcher;
  readonly guard: (url: string) => Promise<UrlGuardResult>;
  readonly maxRedirects: number;
  readonly maxBodyBytes: number;
  readonly maxWallClockMs: number;
  readonly ctxSignal: AbortSignal | undefined;
  readonly nowMs: () => number;
  readonly startMs: number;
  readonly wantBody: (contentType: string | null) => boolean;
}

type GuardedFetch =
  | {
      readonly kind: "ok";
      readonly firstStatus: number;
      readonly finalStatus: number;
      readonly finalUrl: string;
      readonly redirectChain: readonly string[];
      readonly contentType: string | null;
      readonly xRobotsTag: string | null;
      readonly bodyWanted: boolean;
      readonly body: string | null;
      readonly bytes: number;
    }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "redirect_limit" }
  | { readonly kind: "too_large" }
  | { readonly kind: "error"; readonly reason: string };

function makeRequestSignal(
  remainingMs: number,
  ctxSignal: AbortSignal | undefined,
): { readonly signal: AbortSignal; readonly clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("request timeout")),
    Math.max(1, Math.min(remainingMs, PER_REQUEST_TIMEOUT_MS)),
  );
  const onAbort = () => controller.abort(ctxSignal?.reason);
  if (ctxSignal) {
    if (ctxSignal.aborted) controller.abort(ctxSignal.reason);
    else ctxSignal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      if (ctxSignal) ctxSignal.removeEventListener("abort", onAbort);
    },
  };
}

async function drain(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* a hostile stream may refuse cancellation; ignore */
  }
}

async function readCappedBody(
  response: Response,
  maxBytes: number,
): Promise<
  | { readonly body: string; readonly bytes: number }
  | { readonly tooLarge: true }
> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await drain(response);
    return { tooLarge: true };
  }
  const stream = response.body;
  const reader =
    stream && typeof stream.getReader === "function"
      ? stream.getReader()
      : null;
  if (!reader) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > maxBytes) return { tooLarge: true };
    return { body: text, bytes };
  }
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const value = next.value;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { body: text, bytes };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* a pending hostile read retains its own lock */
    }
  }
}

async function guardedFetch(
  startUrl: string,
  deps: GuardedFetchDeps,
): Promise<GuardedFetch> {
  let current = startUrl;
  const chain: string[] = [];
  let firstStatus: number | null = null;
  let redirects = 0;
  for (;;) {
    if (deps.nowMs() - deps.startMs >= deps.maxWallClockMs) {
      return { kind: "error", reason: "wall clock exceeded" };
    }
    const guarded = await deps.guard(current);
    if (!guarded.safe)
      return { kind: "blocked", reason: guarded.reason ?? "unsafe url" };

    const remaining = deps.maxWallClockMs - (deps.nowMs() - deps.startMs);
    const { signal, clear } = makeRequestSignal(remaining, deps.ctxSignal);
    let response: Response;
    try {
      response = await deps.fetcher.fetch(current, { signal });
    } catch (error) {
      clear();
      return {
        kind: "error",
        reason: error instanceof Error ? error.message : "fetch failed",
      };
    }

    const status = response.status;
    if (firstStatus === null) firstStatus = status;

    if (REDIRECT_STATUSES.has(status)) {
      const location = response.headers.get("location");
      if (location) {
        await drain(response);
        clear();
        if (redirects >= deps.maxRedirects) return { kind: "redirect_limit" };
        const next = canonicalizeUrl(location, current);
        if (!next)
          return { kind: "blocked", reason: "unparseable redirect location" };
        chain.push(next.subjectUrl);
        current = next.fetchUrl;
        redirects += 1;
        continue;
      }
    }

    const contentType = response.headers.get("content-type");
    const xRobotsTag = response.headers.get("x-robots-tag");
    if (!deps.wantBody(contentType)) {
      await drain(response);
      clear();
      return {
        kind: "ok",
        firstStatus: firstStatus ?? status,
        finalStatus: status,
        finalUrl: current,
        redirectChain: chain,
        contentType,
        xRobotsTag,
        bodyWanted: false,
        body: null,
        bytes: 0,
      };
    }

    try {
      const read = await readCappedBody(response, deps.maxBodyBytes);
      if ("tooLarge" in read) return { kind: "too_large" };
      return {
        kind: "ok",
        firstStatus: firstStatus ?? status,
        finalStatus: status,
        finalUrl: current,
        redirectChain: chain,
        contentType,
        xRobotsTag,
        bodyWanted: true,
        body: read.body,
        bytes: read.bytes,
      };
    } catch (error) {
      return {
        kind: "error",
        reason: error instanceof Error ? error.message : "body read failed",
      };
    } finally {
      clear();
    }
  }
}

// ---------------------------------------------------------------------------
// The BFS crawl.
// ---------------------------------------------------------------------------

interface QueueEntry {
  readonly fetchUrl: string;
  readonly subjectUrl: string;
  readonly depth: number;
}

interface Usage {
  urlsFetched: number;
  pagesCollected: number;
  urlsSkipped: number;
  urlsBlocked: number;
  urlsDisallowed: number;
  urlsErrored: number;
  redirectsFollowed: number;
  bytesFetched: number;
  robotsFetched: number;
  sitemapUrlCount: number;
}

/**
 * Crawl `params.origin` breadth-first and return a `CrawlRaw` site graph. Same
 * origin only; robots.txt (own crawler) respected; all `CRAWL_BUDGET` limits
 * enforced. `fetcher` is injected so tests drive fixtures offline; `options`
 * carries test-only seams.
 */
export async function crawlSite(
  params: CrawlParams,
  config: CrawlConfig,
  ctx: CollectionContext,
  fetcher: CrawlFetcher,
  options: CrawlEngineOptions = {},
): Promise<CrawlRaw> {
  const budget = options.budget ?? CRAWL_BUDGET;
  const guard = options.guard ?? canonicalUrlGuard;
  const nowMs = options.now ?? Date.now;
  const startMs = nowMs();
  const capturedAt = new Date().toISOString();
  const { origin, host } = params;
  const crawlOrigin = originOf(`${origin}/`) ?? origin;

  const usage: Usage = {
    urlsFetched: 0,
    pagesCollected: 0,
    urlsSkipped: 0,
    urlsBlocked: 0,
    urlsDisallowed: 0,
    urlsErrored: 0,
    redirectsFollowed: 0,
    bytesFetched: 0,
    robotsFetched: 0,
    sitemapUrlCount: 0,
  };

  let stopReason: string | null = null;
  let hitDepthLimit = false;
  const deadlineHit = (): boolean => nowMs() - startMs >= budget.maxWallClockMs;

  const fetchDeps = (
    wantBody: (contentType: string | null) => boolean,
  ): GuardedFetchDeps => ({
    fetcher,
    guard,
    maxRedirects: budget.maxRedirects,
    maxBodyBytes: budget.maxBodyBytes,
    maxWallClockMs: budget.maxWallClockMs,
    ctxSignal: ctx.signal,
    nowMs,
    startMs,
    wantBody,
  });

  // Guarded text fetch for robots.txt + sitemaps (any text/xml body accepted).
  const fetchText = async (url: string): Promise<string | null> => {
    if (stopReason || deadlineHit()) {
      stopReason ??= STOP_MAX_DURATION;
      return null;
    }
    const result = await guardedFetch(
      url,
      fetchDeps(() => true),
    );
    if (result.kind === "blocked") {
      usage.urlsBlocked += 1;
      return null;
    }
    if (result.kind !== "ok") return null;
    usage.urlsFetched += 1;
    usage.bytesFetched += result.bytes;
    usage.redirectsFollowed += result.redirectChain.length;
    if (
      result.finalStatus < 200 ||
      result.finalStatus >= 300 ||
      result.body === null
    )
      return null;
    return result.body;
  };

  // robots.txt (own-crawler gate + projection).
  const robotsUrl =
    canonicalizeUrl(`${origin}/robots.txt`)?.fetchUrl ?? `${origin}/robots.txt`;
  const robotsBody = await fetchText(robotsUrl);
  const robots =
    robotsBody !== null ? parseRobots(robotsBody, origin, true) : emptyRobots();
  if (robotsBody !== null) usage.robotsFetched = 1;

  // Sitemaps (from robots, else the conventional path).
  const sitemapSeeds =
    robots.projection.sitemaps.length > 0
      ? robots.projection.sitemaps
      : [`${origin}/sitemap.xml`];
  const sitemap = await collectSitemap(crawlOrigin, sitemapSeeds, {
    fetchText,
  });
  usage.sitemapUrlCount = sitemap.urlCount;
  const sitemapMembers = new Set(sitemap.subjectUrls);

  // Seed the BFS frontier.
  const seen = new Set<string>();
  const queue: QueueEntry[] = [];
  const enqueue = (
    subjectUrl: string,
    fetchUrl: string,
    depth: number,
  ): void => {
    if (originOf(subjectUrl) !== crawlOrigin) return;
    if (depth > budget.maxDepth) {
      hitDepthLimit = true;
      return;
    }
    if (seen.has(subjectUrl)) return;
    seen.add(subjectUrl);
    queue.push({ fetchUrl, subjectUrl, depth });
  };

  const originPair = canonicalizeUrl(`${origin}/`);
  if (originPair) enqueue(originPair.subjectUrl, originPair.fetchUrl, 0);
  for (const member of sitemap.subjectUrls) {
    const pair = canonicalizeUrl(member);
    if (pair) enqueue(pair.subjectUrl, pair.fetchUrl, 1);
  }

  const pages: CrawlPageRecord[] = [];
  let crawledCount = 0;
  let inFlight = 0;
  let nextLaunchAt = 0;

  const acquireHostSlot = async (): Promise<void> => {
    const now = nowMs();
    const scheduled = Math.max(now, nextLaunchAt);
    nextLaunchAt = scheduled + budget.minHostDelayMs;
    const wait = scheduled - now;
    if (wait > 0) await sleep(wait);
  };

  const processEntry = async (entry: QueueEntry): Promise<void> => {
    if (
      !isPathAllowed(
        robots.groups,
        config.userAgent,
        robotsPath(entry.fetchUrl),
      )
    ) {
      usage.urlsDisallowed += 1;
      return;
    }
    crawledCount += 1;
    await acquireHostSlot();
    if (stopReason || deadlineHit()) {
      stopReason ??= STOP_MAX_DURATION;
      return;
    }
    const started = nowMs();
    const result = await guardedFetch(
      entry.fetchUrl,
      fetchDeps((ct) => isHtmlContentType(ct)),
    );
    const responseMs = Math.max(0, nowMs() - started);

    if (result.kind === "blocked") {
      usage.urlsBlocked += 1;
      return;
    }
    if (result.kind === "redirect_limit" || result.kind === "too_large") {
      usage.urlsSkipped += 1;
      return;
    }
    if (result.kind === "error") {
      usage.urlsErrored += 1;
      return;
    }
    usage.urlsFetched += 1;
    usage.bytesFetched += result.bytes;
    usage.redirectsFollowed += result.redirectChain.length;
    if (!result.bodyWanted || result.body === null) {
      usage.urlsSkipped += 1;
      return;
    }

    const parsed = parsePage(result.body, entry.fetchUrl);
    const robotsDirectives = mergeRobotsDirectives(
      parsed.robotsDirectives,
      result.xRobotsTag,
    );
    const projection: CrawlPageProjection = {
      fetchUrl: entry.fetchUrl,
      status: result.firstStatus,
      finalStatus: result.finalStatus,
      redirectChain: result.redirectChain,
      canonicalTarget: parsed.canonicalTarget,
      robotsIndexable: directivesIndexable(robotsDirectives),
      robotsDirectives,
      title: parsed.title,
      metaDescription: parsed.metaDescription,
      h1: parsed.h1,
      headings: parsed.headings,
      wordCount: parsed.wordCount,
      internalOutlinks: parsed.internalOutlinks,
      jsonLd: parsed.jsonLd,
      sitemapMember: sitemapMembers.has(entry.subjectUrl),
      bodyExcerpt: parsed.bodyExcerpt,
      paragraphs: parsed.paragraphs,
      responseMs,
      contentType: result.contentType,
    };
    pages.push({
      subjectUrl: entry.subjectUrl,
      depth: entry.depth,
      projection,
    });
    usage.pagesCollected += 1;

    if (result.finalStatus >= 200 && result.finalStatus < 300) {
      for (const link of parsed.internalOutlinks) {
        const pair = canonicalizeUrl(link.targetSubjectUrl);
        if (pair) enqueue(pair.subjectUrl, pair.fetchUrl, entry.depth + 1);
      }
      if (parsed.canonicalTarget) {
        const pair = canonicalizeUrl(parsed.canonicalTarget);
        if (pair) enqueue(pair.subjectUrl, pair.fetchUrl, entry.depth + 1);
      }
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (stopReason) return;
      if (deadlineHit()) {
        stopReason ??= STOP_MAX_DURATION;
        return;
      }
      const entry = queue.shift();
      if (!entry) {
        if (inFlight === 0) return;
        await sleep(0);
        continue;
      }
      if (crawledCount >= budget.maxUrls) {
        stopReason ??= STOP_MAX_URLS;
        return;
      }
      inFlight += 1;
      try {
        await processEntry(entry);
      } finally {
        inFlight -= 1;
      }
    }
  };

  const concurrency = Math.max(1, budget.perHostConcurrency);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (!stopReason && hitDepthLimit) stopReason = STOP_MAX_DEPTH;

  const reachedNothing = pages.length === 0 && usage.urlsFetched === 0;
  const availability: Availability = reachedNothing
    ? "unavailable"
    : stopReason
      ? "partial"
      : "available";

  const limitation = stopReason
    ? `Public crawl of ${origin} stopped early (${stopReason}); coverage is partial: ${pages.length} page(s) collected.`
    : availability === "unavailable"
      ? `Public crawl of ${origin} returned no fetchable pages.`
      : `Public crawl of ${origin}: ${pages.length} page(s) within the fixed budget.`;

  const orderedPages = [...pages].sort((left, right) =>
    left.subjectUrl < right.subjectUrl
      ? -1
      : left.subjectUrl > right.subjectUrl
        ? 1
        : 0,
  );

  return {
    origin,
    host,
    pages: orderedPages,
    robots: robots.projection,
    sitemap,
    availability,
    capturedAt,
    sourceWindow: { start: capturedAt, end: capturedAt },
    stopReason,
    providerUsage: { ...usage },
    limitation,
  };
}
