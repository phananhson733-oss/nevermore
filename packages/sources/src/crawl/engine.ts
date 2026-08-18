/**
 * The SSRF-safe crawl engine (spec §7.2, §7.3). Vendor-copied and reshaped from
 * the old `packages/crawler/src/crawl.ts` BFS loop (commit 72af9300…): the
 * `undici` pinned-agent transport is retained behind the injected
 * `CrawlFetcher` (the default uses manual redirects and a fresh pinned Agent for
 * every hop), the old `@signalframe/core` `SiteSnapshot` shape is replaced by
 * `CrawlRaw`, and every budget from `CRAWL_BUDGET` is enforced.
 *
 * The engine records RAW facts only (no page-role inference). On any budget cut
 * it returns `availability: "partial"` with a specific `stopReason` and KEEPS
 * the pages already collected. The SSRF guard runs before every fetch and on
 * every redirect hop; a hop that resolves to a private/blocked address is
 * refused and never fetched.
 */

import { fetch as undiciFetch } from "undici";
import type { Dispatcher } from "undici";
import type { Availability, CollectionContext } from "../adapter.ts";
import { canonicalizeUrl } from "../canonical-url.ts";
import type {
  CrawlPageProjection,
  CrawlRobotsProjection,
  CrawlSitemapProjection,
} from "../observations.ts";
import { canonicalUrlGuard, createPinnedAgent } from "../url-safety/index.ts";
import type { UrlGuardResult } from "../url-safety/index.ts";
import { directivesIndexable, parsePage } from "./parse-page.ts";
import {
  buildCrawlSiteLanguageSummary,
  type CrawlSiteLanguageSummary,
  type HtmlLanguageDeclaration,
} from "./site-language.ts";
import {
  AI_BOT_USER_AGENTS,
  emptyRobots,
  isPathAllowed,
  robotsCrawlDelaySeconds,
  parseRobots,
} from "./robots.ts";
import { collectSitemap } from "./sitemap.ts";
import { boundChars, CRAWL_BUDGET, CRAWL_PROJECTION_LIMITS } from "./types.ts";
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
const STOP_MAX_TOTAL_BYTES = "max_total_bytes";
const STOP_MAX_REQUESTS = "max_requests";
const STOP_ABORTED = "aborted";
/** robots.txt could not be read, so RFC 9309 §2.3.1.4 forbids crawling. */
const STOP_ROBOTS_UNREACHABLE = "robots_unreachable";
/** robots.txt forbids this crawler from the seed path. */
const STOP_ROBOTS_DISALLOWED = "robots_disallowed";

/** The crawl budget shape with widened numeric fields (CRAWL_BUDGET is assignable). */
export interface CrawlBudgetLimits {
  readonly maxUrls: number;
  readonly maxDepth: number;
  readonly maxWallClockMs: number;
  readonly maxRedirects: number;
  readonly maxBodyBytes: number;
  readonly maxTotalBytes: number;
  readonly perHostConcurrency: number;
  readonly minHostDelayMs: number;
}

/**
 * Injectable seams. Production adapters use the default budget; trusted
 * in-package public-preview wrappers may select a separate fixed profile.
 * No public request path may forward a caller-controlled budget here.
 */
export interface CrawlEngineOptions {
  readonly guard?: (url: string) => Promise<UrlGuardResult>;
  readonly now?: () => number;
  /**
   * Offline test seam, paired with `now`. Host pacing is measured in seconds
   * once a site publishes Crawl-delay, which is not something a test can wait
   * out with real timers.
   */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Trusted internal budget override; callers must own a fixed preset. */
  readonly budget?: CrawlBudgetLimits;
  /**
   * Receives the independent versioned site-language summary once per crawl.
   * It is deliberately not embedded in the frozen v2 raw/page projections.
   */
  readonly onSiteLanguageSummary?: (summary: CrawlSiteLanguageSummary) => void;
  /**
   * Fires whenever a page record is collected, carrying the count the crawl
   * would report if it ended right there. Observation only: it cannot change
   * what is fetched, and a listener that throws cannot end a crawl.
   */
  readonly onPageProgress?: (progress: CrawlPageProgress) => void;
  /** Trusted cap across robots, sitemap documents, page fetches, and redirects. */
  readonly maxRequests?: number;
}

/**
 * A live reading of the same quantity `CrawlRaw.pages.length` and
 * `providerUsage.pagesCollected` carry when the crawl finishes. It counts
 * collected pages, never wire requests: robots.txt, sitemap documents and
 * redirect hops all send requests and collect no page.
 */
export interface CrawlPageProgress {
  readonly pagesCollected: number;
}

/**
 * Extra transport values are kept internal so fixture CrawlFetchers can retain
 * the small public interface while production is required to use a pinned
 * dispatcher created from the guard result.
 */
interface PinnedCrawlFetchInit {
  readonly signal: AbortSignal;
  readonly pinnedIp: string;
  readonly dispatcher: Dispatcher;
}

type PinnedCrawlFetch = (
  url: string,
  init: PinnedCrawlFetchInit,
) => Promise<Response>;

/**
 * The default `CrawlFetcher`: undici with MANUAL redirect handling (so the
 * engine re-runs the SSRF guard and creates a new pinned Agent on each hop).
 */
export function createDefaultCrawlFetcher(userAgent: string): CrawlFetcher {
  return {
    fetch(url, init) {
      const pinned = init as Partial<PinnedCrawlFetchInit>;
      if (!pinned.pinnedIp || !pinned.dispatcher) {
        return Promise.reject(
          new Error("Crawl transport requires a guard-pinned dispatcher"),
        );
      }
      return undiciFetch(url, {
        signal: init.signal,
        redirect: "manual",
        dispatcher: pinned.dispatcher,
        headers: { "user-agent": userAgent },
      }) as unknown as Promise<Response>;
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

/**
 * Admit a caller-supplied deep seed at the crawl-param trust boundary.
 *
 * The canonical URL pair preserves the meaningful trailing-slash transport
 * variant while removing tracking/query ordering noise. Credentials and
 * fragments are rejected rather than silently discarded: neither belongs in
 * an exact HTTP-fact identity, and credentials must never reach guard,
 * transport, or persisted evidence.
 */
function canonicalSeedForOrigin(
  seedUrl: CrawlParams["seedUrl"],
  crawlOrigin: string,
): ReturnType<typeof canonicalizeUrl> {
  if (
    typeof seedUrl !== "string" ||
    seedUrl.length === 0 ||
    seedUrl.length > CRAWL_PROJECTION_LIMITS.maxUrlChars
  ) {
    return null;
  }

  let parsed: URL;
  try {
    // Intentionally omit a base: a collection seed is an external trust-boundary
    // value and must be an independently meaningful absolute URL.
    parsed = new URL(seedUrl);
  } catch {
    return null;
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    seedUrl.includes("#")
  ) {
    return null;
  }

  const pair = canonicalizeUrl(seedUrl);
  if (
    !pair ||
    originOf(pair.fetchUrl) !== crawlOrigin ||
    pair.fetchUrl.length > CRAWL_PROJECTION_LIMITS.maxUrlChars ||
    pair.subjectUrl.length > CRAWL_PROJECTION_LIMITS.maxUrlChars
  ) {
    return null;
  }
  return pair;
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
  const all = [...new Set([...meta, ...header])];
  const critical = all.filter(
    (token) => token === "noindex" || token === "none" || token === "nofollow",
  );
  return [...new Set([...critical, ...all])]
    .slice(0, CRAWL_PROJECTION_LIMITS.maxRobotsDirectives)
    .map((token) =>
      boundChars(token, CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars),
    );
}

function boundedRules(values: readonly string[]): readonly string[] {
  return values
    .slice(0, CRAWL_PROJECTION_LIMITS.maxRobotsRulesPerGroup)
    .map((value) =>
      boundChars(value, CRAWL_PROJECTION_LIMITS.maxRobotsRuleChars),
    );
}

function boundedRobotsProjection(
  projection: CrawlRobotsProjection,
): CrawlRobotsProjection {
  const requiredAgents = new Set(
    AI_BOT_USER_AGENTS.map((agent) => agent.toLowerCase()),
  );
  const ordered = [
    ...projection.groups.filter((group) =>
      requiredAgents.has(group.userAgent.toLowerCase()),
    ),
    ...projection.groups.filter(
      (group) => !requiredAgents.has(group.userAgent.toLowerCase()),
    ),
  ];
  const seen = new Set<string>();
  const groups: CrawlRobotsProjection["groups"][number][] = [];
  for (const group of ordered) {
    const userAgent = boundChars(
      group.userAgent,
      CRAWL_PROJECTION_LIMITS.maxUserAgentChars,
    );
    const key = userAgent.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({
      userAgent,
      disallow: boundedRules(group.disallow),
      allow: boundedRules(group.allow),
    });
    if (groups.length >= CRAWL_PROJECTION_LIMITS.maxRobotsGroups) break;
  }
  return {
    fetched: projection.fetched,
    groups,
    sitemaps: projection.sitemaps
      .filter((url) => url.length <= CRAWL_PROJECTION_LIMITS.maxUrlChars)
      .slice(0, CRAWL_PROJECTION_LIMITS.maxSitemaps),
  };
}

function boundedSitemapProjection(
  projection: CrawlSitemapProjection,
): CrawlSitemapProjection {
  const subjectUrls = projection.subjectUrls
    .filter((url) => url.length <= CRAWL_PROJECTION_LIMITS.maxUrlChars)
    .slice(0, CRAWL_PROJECTION_LIMITS.maxSitemapUrls);
  return {
    fetched: projection.fetched,
    urlCount: subjectUrls.length,
    subjectUrls,
  };
}

// ---------------------------------------------------------------------------
// Guarded fetch with manual redirect following and a byte-capped body read.
// ---------------------------------------------------------------------------

type DecodedBudgetOwner = symbol;

interface DecodedByteBudget {
  readonly exhausted: () => boolean;
  readonly register: (cancel: () => void) => DecodedBudgetOwner;
  readonly unregister: (owner: DecodedBudgetOwner) => void;
  readonly reserve: (owner: DecodedBudgetOwner, bytes: number) => boolean;
}

interface GuardedFetchDeps {
  readonly fetcher: CrawlFetcher;
  readonly guard: (url: string) => Promise<UrlGuardResult>;
  readonly allowedOrigin: string;
  readonly allowUrl: ((url: string) => boolean) | undefined;
  readonly maxRedirects: number;
  readonly maxBodyBytes: number;
  readonly maxWallClockMs: number;
  readonly ctxSignal: AbortSignal | undefined;
  readonly nowMs: () => number;
  readonly startMs: number;
  /**
   * Called when a request's timer expired with the run's wall clock as the
   * binding constraint — i.e. the run is out of time, as a fact rather than as
   * something to re-measure.
   */
  readonly onRunDeadline: () => void;
  readonly wantBody: (contentType: string | null) => boolean;
  readonly decodedByteBudget: DecodedByteBudget;
  readonly reserveRequest: () => boolean;
  /**
   * Wait for this host's next allowed launch slot. Called once per *wire*
   * request, so redirect hops pay it too.
   */
  readonly pace: () => Promise<void>;
}

type GuardedFetch =
  | {
      readonly kind: "ok";
      /** Exact URL used for the first transport request after safety guard normalization. */
      readonly requestUrl: string;
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
  | { readonly kind: "blocked" }
  | { readonly kind: "disallowed" }
  | { readonly kind: "redirect_limit" }
  | { readonly kind: "too_large" }
  | { readonly kind: "run_limit" }
  | { readonly kind: "aborted" }
  | { readonly kind: "error" };

/**
 * A request-scoped abort signal.
 *
 * `onRunDeadline` fires when this signal's own timer expired AND the run's
 * remaining wall clock — not the per-request cap — was the binding constraint.
 * That distinction is the whole point: when the run's clock is what armed the
 * timer, the timer FIRING is the run running out of time, established by
 * construction.
 *
 * Callers used to re-derive it instead, by reading `Date.now()` again after the
 * abort came back and asking whether the deadline had passed. `Date.now()` has
 * millisecond resolution and is not monotonic, so a timer armed for the
 * deadline could fire while a fresh reading still sat a fraction below it. The
 * run then reported `robots_unreachable` — a claim about the site — for a crawl
 * that had simply run out of time. It reproduced roughly one CI run in ten and
 * never once locally.
 */
function makeRequestSignal(
  remainingMs: number,
  ctxSignal: AbortSignal | undefined,
  onRunDeadline?: () => void,
): {
  readonly signal: AbortSignal;
  readonly abort: () => void;
  readonly clear: () => void;
} {
  const controller = new AbortController();
  const runClockBinds = remainingMs <= PER_REQUEST_TIMEOUT_MS;
  const timer = setTimeout(
    () => {
      if (runClockBinds) onRunDeadline?.();
      controller.abort();
    },
    Math.max(1, Math.min(remainingMs, PER_REQUEST_TIMEOUT_MS)),
  );
  const onAbort = () => controller.abort();
  if (ctxSignal) {
    if (ctxSignal.aborted) controller.abort();
    else ctxSignal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    clear: () => {
      clearTimeout(timer);
      if (ctxSignal) ctxSignal.removeEventListener("abort", onAbort);
    },
  };
}

type SignalRace<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "aborted" };

function raceWithSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<SignalRace<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SignalRace<T>): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish({ kind: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => finish({ kind: "value", value }),
      (error: unknown) => finish({ kind: "error", error }),
    );
    if (signal.aborted) onAbort();
  });
}

function cancelBestEffort(cancel: () => unknown): void {
  try {
    void Promise.resolve(cancel()).catch(() => undefined);
  } catch {
    /* hostile cancellation may throw synchronously; never block termination */
  }
}

function drain(response: Response): void {
  if (response.body) cancelBestEffort(() => response.body?.cancel());
}

async function readCappedBody(
  response: Response,
  maxBytes: number,
  decodedByteBudget: DecodedByteBudget,
  budgetOwner: DecodedBudgetOwner,
  isBudgetCancelled: () => boolean,
  setBodyCancel: (cancel: (() => void) | null) => void,
  signal: AbortSignal,
): Promise<
  | { readonly body: string; readonly bytes: number }
  | { readonly tooLarge: true }
  | { readonly runLimit: true }
  | { readonly aborted: true }
> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    drain(response);
    return { tooLarge: true };
  }
  const stream = response.body;
  const reader =
    stream && typeof stream.getReader === "function"
      ? stream.getReader()
      : null;
  if (!reader) {
    if (isBudgetCancelled()) return { runLimit: true };
    const textResult = await raceWithSignal(
      Promise.resolve().then(() => response.text()),
      signal,
    );
    if (textResult.kind === "aborted") {
      drain(response);
      return { aborted: true };
    }
    if (textResult.kind === "error") throw textResult.error;
    const text = textResult.value;
    if (isBudgetCancelled()) return { runLimit: true };
    const bytes = new TextEncoder().encode(text).byteLength;
    if (!decodedByteBudget.reserve(budgetOwner, bytes)) {
      return { runLimit: true };
    }
    if (bytes > maxBytes) return { tooLarge: true };
    return { body: text, bytes };
  }
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  setBodyCancel(() => {
    cancelBestEffort(() => reader.cancel());
  });
  try {
    for (;;) {
      if (isBudgetCancelled()) return { runLimit: true };
      const readResult = await raceWithSignal(
        Promise.resolve().then(() => reader.read()),
        signal,
      );
      if (readResult.kind === "aborted") {
        cancelBestEffort(() => reader.cancel());
        return { aborted: true };
      }
      if (readResult.kind === "error") {
        if (isBudgetCancelled()) return { runLimit: true };
        throw readResult.error;
      }
      const next = readResult.value;
      if (isBudgetCancelled()) return { runLimit: true };
      if (next.done) break;
      const value = next.value;
      if (!value) continue;
      if (!decodedByteBudget.reserve(budgetOwner, value.byteLength)) {
        cancelBestEffort(() => reader.cancel());
        return { runLimit: true };
      }
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        cancelBestEffort(() => reader.cancel());
        return { tooLarge: true };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { body: text, bytes };
  } finally {
    setBodyCancel(null);
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
  let requestUrl: string | null = null;
  const chain: string[] = [];
  let firstStatus: number | null = null;
  let redirects = 0;
  for (;;) {
    if (deps.nowMs() - deps.startMs >= deps.maxWallClockMs) {
      return { kind: "error" };
    }
    if (originOf(current) !== deps.allowedOrigin) {
      return { kind: "blocked" };
    }
    const guardRemaining = deps.maxWallClockMs - (deps.nowMs() - deps.startMs);
    const guardScope = makeRequestSignal(
      guardRemaining,
      deps.ctxSignal,
      deps.onRunDeadline,
    );
    const guardResult = await raceWithSignal(
      Promise.resolve().then(() => deps.guard(current)),
      guardScope.signal,
    );
    guardScope.clear();
    if (guardResult.kind === "aborted") return { kind: "aborted" };
    // Guard failures are intentionally reduced to a blocked URL. The raw DNS
    // or resolver error may contain customer-controlled host details.
    if (guardResult.kind === "error") return { kind: "blocked" };
    const guarded = guardResult.value;
    if (!guarded.safe || !guarded.normalizedUrl || !guarded.pinnedIp) {
      return { kind: "blocked" };
    }

    current = guarded.normalizedUrl;
    if (originOf(current) !== deps.allowedOrigin) {
      return { kind: "blocked" };
    }
    if (deps.allowUrl && !deps.allowUrl(current)) {
      return { kind: "disallowed" };
    }
    requestUrl ??= current;
    let target: URL;
    try {
      target = new URL(current);
    } catch {
      return { kind: "blocked" };
    }

    let dispatcher: Dispatcher;
    try {
      dispatcher = createPinnedAgent(target.hostname, guarded.pinnedIp);
    } catch {
      return { kind: "blocked" };
    }

    const remaining = deps.maxWallClockMs - (deps.nowMs() - deps.startMs);
    const { signal, abort, clear } = makeRequestSignal(
      remaining,
      deps.ctxSignal,
      deps.onRunDeadline,
    );
    let budgetCancelled = deps.decodedByteBudget.exhausted();
    let cancelBody: (() => void) | null = null;
    const budgetOwner = deps.decodedByteBudget.register(() => {
      budgetCancelled = true;
      abort();
      cancelBody?.();
    });
    try {
      if (!deps.reserveRequest()) return { kind: "run_limit" };
      // Every hop pays the host delay. This function is re-entered per redirect
      // and is also what fetches robots.txt and each sitemap document, so
      // pacing here is what makes the advertised rate the rate the target
      // actually sees.
      await deps.pace();
      if (budgetCancelled) return { kind: "run_limit" };
      if (signal.aborted) {
        return { kind: "aborted" };
      }
      let response: Response;
      try {
        response = await (deps.fetcher.fetch as PinnedCrawlFetch).call(
          deps.fetcher,
          current,
          { signal, pinnedIp: guarded.pinnedIp, dispatcher },
        );
      } catch {
        if (budgetCancelled || deps.decodedByteBudget.exhausted()) {
          return { kind: "run_limit" };
        }
        if (signal.aborted) {
          return { kind: "aborted" };
        }
        return { kind: "error" };
      }
      if (budgetCancelled || deps.decodedByteBudget.exhausted()) {
        drain(response);
        return { kind: "run_limit" };
      }
      if (signal.aborted) {
        drain(response);
        return { kind: "aborted" };
      }

      const status = response.status;
      if (firstStatus === null) firstStatus = status;

      if (REDIRECT_STATUSES.has(status)) {
        const location = response.headers.get("location");
        if (location) {
          drain(response);
          if (redirects >= deps.maxRedirects) {
            return { kind: "redirect_limit" };
          }
          const next = canonicalizeUrl(location, current);
          if (!next) {
            return { kind: "blocked" };
          }
          chain.push(next.fetchUrl);
          current = next.fetchUrl;
          redirects += 1;
          continue;
        }
      }

      const contentType = response.headers.get("content-type");
      const xRobotsTag = response.headers.get("x-robots-tag");
      if (!deps.wantBody(contentType)) {
        drain(response);
        return {
          kind: "ok",
          requestUrl: requestUrl ?? current,
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
        const read = await readCappedBody(
          response,
          deps.maxBodyBytes,
          deps.decodedByteBudget,
          budgetOwner,
          () => budgetCancelled,
          (cancel) => {
            cancelBody = cancel;
          },
          signal,
        );
        if ("aborted" in read) {
          if (budgetCancelled || deps.decodedByteBudget.exhausted()) {
            return { kind: "run_limit" };
          }
          return { kind: "aborted" };
        }
        if ("runLimit" in read) return { kind: "run_limit" };
        if ("tooLarge" in read) return { kind: "too_large" };
        return {
          kind: "ok",
          requestUrl: requestUrl ?? current,
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
      } catch {
        if (budgetCancelled || deps.decodedByteBudget.exhausted()) {
          return { kind: "run_limit" };
        }
        if (signal.aborted) {
          return { kind: "aborted" };
        }
        drain(response);
        return { kind: "error" };
      }
    } finally {
      deps.decodedByteBudget.unregister(budgetOwner);
      clear();
      const closing = dispatcher.close().catch(() => undefined);
      if (signal.aborted) void closing;
      else await closing;
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
 * carries trusted internal seams.
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
  const sleepMs = options.sleep ?? sleep;
  const startMs = nowMs();
  const capturedAt = new Date().toISOString();
  const { origin, host } = params;
  const crawlOrigin = originOf(`${origin}/`) ?? origin;
  const seedPair = canonicalSeedForOrigin(params.seedUrl, crawlOrigin);

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
  let requestCount = 0;
  const maxRequests = options.maxRequests ?? Number.MAX_SAFE_INTEGER;
  const reserveRequest = (): boolean => {
    if (requestCount >= maxRequests) {
      stopReason ??= STOP_MAX_REQUESTS;
      return false;
    }
    requestCount += 1;
    return true;
  };
  let hitDepthLimit = false;
  /**
   * Set when a request's wall-clock timer fired with the run's remaining time
   * as the binding constraint. Latched, never cleared.
   *
   * The clock reading below stays as the primary test — it is what catches a
   * run that overran between requests, and it is what an injected clock drives
   * in tests. The flag only ever makes the answer MORE true, and it closes the
   * one gap the reading cannot: the timer that enforced the deadline has
   * already fired, but `Date.now()` (millisecond resolution, not monotonic)
   * has not yet crossed it.
   */
  let runDeadlineFired = false;
  const deadlineHit = (): boolean =>
    runDeadlineFired || nowMs() - startMs >= budget.maxWallClockMs;
  const markOperationStop = (): boolean => {
    if (ctx.signal?.aborted) {
      stopReason ??= STOP_ABORTED;
      return true;
    }
    if (deadlineHit()) {
      stopReason ??= STOP_MAX_DURATION;
      return true;
    }
    return false;
  };
  const activeByteConsumers = new Map<DecodedBudgetOwner, () => void>();
  const totalDecodedBudgetExhausted = (): boolean =>
    usage.bytesFetched >= budget.maxTotalBytes;
  const cancelOtherByteConsumers = (owner: DecodedBudgetOwner): void => {
    for (const [activeOwner, cancel] of activeByteConsumers) {
      if (activeOwner === owner) continue;
      try {
        cancel();
      } catch {
        /* cancellation is best-effort; the synchronous reservation still wins */
      }
    }
  };
  const decodedByteBudget: DecodedByteBudget = {
    exhausted: totalDecodedBudgetExhausted,
    register(cancel) {
      const owner = Symbol("crawl-decoded-byte-consumer");
      activeByteConsumers.set(owner, cancel);
      if (totalDecodedBudgetExhausted()) {
        stopReason ??= STOP_MAX_TOTAL_BYTES;
        cancel();
      }
      return owner;
    },
    unregister(owner) {
      activeByteConsumers.delete(owner);
    },
    reserve(owner, bytes) {
      if (totalDecodedBudgetExhausted()) return false;
      const remaining = Math.max(0, budget.maxTotalBytes - usage.bytesFetched);
      const reserved = Math.min(bytes, remaining);
      usage.bytesFetched += reserved;
      const fits = bytes <= remaining;
      if (!fits || totalDecodedBudgetExhausted()) {
        stopReason ??= STOP_MAX_TOTAL_BYTES;
        cancelOtherByteConsumers(owner);
      }
      return fits;
    },
  };

  const fetchDeps = (
    wantBody: (contentType: string | null) => boolean,
    allowUrl?: (url: string) => boolean,
  ): GuardedFetchDeps => ({
    fetcher,
    guard,
    allowedOrigin: crawlOrigin,
    allowUrl,
    maxRedirects: budget.maxRedirects,
    maxBodyBytes: budget.maxBodyBytes,
    maxWallClockMs: budget.maxWallClockMs,
    ctxSignal: ctx.signal,
    nowMs,
    startMs,
    onRunDeadline: () => {
      runDeadlineFired = true;
    },
    wantBody,
    decodedByteBudget,
    reserveRequest,
    pace: acquireHostSlot,
  });

  /**
   * Host pacing. Declared here, ahead of the robots fetch, because that fetch
   * is itself a request against the target and must be paced like any other.
   *
   * The delay starts at our own floor and tightens once robots.txt has been
   * read: a Crawl-delay cannot be honoured before it has been fetched.
   */
  let hostDelayMs = budget.minHostDelayMs;
  let nextLaunchAt = 0;
  const acquireHostSlot = async (): Promise<void> => {
    const now = nowMs();
    const scheduled = Math.max(now, nextLaunchAt);
    nextLaunchAt = scheduled + hostDelayMs;
    const wait = scheduled - now;
    if (wait > 0) await sleepMs(wait);
  };

  // Guarded text fetch for robots.txt + sitemaps (any text/xml body accepted).
  const fetchText = async (url: string): Promise<string | null> => {
    if (stopReason || markOperationStop()) return null;
    const result = await guardedFetch(
      url,
      fetchDeps(() => true),
    );
    if (result.kind === "blocked") {
      usage.urlsBlocked += 1;
      return null;
    }
    if (result.kind === "aborted") {
      if (!markOperationStop()) usage.urlsErrored += 1;
      return null;
    }
    if (result.kind !== "ok") return null;
    usage.urlsFetched += 1;
    usage.redirectsFollowed += result.redirectChain.length;
    if (
      result.finalStatus < 200 ||
      result.finalStatus >= 300 ||
      result.body === null
    )
      return null;
    return result.body;
  };

  /**
   * robots.txt fetch that distinguishes "there is no robots.txt" from "we could
   * not read robots.txt". RFC 9309 §2.3.1 makes these opposite outcomes:
   * §2.3.1.3 says 4xx means no restrictions, §2.3.1.4 says 5xx means the
   * crawler MUST assume complete disallow.
   *
   * `fetchText` collapses both into `null`, so the previous caller substituted
   * an empty ruleset on a 503 and then walked every path the site had
   * disallowed. That is the one failure mode a public crawler must not have.
   */
  const fetchRobotsText = async (
    url: string,
  ): Promise<
    | { readonly kind: "ok"; readonly body: string }
    | { readonly kind: "absent" }
    | { readonly kind: "unreachable" }
    /**
     * The run itself ended — deadline, abort signal, or a budget that was
     * already spent. This is NOT a statement about robots.txt, and must not be
     * relabelled as one: the stop already has a truthful reason.
     */
    | { readonly kind: "stopped" }
  > => {
    if (stopReason || markOperationStop()) return { kind: "stopped" };
    const result = await guardedFetch(
      url,
      fetchDeps(() => true),
    );
    if (result.kind === "blocked") {
      usage.urlsBlocked += 1;
      return { kind: "unreachable" };
    }
    if (result.kind === "aborted") {
      // Two different events arrive here. `markOperationStop()` returning true
      // means the wall clock or the caller's signal ended the whole run. False
      // means only this request timed out, which genuinely is "we could not
      // read robots.txt" and must fail closed.
      if (markOperationStop()) return { kind: "stopped" };
      usage.urlsErrored += 1;
      return { kind: "unreachable" };
    }
    if (result.kind !== "ok") return { kind: "unreachable" };
    usage.urlsFetched += 1;
    usage.redirectsFollowed += result.redirectChain.length;
    // 4xx: the file is not there, or is refused to us. RFC 9309 treats an
    // "unavailable" robots.txt as no restrictions at all.
    if (result.finalStatus >= 400 && result.finalStatus < 500) {
      return { kind: "absent" };
    }
    if (
      result.finalStatus < 200 ||
      result.finalStatus >= 300 ||
      result.body === null
    ) {
      return { kind: "unreachable" };
    }
    return { kind: "ok", body: result.body };
  };

  // robots.txt (own-crawler gate + projection).
  const robotsUrl =
    canonicalizeUrl(`${origin}/robots.txt`)?.fetchUrl ?? `${origin}/robots.txt`;
  const robotsResult = await fetchRobotsText(robotsUrl);
  const robots =
    robotsResult.kind === "ok"
      ? parseRobots(robotsResult.body, origin, true)
      : emptyRobots();
  const robotsProjection = boundedRobotsProjection(robots.projection);
  if (robotsResult.kind === "ok") usage.robotsFetched = 1;

  /**
   * Fail closed when robots.txt was unreadable: RFC 9309 §2.3.1.4 says a
   * crawler that cannot read the rules must assume it is disallowed.
   *
   * The `!stopReason` qualifier matters. A run whose byte budget, request cap,
   * or abort signal already fired never really asked for robots.txt, and
   * relabelling that as "robots unreachable" would hide the actual reason the
   * crawl stopped.
   */
  const robotsUnreachable =
    robotsResult.kind === "unreachable" &&
    !stopReason &&
    // Re-check the clock at stamping time. The abort that ended the fetch and
    // the deadline that ended the run can land in either order, and on a loaded
    // machine they do: without this the run reports robots_unreachable for a
    // crawl that simply ran out of time.
    !markOperationStop();
  if (robotsUnreachable) stopReason = STOP_ROBOTS_UNREACHABLE;

  /**
   * A site that publishes `Crawl-delay` has stated its own rate ceiling. The
   * pacer honours whichever is slower, ours or theirs; it never speeds up on a
   * site's say-so.
   */
  hostDelayMs = Math.max(
    budget.minHostDelayMs,
    robotsCrawlDelaySeconds(robots.groups, config.userAgent) * 1_000,
  );

  // Sitemaps (from robots, else the conventional path).
  const sitemapSeeds =
    robots.projection.sitemaps.length > 0
      ? robots.projection.sitemaps
      : [`${origin}/sitemap.xml`];
  const exactSitemapMembers = new Map<
    string,
    readonly { readonly fetchUrl: string; readonly subjectUrl: string }[]
  >();
  const sitemap = boundedSitemapProjection(
    await collectSitemap(crawlOrigin, sitemapSeeds, {
      fetchText,
      onMember(target) {
        if (target.fetchUrl.length > CRAWL_PROJECTION_LIMITS.maxUrlChars)
          return;
        const current = exactSitemapMembers.get(target.subjectUrl) ?? [];
        if (current.some((candidate) => candidate.fetchUrl === target.fetchUrl))
          return;
        // canonical_url.v1 can produce at most the slash and non-slash fetch
        // variants for one subject. Retaining both preserves exact transport
        // semantics without letting duplicate declarations consume the
        // subject-level sitemap budget.
        const candidates = [...current, target]
          .sort((left, right) =>
            left.fetchUrl < right.fetchUrl
              ? -1
              : left.fetchUrl > right.fetchUrl
                ? 1
                : 0,
          )
          .slice(0, 2);
        exactSitemapMembers.set(target.subjectUrl, candidates);
      },
    }),
  );
  usage.sitemapUrlCount = sitemap.urlCount;
  const boundedSitemapTargetsBySubject = sitemap.subjectUrls.map(
    (subjectUrl) => exactSitemapMembers.get(subjectUrl) ?? [],
  );
  // Allocate the finite fetch budget fairly: every admitted sitemap subject
  // gets its deterministic primary transport before slash/non-slash extras.
  // Otherwise `/a` + `/a/` can consume the last slot and starve `/b`.
  const boundedSitemapTargets = [
    ...boundedSitemapTargetsBySubject.flatMap((targets) =>
      targets[0] ? [targets[0]] : [],
    ),
    ...boundedSitemapTargetsBySubject.flatMap((targets) => targets.slice(1)),
  ];
  const sitemapMemberFetchUrls = new Set(
    boundedSitemapTargets.map((target) => target.fetchUrl),
  );

  // Seed the BFS frontier.
  // Fetch identity controls transport deduplication. `subjectUrl` is retained
  // only for eventual page aggregation; deriving fetch URLs from it would lose
  // meaningful trailing-slash semantics.
  const seenFetchDepth = new Map<string, number>();
  /** Visit order only; the entry for each URL lives in `pending`. */
  const queue: string[] = [];
  const pending = new Map<string, QueueEntry>();
  const enqueue = (
    subjectUrl: string,
    fetchUrl: string,
    depth: number,
  ): void => {
    if (
      originOf(subjectUrl) !== crawlOrigin ||
      originOf(fetchUrl) !== crawlOrigin
    )
      return;
    if (
      subjectUrl.length > CRAWL_PROJECTION_LIMITS.maxUrlChars ||
      fetchUrl.length > CRAWL_PROJECTION_LIMITS.maxUrlChars
    )
      return;
    if (depth > budget.maxDepth) {
      hitDepthLimit = true;
      return;
    }
    const previousDepth = seenFetchDepth.get(fetchUrl);
    if (previousDepth !== undefined && previousDepth <= depth) return;
    seenFetchDepth.set(fetchUrl, depth);
    /**
     * Re-prioritise in place via a map rather than scanning the frontier.
     *
     * This was `queue.findIndex(...)` over every pending entry, run once per
     * discovered link. One page contributes up to 1000 targets — 500 link
     * subjects, two fetch variants each — so enqueueing N distinct URLs cost
     * O(N^2) comparisons and turned a crawl that should be almost entirely idle
     * I/O into a CPU-bound one with multi-second event-loop stalls. The stalls
     * are the real harm: they delay the abort and deadline handling that every
     * other budget depends on.
     *
     * `queue` now holds fetch URLs in visit order and `pending` holds the entry
     * for each, so an order-preserving replacement is a single map write.
     */
    const queued = pending.get(fetchUrl);
    if (queued) {
      pending.set(fetchUrl, { fetchUrl, subjectUrl, depth });
      return;
    }
    pending.set(fetchUrl, { fetchUrl, subjectUrl, depth });
    queue.push(fetchUrl);
  };

  const originPair = canonicalizeUrl(`${origin}/`);
  if (originPair) enqueue(originPair.subjectUrl, originPair.fetchUrl, 0);
  if (seedPair) enqueue(seedPair.subjectUrl, seedPair.fetchUrl, 0);
  for (const target of boundedSitemapTargets) {
    enqueue(target.subjectUrl, target.fetchUrl, 1);
  }

  interface PageCandidate {
    readonly record: CrawlPageRecord;
    readonly journeySubjectUrl: string;
    readonly journeyFetchUrl: string;
    readonly redirectCount: number;
    readonly htmlLanguage: HtmlLanguageDeclaration | null;
  }
  // Persist one factual page record per exact initial HTTP request identity. Multiple
  // fetch URLs may intentionally share one subjectUrl (for example `/path` and
  // `/path/`); subject identity belongs to downstream aggregation and must not
  // discard either response before Evidence/PageSnapshot materialization.
  const pagesByFetchUrl = new Map<string, PageCandidate>();
  const completedFetchDepth = new Map<string, number>();
  const compareAscii = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;
  const comparePageCandidates = (
    left: PageCandidate,
    right: PageCandidate,
  ): number => {
    if (left.record.depth !== right.record.depth) {
      return left.record.depth - right.record.depth;
    }
    if (left.redirectCount !== right.redirectCount) {
      return right.redirectCount - left.redirectCount;
    }
    const subjectOrder = compareAscii(
      left.journeySubjectUrl,
      right.journeySubjectUrl,
    );
    if (subjectOrder !== 0) return subjectOrder;
    return compareAscii(left.journeyFetchUrl, right.journeyFetchUrl);
  };
  const upsertPage = (candidate: PageCandidate): boolean => {
    const fetchUrl = candidate.record.projection.fetchUrl;
    const existing = pagesByFetchUrl.get(fetchUrl);
    if (existing && comparePageCandidates(candidate, existing) >= 0) {
      usage.urlsSkipped += 1;
      return false;
    }
    pagesByFetchUrl.set(fetchUrl, candidate);
    usage.pagesCollected = pagesByFetchUrl.size;
    // Emitted from the one place that collects a page, so the last number a
    // listener sees is the number this crawl returns.
    if (options.onPageProgress) {
      try {
        options.onPageProgress({ pagesCollected: pagesByFetchUrl.size });
      } catch {
        // Observation must never end a crawl.
      }
    }
    return true;
  };
  let crawledCount = 0;
  let inFlight = 0;

  const processEntry = async (entry: QueueEntry): Promise<void> => {
    const completedDepth = completedFetchDepth.get(entry.fetchUrl);
    if (completedDepth !== undefined && completedDepth <= entry.depth) {
      usage.urlsSkipped += 1;
      return;
    }
    crawledCount += 1;
    if (stopReason || markOperationStop()) return;
    const started = nowMs();
    const result = await guardedFetch(
      entry.fetchUrl,
      fetchDeps(
        (ct) => isHtmlContentType(ct),
        (url) =>
          isPathAllowed(robots.groups, config.userAgent, robotsPath(url)),
      ),
    );
    const responseMs = Math.max(0, nowMs() - started);

    if (result.kind === "blocked") {
      usage.urlsBlocked += 1;
      return;
    }
    if (result.kind === "disallowed") {
      usage.urlsDisallowed += 1;
      return;
    }
    if (
      result.kind === "redirect_limit" ||
      result.kind === "too_large" ||
      result.kind === "run_limit"
    ) {
      usage.urlsSkipped += 1;
      return;
    }
    if (result.kind === "aborted") {
      if (!markOperationStop()) usage.urlsErrored += 1;
      return;
    }
    if (result.kind === "error") {
      usage.urlsErrored += 1;
      return;
    }
    usage.urlsFetched += 1;
    usage.redirectsFollowed += result.redirectChain.length;
    if (!result.bodyWanted || result.body === null) {
      usage.urlsSkipped += 1;
      return;
    }

    const requestPair = canonicalizeUrl(result.requestUrl);
    const finalPair = canonicalizeUrl(result.finalUrl);
    if (
      !requestPair ||
      !finalPair ||
      originOf(requestPair.subjectUrl) !== crawlOrigin ||
      originOf(finalPair.subjectUrl) !== crawlOrigin ||
      requestPair.subjectUrl.length > CRAWL_PROJECTION_LIMITS.maxUrlChars ||
      requestPair.fetchUrl.length > CRAWL_PROJECTION_LIMITS.maxUrlChars ||
      finalPair.subjectUrl.length > CRAWL_PROJECTION_LIMITS.maxUrlChars ||
      finalPair.fetchUrl.length > CRAWL_PROJECTION_LIMITS.maxUrlChars
    ) {
      usage.urlsBlocked += 1;
      return;
    }
    const requestSubjectUrl = requestPair.subjectUrl;
    const requestFetchUrl = requestPair.fetchUrl;
    const finalFetchUrl = finalPair.fetchUrl;
    const previousCompletedDepth = completedFetchDepth.get(requestFetchUrl);
    if (
      previousCompletedDepth === undefined ||
      entry.depth < previousCompletedDepth
    ) {
      completedFetchDepth.set(requestFetchUrl, entry.depth);
    }

    const parsed = parsePage(result.body, finalFetchUrl);
    const robotsDirectives = mergeRobotsDirectives(
      parsed.robotsDirectives,
      result.xRobotsTag,
    );
    const projection: CrawlPageProjection = {
      // One record describes one complete journey: the initial request/status
      // remain attached, while finalStatus + redirectChain describe its end.
      fetchUrl: requestFetchUrl,
      status: result.firstStatus,
      finalStatus: result.finalStatus,
      redirectChain: result.redirectChain.filter(
        (url) => url.length <= CRAWL_PROJECTION_LIMITS.maxUrlChars,
      ),
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
      sitemapMember: sitemapMemberFetchUrls.has(requestFetchUrl),
      bodyExcerpt: parsed.bodyExcerpt,
      paragraphs: parsed.paragraphs,
      responseMs,
      contentType:
        result.contentType?.slice(
          0,
          CRAWL_PROJECTION_LIMITS.maxContentTypeChars,
        ) ?? null,
    };
    upsertPage({
      record: {
        // Page materialization binds to the request that initiated this journey.
        subjectUrl: requestSubjectUrl,
        depth: entry.depth,
        projection,
        // Beside the projection, never inside it: crawl.page.v1 is read back
        // by a strict schema in the product app, so a field added there fails
        // validation on every row already stored.
        assets: parsed.assets,
      },
      journeySubjectUrl: requestSubjectUrl,
      journeyFetchUrl: requestFetchUrl,
      redirectCount: result.redirectChain.length,
      htmlLanguage: parsed.htmlLanguage,
    });

    // Every successful exact transport contributes discovery facts and remains
    // independently persisted. Shared subject identity must not make crawl
    // coverage depend on concurrent completion order when `/path` and `/path/`
    // aggregate to the same subject.
    if (result.finalStatus >= 200 && result.finalStatus < 300) {
      for (const target of parsed.internalFetchTargets) {
        enqueue(target.subjectUrl, target.fetchUrl, entry.depth + 1);
      }
      if (parsed.canonicalFetchTarget) {
        enqueue(
          parsed.canonicalFetchTarget.subjectUrl,
          parsed.canonicalFetchTarget.fetchUrl,
          entry.depth + 1,
        );
      }
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (stopReason) return;
      if (markOperationStop()) return;
      const fetchUrl = queue.shift();
      const entry = fetchUrl === undefined ? undefined : pending.get(fetchUrl);
      if (fetchUrl !== undefined) pending.delete(fetchUrl);
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

  const pageCandidates = [...pagesByFetchUrl.values()];
  const pages = pageCandidates.map((candidate) => candidate.record);
  /**
   * Zero collected pages is never a successful audit.
   *
   * This used to also require `usage.urlsFetched === 0`, but that counter is
   * incremented by the robots.txt and sitemap.xml fetches, which happen before
   * any page is considered. A site whose robots.txt says `Disallow: /`
   * therefore reported `availability: "available"` with `stopReason: null`, and
   * both public tools rendered that as a completed audit that found nothing —
   * a clean bill of health for a site we never looked at.
   */
  const reachedNothing = pages.length === 0;

  /**
   * Zero pages plus at least one robots refusal means the site told us not to
   * crawl it — a legitimate site-owner decision, not a crawl failure and
   * emphatically not a passing audit.
   */
  const robotsRefused = reachedNothing && usage.urlsDisallowed > 0;
  if (robotsRefused && !stopReason) stopReason = STOP_ROBOTS_DISALLOWED;

  /**
   * `partial` still means "a budget cut a real crawl short", which is why a run
   * that fetched nothing before exhausting its budget keeps reporting partial.
   *
   * What changed: `reachedNothing` used to also require `usage.urlsFetched === 0`,
   * and that counter is incremented by the robots.txt and sitemap.xml fetches
   * that happen before any page is considered. A site answering `Disallow: /`
   * therefore came back `available` with `stopReason: null`, and both public
   * tools rendered a completed audit that found nothing — a clean bill of
   * health for a site we never looked at.
   */
  const availability: Availability =
    reachedNothing && (robotsUnreachable || robotsRefused || !stopReason)
      ? "unavailable"
      : stopReason
        ? "partial"
        : "available";

  const limitation =
    stopReason === STOP_ROBOTS_DISALLOWED
      ? `${origin}/robots.txt forbids this crawler, so no page was fetched. This is not a finding about the site's SEO.`
      : stopReason === STOP_ROBOTS_UNREACHABLE
        ? `${origin}/robots.txt could not be read, so no page was fetched: a crawler that cannot read the rules must assume it is disallowed (RFC 9309 §2.3.1.4).`
        : stopReason
          ? `Public crawl of ${origin} stopped early (${stopReason}); coverage is partial: ${pages.length} page(s) collected.`
          : availability === "unavailable"
            ? `Public crawl of ${origin} returned no fetchable pages.`
            : `Public crawl of ${origin}: ${pages.length} page(s) within the fixed budget.`;

  const orderedPages = [...pages].sort((left, right) => {
    const subjectOrder = compareAscii(left.subjectUrl, right.subjectUrl);
    return subjectOrder !== 0
      ? subjectOrder
      : compareAscii(left.projection.fetchUrl, right.projection.fetchUrl);
  });
  options.onSiteLanguageSummary?.(
    buildCrawlSiteLanguageSummary(
      pageCandidates.map((candidate) => ({
        fetchUrl: candidate.record.projection.fetchUrl,
        declaration: candidate.htmlLanguage,
      })),
    ),
  );

  return {
    origin,
    host,
    pages: orderedPages,
    robots: robotsProjection,
    sitemap,
    availability,
    capturedAt,
    sourceWindow: { start: capturedAt, end: capturedAt },
    stopReason,
    providerUsage: { ...usage },
    limitation,
  };
}
