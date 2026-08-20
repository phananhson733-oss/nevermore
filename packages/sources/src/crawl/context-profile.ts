// @input  -- a submitted site URL, a target language, and injected transport/clock seams
// @output -- bounded sitemap inventory plus highest-value LLM context pages, or a coded failure
// @pos    -- the data source under the Keyword Opportunity Map's "what does this company sell" step
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * A page-value-ordered context crawl, as opposed to `crawlPublicSitePreview`'s
 * breadth-first site graph.
 *
 * The two answer different questions. The preview crawl answers "what is on
 * this site" and must not prefer one page over another, because an SEO audit
 * that skipped the blog would be measuring a site it invented. This crawl
 * answers "what does this company sell", where a full twenty-page budget of
 * blog posts is wasted: Tranche 1 (2026-08-10) measured 9% product/pricing/feature
 * pages under breadth-first ordering, and linear.app returned eight blog posts
 * and zero product pages, so the downstream LLM described blog topics as the
 * product. Ordering the frontier by `pageValueScore` moved that share to 100%
 * on 7 of the 15 Tranche 2 sites.
 *
 * Failure is a first-class result here, not an exception to be flattened. Five
 * of the twenty Tranche 2 sites did not complete, and "Cloudflare refused us",
 * "the site rate-limited us" and "the site tried to send us to plain HTTP"
 * require three different responses from the operator. A single "scan failed"
 * would have hidden all three.
 */

import { canonicalizeUrl } from "../canonical-url.ts";
import {
  fetchPublicResource,
  type PublicResourceFetchOptions,
  type PublicResourceResult,
} from "../public-http/index.ts";
import {
  contextProfilePage,
  type ContextProfilePage,
} from "./context-page.ts";
import {
  pageValueBreakdown,
  pageValueIsContextCandidate,
  pageValueIsProductPage,
  type PageValueBreakdown,
} from "./page-value.ts";
import { parsePage } from "./parse-page.ts";
import { isAllowedPublicToolEntryRedirect } from "./public-preview.ts";
import {
  emptyRobots,
  isPathAllowed,
  parseRobots,
  robotsCrawlDelaySeconds,
  type RobotsGroup,
} from "./robots.ts";
import { parseSitemapXml } from "./sitemap.ts";

export const CONTEXT_PROFILE_USER_AGENT =
  "GenGrowth-Context-Profiler/1.0 (+https://gengrowth.ai/tools)";

/**
 * The fixed transport profile for one context crawl. Not caller-tunable: these
 * are safety and citizenship boundaries, not a quota someone may raise.
 */
export const CONTEXT_PROFILE_CRAWL_BUDGET = Object.freeze({
  /**
   * 20 successful pages, including the homepage. Failed candidates do not
   * consume a slot; the ranked frontier replenishes them until this ceiling or
   * a real crawl budget/candidate exhaustion stops the run.
   */
  maxUrls: 20,
  /**
   * 3 segments. Every recognised positive section sits at depth 1 or 2
   * (`/pricing`, `/solutions/teams`); depth 3 is the deepest a product page was
   * observed at. Deeper paths are article/permalink shapes.
   */
  maxDepth: 3,
  /**
   * 60 seconds. This crawl runs inside a request the operator is waiting on,
   * and a minute is the point past which they conclude the tool is broken. The
   * partial result at 60s is more useful than a complete one at 240s.
   */
  maxWallClockMs: 60_000,
  /**
   * 2 MiB per response. Above this a marketing page is a bundled application,
   * not a document, and the extra bytes carry no additional prose.
   */
  maxBodyBytes: 2 * 1024 * 1024,
  /**
   * 24 MiB across the crawl. Twenty ordinary marketing documents fit while a
   * series of responses near the per-page ceiling cannot overrun the crawl.
   */
  maxTotalBytes: 24 * 1024 * 1024,
  /**
   * 5 concurrent requests. Matches the shared public-tools profile; combined
   * with `minHostDelayMs` it caps the target at 4 requests/second regardless.
   */
  perHostConcurrency: 5,
  /**
   * 250 ms between request starts on the host, raised (never lowered) to the
   * site's own `Crawl-delay` once robots.txt is read.
   */
  minHostDelayMs: 250,
  /**
   * 120 wire requests, counting the entry probe, robots.txt, every sitemap
   * document, and every page.
   *
   * Without failed candidates a crawl issues at most 26
   * (1 + 1 + 4 + 1 + 19). Replenishment can issue more, so 120 remains the
   * independent backstop that prevents a long failing frontier from turning
   * one run into hundreds of requests against a stranger's site.
   */
  maxRequests: 120,
  /**
   * 5 redirect hops per request. Same figure the rest of the public tools use;
   * the transport enforces it, this crawl only supplies it.
   */
  maxRedirects: 5,
  /**
   * 15 seconds per request. Five slow pages must not consume the whole
   * 60-second crawl, and no marketing page needs longer.
   */
  requestTimeoutMs: 15_000,
});

/** How much of a sitemap this crawl is willing to read. */
export const CONTEXT_PROFILE_SITEMAP_LIMITS = Object.freeze({
  /**
   * 3 child sitemaps from a `<sitemapindex>`. Indexed sites usually split
   * blog/post from everything else, so three non-blog children reach the
   * product URLs while a full walk would spend the request budget on archives.
   */
  maxChildDocuments: 3,
  /**
   * 500 URLs. Only their paths are scored, and the top 19 are all that get
   * fetched; reading further changes the ranking only in pathological cases.
   */
  maxUrls: 500,
});

/** Every reason the bounded sitemap inventory may be incomplete. */
export const CONTEXT_PROFILE_SITEMAP_TRUNCATION_REASONS = [
  "seed_cap",
  "child_document_cap",
  "url_cap",
  "nested_index_skipped",
  "off_origin_filtered",
  "budget_stopped",
  "document_unavailable",
  "document_body_truncated",
  "malformed_document",
  "malformed_url_filtered",
  "token_budget",
] as const;

export type ContextProfileSitemapTruncationReason =
  (typeof CONTEXT_PROFILE_SITEMAP_TRUNCATION_REASONS)[number];

/** URL-only L1 evidence, separate from the L2 pages selected for context. */
export interface ContextProfileSitemapInventory {
  readonly urls: readonly string[];
  /** At least one sitemap document returned a 2xx response body. */
  readonly fetched: boolean;
  /** The discovered bounded graph was read without any known omission. */
  readonly complete: boolean;
  readonly documentsRead: number;
  readonly truncationReasons: readonly ContextProfileSitemapTruncationReason[];
}

/** Below this the profile cannot describe a company; see `contextSufficient`. */
export const CONTEXT_PROFILE_MIN_PAGES = 3;

/**
 * Sitemap children whose own URL says they list articles. Used only to order
 * children within an index, never to reject a URL.
 */
const ARTICLE_SITEMAP_HINT =
  /(blog|post|news|article|nachrichten|neuigkeiten|presse|tag|category|kategorie|author|autor)/i;

type ContextProfileSitemapRoot = "urlset" | "sitemapindex";

/**
 * Identify the actual document root, not a tag name mentioned inside HTML,
 * JavaScript, or an error page. Sitemap XML may start with a BOM, declaration,
 * comments, or a simple doctype before its root element.
 */
function sitemapDocumentRoot(body: string): ContextProfileSitemapRoot | null {
  let rest = body.replace(/^\uFEFF/, "").trimStart();
  for (;;) {
    const declaration = rest.match(/^<\?xml\b[\s\S]*?\?>/i)?.[0];
    const comment = rest.match(/^<!--[\s\S]*?-->/)?.[0];
    const doctype = rest.match(/^<!DOCTYPE\b[^>]*>/i)?.[0];
    const prefix = declaration ?? comment ?? doctype;
    if (prefix === undefined) break;
    rest = rest.slice(prefix.length).trimStart();
  }
  const root = rest.match(
    /^<(?:[\w.-]+:)?(urlset|sitemapindex)\b/i,
  )?.[1]?.toLowerCase();
  return root === "urlset" || root === "sitemapindex" ? root : null;
}

export type ContextProfileErrorCode =
  /** The target's bot protection refused us (HTTP 403 from Cloudflare/WAF). */
  | "bot_protection_blocked"
  /** The target asked us to slow down (HTTP 429). Retrying later may work. */
  | "rate_limited_by_target"
  /** An HTTPS target tried to redirect us to plain HTTP; the safety layer refused. */
  | "protocol_downgrade_rejected"
  /** Reachable, but fewer than `CONTEXT_PROFILE_MIN_PAGES` usable pages came back. */
  | "too_few_pages"
  /** The submitted URL is not an absolute, credential-free http(s) URL. */
  | "invalid_target"
  /** No transport-level answer at all: DNS, TLS, timeout, or a blocked address. */
  | "entry_unreachable"
  /** robots.txt forbids this crawler from the site root. Not a finding about the site. */
  | "robots_disallowed"
  /** robots.txt could not be read, so RFC 9309 §2.3.1.4 forbids crawling. */
  | "robots_unreachable";

/**
 * Carries a machine-readable `code` so the caller can say which of the five
 * observed failure modes happened instead of "scan failed". Shaped after
 * `SeoAuditScanError` so both public tools report failure the same way.
 */
export class ContextProfileError extends Error {
  readonly code: ContextProfileErrorCode;

  constructor(code: ContextProfileErrorCode) {
    super(code);
    this.name = "ContextProfileError";
    this.code = code;
  }
}

/**
 * Why the crawl stopped early. `null` means it did not stop early: every
 * eligible candidate was fetched.
 */
export type ContextProfileStopReason =
  | "max_urls"
  | "max_requests"
  | "max_wall_clock"
  | "max_total_bytes"
  | "aborted";

/** Re-exported so a consumer of this module never needs a second import. */
export type {
  ContextProfileHeadings,
  ContextProfilePage,
} from "./context-page.ts";
export { CONTEXT_PROFILE_MAX_TEXT_CHARS } from "./context-page.ts";

export interface ContextProfileResult {
  /** Origin the crawl settled on, after the entry probe resolved redirects. */
  readonly origin: string;
  /** Fetched pages in descending page-value order; the homepage is first. */
  readonly pages: readonly ContextProfilePage[];
  /**
   * Bounded sitemap URL inventory; never a claim about every page on the site.
   * Optional only for an older injected/cached result crossing a deployment.
   */
  readonly sitemapInventory?: ContextProfileSitemapInventory;
  readonly pagesFetched: number;
  /** Pages scoring at or above `PAGE_VALUE_PRODUCT_SCORE_THRESHOLD`. */
  readonly productPagesFetched: number;
  readonly stopReason: ContextProfileStopReason | null;
  /** `pagesFetched >= CONTEXT_PROFILE_MIN_PAGES`. */
  readonly contextSufficient: boolean;
  /** Requests this module issued. Redirect hops inside the transport are not counted here. */
  readonly requestsSent: number;
  /** Decoded response bytes admitted across the crawl. */
  readonly bytesFetched: number;
  /** Candidate pages that answered 403 after the homepage had succeeded. */
  readonly botProtectionResponses: number;
  /** Candidate pages that answered 429 after the homepage had succeeded. */
  readonly rateLimitedResponses: number;
  /** Redirects refused because an HTTPS journey tried to continue over HTTP. */
  readonly protocolDowngradesRejected: number;
  readonly capturedAt: string;
}

/**
 * The transport seam. Its shape is `fetchPublicResource`'s, so production wires
 * the guarded, IP-pinned, redirect-policed transport and nothing else can be
 * substituted by an API caller.
 */
export type ContextProfileFetch = (
  url: string,
  options: PublicResourceFetchOptions,
) => Promise<PublicResourceResult>;

export interface ContextProfileOptions {
  /**
   * BCP-47 primary subtag of the market this profile is for. Locale prefixes
   * for other languages are penalised out of the frontier. Defaults to `"en"`.
   */
  readonly targetLanguage?: string;
  /** Ends the crawl when the caller goes away; reported as `aborted`. */
  readonly signal?: AbortSignal;
  /** Offline test seam. Production must use the guarded default transport. */
  readonly fetch?: ContextProfileFetch;
  /** Offline test seam for timestamps and wall-clock assertions. */
  readonly now?: () => number;
  /** Offline test seam for host pacing; production waits on a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
}

function defaultContextProfileSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // A pacing timer must never be the reason a worker process stays alive.
    if (typeof timer === "object" && "unref" in timer) timer.unref();
  });
}

function isProtocolDowngrade(fromUrl: string, toUrl: string): boolean {
  try {
    return (
      new URL(fromUrl).protocol === "https:" &&
      new URL(toUrl).protocol !== "https:"
    );
  } catch {
    return false;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "/";
  }
}

/** Rank an index's children so non-article sitemaps are read first. */
function orderSitemapChildren(locs: readonly string[]): readonly string[] {
  const article: string[] = [];
  const rest: string[] = [];
  for (const loc of locs) {
    (ARTICLE_SITEMAP_HINT.test(loc) ? article : rest).push(loc);
  }
  return [...rest, ...article];
}

interface Candidate {
  readonly url: string;
  readonly path: string;
  readonly value: PageValueBreakdown;
}

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving input
 * order in the output. Order matters because `pages` is the page-value ranking
 * and a caller truncating it must be truncating the tail, not a random subset.
 */
async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R | null>,
): Promise<readonly R[]> {
  const slots: (R | null)[] = new Array<R | null>(items.length).fill(null);
  // One shared iterator rather than a shared index: `items[index]` under
  // noUncheckedIndexedAccess would add an impossible undefined case to handle.
  const queue = items.entries();
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (;;) {
        const next = queue.next();
        if (next.done === true) return;
        const [index, item] = next.value;
        slots[index] = await worker(item);
      }
    }),
  );
  return slots.filter((slot): slot is R => slot !== null);
}

/** Everything one crawl mutates, kept in one place so the flow stays readable. */
interface CrawlState {
  requestsSent: number;
  bytesFetched: number;
  /**
   * Worst-case bytes already committed to requests still on the wire.
   *
   * Without it, five concurrent lanes each pass the byte check at the same
   * `bytesFetched` and then each add a full body, so the crawl can overshoot
   * `maxTotalBytes` by four whole responses and — because nothing was ever
   * skipped — report `stopReason: null` while having blown the budget.
   * Reserving each request's cap up front makes the budget a real ceiling.
   */
  bytesReserved: number;
  hostDelayMs: number;
  nextRequestAt: number;
  stopReason: ContextProfileStopReason | null;
  botProtectionResponses: number;
  rateLimitedResponses: number;
  protocolDowngradesRejected: number;
}

export async function crawlSiteContextProfile(
  inputUrl: string,
  options: ContextProfileOptions = {},
): Promise<ContextProfileResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultContextProfileSleep;
  const fetchResource: ContextProfileFetch =
    options.fetch ??
    ((url, fetchOptions) => fetchPublicResource(url, fetchOptions));
  const targetLanguage = options.targetLanguage ?? "en";
  const startedAt = now();

  const submitted = parseSubmittedUrl(inputUrl);
  const state: CrawlState = {
    requestsSent: 0,
    bytesFetched: 0,
    bytesReserved: 0,
    hostDelayMs: CONTEXT_PROFILE_CRAWL_BUDGET.minHostDelayMs,
    nextRequestAt: startedAt,
    stopReason: null,
    botProtectionResponses: 0,
    rateLimitedResponses: 0,
    protocolDowngradesRejected: 0,
  };

  /**
   * `pendingBytes` is the cap of the request being considered. Admitting only
   * requests whose worst case still fits makes `maxTotalBytes` an exact
   * ceiling on `bytesFetched` rather than an approximate one.
   */
  const budgetStop = (
    pendingBytes: number,
  ): ContextProfileStopReason | null => {
    if (options.signal?.aborted) return "aborted";
    if (now() - startedAt >= CONTEXT_PROFILE_CRAWL_BUDGET.maxWallClockMs) {
      return "max_wall_clock";
    }
    if (state.requestsSent >= CONTEXT_PROFILE_CRAWL_BUDGET.maxRequests) {
      return "max_requests";
    }
    if (
      state.bytesFetched + state.bytesReserved + pendingBytes >
      CONTEXT_PROFILE_CRAWL_BUDGET.maxTotalBytes
    ) {
      return "max_total_bytes";
    }
    return null;
  };

  /**
   * The redirect policy handed to every request.
   *
   * It runs before the transport's own origin and downgrade checks, which is
   * the only place a downgrade can be told apart from an ordinary cross-origin
   * refusal — both surface as one error code afterwards.
   */
  const redirectPolicy = (fromUrl: string, toUrl: string): boolean => {
    if (isProtocolDowngrade(fromUrl, toUrl)) {
      state.protocolDowngradesRejected += 1;
      return false;
    }
    return isAllowedPublicToolEntryRedirect(fromUrl, toUrl);
  };

  /**
   * One paced request. Returns null when a budget ended the crawl first, and
   * records the reason so the result says which budget it was.
   *
   * The pacing gate reserves a start slot before awaiting, so the concurrent
   * lanes interleave rather than all sleeping toward the same instant. The
   * byte budget is reserved at its per-request cap for the same reason: five
   * lanes that all read `bytesFetched` before any of them has finished would
   * otherwise walk straight through the ceiling.
   */
  const request = async (
    url: string,
    maxBodyBytes: number,
  ): Promise<PublicResourceResult | null> => {
    const stop = budgetStop(maxBodyBytes);
    if (stop) {
      state.stopReason ??= stop;
      return null;
    }
    const slot = Math.max(now(), state.nextRequestAt);
    state.nextRequestAt = slot + state.hostDelayMs;
    state.requestsSent += 1;
    state.bytesReserved += maxBodyBytes;
    try {
      const wait = slot - now();
      if (wait > 0) await sleep(wait);
      const result = await fetchResource(url, {
        timeoutMs: CONTEXT_PROFILE_CRAWL_BUDGET.requestTimeoutMs,
        maxRedirects: CONTEXT_PROFILE_CRAWL_BUDGET.maxRedirects,
        maxBodyBytes,
        userAgent: CONTEXT_PROFILE_USER_AGENT,
        allowRedirect: redirectPolicy,
      });
      if (result.kind === "ok") state.bytesFetched += result.bytes;
      return result;
    } finally {
      state.bytesReserved -= maxBodyBytes;
    }
  };

  // --- 1. Entry probe -------------------------------------------------------
  // A one-byte body is enough: this request exists only to learn which origin
  // the site canonicalises to, so robots.txt is read at the right host.
  const entry = await request(submitted.toString(), 1);
  // A budget that ran out before the first request is this crawl's own limit,
  // not a statement about the site, so it must not borrow a site-blaming code.
  if (entry === null) throw new ContextProfileError("too_few_pages");
  assertNotBlocked(entry, state);
  if (entry.kind !== "ok") {
    throw new ContextProfileError(
      state.protocolDowngradesRejected > 0
        ? "protocol_downgrade_rejected"
        : "entry_unreachable",
    );
  }
  if (!isAllowedPublicToolEntryRedirect(submitted.toString(), entry.finalUrl)) {
    throw new ContextProfileError("entry_unreachable");
  }
  const origin = new URL(entry.finalUrl).origin;

  // --- 2. robots.txt --------------------------------------------------------
  const robots = await readRobots(origin, request);
  state.hostDelayMs = Math.max(
    CONTEXT_PROFILE_CRAWL_BUDGET.minHostDelayMs,
    Math.round(
      robotsCrawlDelaySeconds(robots.groups, CONTEXT_PROFILE_USER_AGENT) *
        1_000,
    ),
  );
  const allowed = (path: string): boolean =>
    isPathAllowed(robots.groups, CONTEXT_PROFILE_USER_AGENT, path);
  if (!allowed("/")) throw new ContextProfileError("robots_disallowed");

  // --- 3. Homepage ----------------------------------------------------------
  const homepageUrl = `${origin}/`;
  const homepageResponse = await request(
    homepageUrl,
    CONTEXT_PROFILE_CRAWL_BUDGET.maxBodyBytes,
  );
  if (homepageResponse === null) throw new ContextProfileError("too_few_pages");
  if (homepageResponse.kind !== "ok") {
    throw new ContextProfileError(
      state.protocolDowngradesRejected > 0
        ? "protocol_downgrade_rejected"
        : "entry_unreachable",
    );
  }
  assertNotBlocked(homepageResponse, state);
  if (
    homepageResponse.finalStatus < 200 ||
    homepageResponse.finalStatus >= 300
  ) {
    // Without the homepage there is no link graph and no page scoring 10, so
    // there is no profile to build even if the sitemap answers.
    throw new ContextProfileError("entry_unreachable");
  }
  // Parsed once and used twice: the homepage is both the first context page and
  // the entire link frontier, and parsing it twice would double the cost of the
  // largest document in the crawl.
  const homepageParsed = parsePage(
    homepageResponse.body,
    homepageResponse.finalUrl,
  );
  const homepage = contextProfilePage(
    homepageResponse.finalUrl,
    homepageResponse.body,
    pageValueBreakdown(pathOf(homepageResponse.finalUrl), { targetLanguage })
      .score,
    homepageParsed,
  );
  const homepageLinks = homepageParsed.internalFetchTargets.map(
    (target) => target.fetchUrl,
  );

  // --- 4. Sitemap -----------------------------------------------------------
  const sitemapInventory = await readSitemap(
    origin,
    robots.sitemaps,
    request,
  );

  // --- 5. Rank the frontier -------------------------------------------------
  const candidates = rankCandidates(
    [...homepageLinks, ...sitemapInventory.urls, entry.finalUrl],
    { origin, homepageUrl, targetLanguage, allowed },
  );
  const slots = Math.max(0, CONTEXT_PROFILE_CRAWL_BUDGET.maxUrls - 1);

  // --- 6. Fetch ------------------------------------------------------------
  const fetchCandidate = async (
    candidate: Candidate,
  ): Promise<ContextProfilePage | null> => {
    const response = await request(
      candidate.url,
      CONTEXT_PROFILE_CRAWL_BUDGET.maxBodyBytes,
    );
    if (response === null || response.kind !== "ok") return null;
    if (response.finalStatus === 403) {
      state.botProtectionResponses += 1;
      return null;
    }
    if (response.finalStatus === 429) {
      state.rateLimitedResponses += 1;
      return null;
    }
    if (response.finalStatus < 200 || response.finalStatus >= 300) return null;
    return contextProfilePage(
      response.finalUrl,
      response.body,
      candidate.value.score,
    );
  };
  const fetched: ContextProfilePage[] = [];
  let candidateOffset = 0;
  while (
    fetched.length < slots &&
    candidateOffset < candidates.length &&
    state.stopReason === null
  ) {
    const batchSize = Math.min(
      slots - fetched.length,
      candidates.length - candidateOffset,
    );
    const batch = candidates.slice(
      candidateOffset,
      candidateOffset + batchSize,
    );
    candidateOffset += batch.length;
    const batchFetched = await runPool(
      batch,
      CONTEXT_PROFILE_CRAWL_BUDGET.perHostConcurrency,
      fetchCandidate,
    );
    fetched.push(...batchFetched);
  }
  if (
    state.stopReason === null &&
    fetched.length === slots &&
    candidateOffset < candidates.length
  ) {
    state.stopReason = "max_urls";
  }

  const pages = [homepage, ...fetched];
  return {
    origin,
    pages,
    sitemapInventory,
    pagesFetched: pages.length,
    productPagesFetched: pages.filter((page) =>
      pageValueIsProductPage(page.score),
    ).length,
    stopReason: state.stopReason,
    contextSufficient: pages.length >= CONTEXT_PROFILE_MIN_PAGES,
    requestsSent: state.requestsSent,
    bytesFetched: state.bytesFetched,
    botProtectionResponses: state.botProtectionResponses,
    rateLimitedResponses: state.rateLimitedResponses,
    protocolDowngradesRejected: state.protocolDowngradesRejected,
    capturedAt: new Date(now()).toISOString(),
  };
}

/**
 * Turn an insufficient profile into the most specific failure available.
 *
 * Kept separate from the crawl so `contextSufficient` stays a fact the caller
 * can read and decide about — a crawl that always threw would make the field
 * unreachable. The ordering matters: a site that answered 403 to most of the
 * ranked candidates was blocked, and reporting `too_few_pages` there would
 * send the operator looking for a content problem that does not exist.
 */
export function assertContextProfileSufficient(
  result: ContextProfileResult,
): void {
  if (result.contextSufficient) return;
  if (result.botProtectionResponses > 0) {
    throw new ContextProfileError("bot_protection_blocked");
  }
  if (result.rateLimitedResponses > 0) {
    throw new ContextProfileError("rate_limited_by_target");
  }
  if (result.protocolDowngradesRejected > 0) {
    throw new ContextProfileError("protocol_downgrade_rejected");
  }
  throw new ContextProfileError("too_few_pages");
}

function parseSubmittedUrl(inputUrl: string): URL {
  let submitted: URL;
  try {
    submitted = new URL(inputUrl);
  } catch {
    throw new ContextProfileError("invalid_target");
  }
  if (
    (submitted.protocol !== "http:" && submitted.protocol !== "https:") ||
    submitted.username ||
    submitted.password
  ) {
    throw new ContextProfileError("invalid_target");
  }
  submitted.hash = "";
  return submitted;
}

/**
 * 403 and 429 on the way in are the site talking to us, not a transport fault,
 * and each needs its own operator response. Anything else stays generic.
 */
function assertNotBlocked(
  result: PublicResourceResult,
  state: CrawlState,
): void {
  if (result.kind !== "ok") return;
  if (result.finalStatus === 403) {
    state.botProtectionResponses += 1;
    throw new ContextProfileError("bot_protection_blocked");
  }
  if (result.finalStatus === 429) {
    state.rateLimitedResponses += 1;
    throw new ContextProfileError("rate_limited_by_target");
  }
}

type PacedRequest = (
  url: string,
  maxBodyBytes: number,
) => Promise<PublicResourceResult | null>;

/**
 * RFC 9309 §2.3.1 makes 4xx and 5xx opposite outcomes: 4xx means there are no
 * restrictions, 5xx means the crawler MUST assume it is fully disallowed.
 * Collapsing both into "no rules" is the one failure a public crawler cannot
 * have, so an unreadable robots.txt ends the crawl with its own code.
 */
async function readRobots(
  origin: string,
  request: PacedRequest,
): Promise<{
  readonly groups: readonly RobotsGroup[];
  readonly sitemaps: readonly string[];
}> {
  const result = await request(
    `${origin}/robots.txt`,
    CONTEXT_PROFILE_CRAWL_BUDGET.maxBodyBytes,
  );
  // null is our own exhausted budget; only a real failed response is a claim
  // that the site's robots.txt could not be read.
  if (result === null) throw new ContextProfileError("too_few_pages");
  if (result.kind !== "ok") {
    throw new ContextProfileError("robots_unreachable");
  }
  if (result.finalStatus >= 400 && result.finalStatus < 500) {
    const absent = emptyRobots();
    return { groups: absent.groups, sitemaps: [] };
  }
  if (result.finalStatus < 200 || result.finalStatus >= 300) {
    throw new ContextProfileError("robots_unreachable");
  }
  const parsed = parseRobots(result.body, origin, true);
  return { groups: parsed.groups, sitemaps: parsed.projection.sitemaps };
}

/**
 * Read the sitemap far enough to see the product URLs and no further.
 *
 * A `<sitemapindex>` is walked exactly one level, non-article children first,
 * because the URLs this crawl wants are never behind a second index level and a
 * full walk would spend the whole request budget inside archive sitemaps.
 */
async function readSitemap(
  origin: string,
  declared: readonly string[],
  request: PacedRequest,
): Promise<ContextProfileSitemapInventory> {
  const seeds =
    declared.length > 0 ? declared.slice(0, 1) : [`${origin}/sitemap.xml`];
  const collected = new Set<string>();
  const visited = new Set<string>();
  const reasons = new Set<ContextProfileSitemapTruncationReason>();
  let documentsRead = 0;

  if (declared.length > seeds.length) reasons.add("seed_cap");

  const normalizeInventoryUrl = (raw: string): string | null => {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      reasons.add("malformed_url_filtered");
      return null;
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      reasons.add("malformed_url_filtered");
      return null;
    }
    try {
      decodeURIComponent(parsed.pathname);
    } catch {
      reasons.add("malformed_url_filtered");
      return null;
    }
    if (parsed.origin !== origin) {
      reasons.add("off_origin_filtered");
      return null;
    }
    const fetchUrl = canonicalizeUrl(raw)?.fetchUrl;
    if (!fetchUrl) {
      reasons.add("malformed_url_filtered");
      return null;
    }
    return fetchUrl;
  };

  type SitemapRead =
    | { readonly kind: "index"; readonly locs: readonly string[] }
    | { readonly kind: "urlset" };

  const read = async (url: string): Promise<SitemapRead | null> => {
    const key = normalizeInventoryUrl(url);
    if (key === null) return null;
    if (visited.has(key)) return null;
    visited.add(key);
    const result = await request(
      key,
      CONTEXT_PROFILE_CRAWL_BUDGET.maxBodyBytes,
    );
    if (result === null) {
      reasons.add("budget_stopped");
      return null;
    }
    if (
      result.kind !== "ok" ||
      result.finalStatus < 200 ||
      result.finalStatus >= 300
    ) {
      reasons.add("document_unavailable");
      return null;
    }
    documentsRead += 1;
    if (!result.bodyComplete) reasons.add("document_body_truncated");
    const root = sitemapDocumentRoot(result.body);
    if (root === null) {
      reasons.add("malformed_document");
      return null;
    }
    const document = parseSitemapXml(result.body);
    if (root === "sitemapindex") {
      return { kind: "index", locs: document.locs };
    }
    for (const loc of document.locs) {
      const member = normalizeInventoryUrl(loc);
      if (member === null || collected.has(member)) continue;
      if (collected.size >= CONTEXT_PROFILE_SITEMAP_LIMITS.maxUrls) {
        reasons.add("url_cap");
        continue;
      }
      collected.add(member);
    }
    return { kind: "urlset" };
  };

  for (const seed of seeds) {
    const document = await read(seed);
    if (document?.kind !== "index") continue;
    const ordered = orderSitemapChildren(document.locs);
    if (ordered.length > CONTEXT_PROFILE_SITEMAP_LIMITS.maxChildDocuments) {
      reasons.add("child_document_cap");
    }
    const children = ordered.slice(
      0,
      CONTEXT_PROFILE_SITEMAP_LIMITS.maxChildDocuments,
    );
    for (const child of children) {
      if (collected.size >= CONTEXT_PROFILE_SITEMAP_LIMITS.maxUrls) {
        reasons.add("url_cap");
        break;
      }
      const nested = await read(child);
      if (nested?.kind === "index") reasons.add("nested_index_skipped");
    }
  }

  const truncationReasons =
    CONTEXT_PROFILE_SITEMAP_TRUNCATION_REASONS.filter((reason) =>
      reasons.has(reason),
    );
  return {
    urls: [...collected],
    fetched: documentsRead > 0,
    complete: documentsRead > 0 && truncationReasons.length === 0,
    documentsRead,
    truncationReasons,
  };
}

interface RankingContext {
  readonly origin: string;
  readonly homepageUrl: string;
  readonly targetLanguage: string;
  readonly allowed: (path: string) => boolean;
}

/**
 * Deduplicate, reject, and order the frontier.
 *
 * Ties are broken by depth then URL so two runs over the same site produce the
 * same ranking; an unstable frontier would make the crawl's own regression
 * tests meaningless.
 */
function rankCandidates(
  urls: readonly string[],
  context: RankingContext,
): readonly Candidate[] {
  const seen = new Set<string>([context.homepageUrl]);
  const candidates: Candidate[] = [];
  for (const raw of urls) {
    const fetchUrl = canonicalizeUrl(raw)?.fetchUrl;
    if (!fetchUrl || seen.has(fetchUrl)) continue;
    let parsed: URL;
    try {
      parsed = new URL(fetchUrl);
    } catch {
      continue;
    }
    if (parsed.origin !== context.origin) continue;
    seen.add(fetchUrl);
    const value = pageValueBreakdown(parsed.pathname, {
      targetLanguage: context.targetLanguage,
    });
    if (value.depth === 0) continue;
    if (value.depth > CONTEXT_PROFILE_CRAWL_BUDGET.maxDepth) continue;
    if (!pageValueIsContextCandidate(value)) continue;
    if (!context.allowed(parsed.pathname)) continue;
    candidates.push({ url: fetchUrl, path: parsed.pathname, value });
  }
  return candidates.sort(
    (a, b) =>
      b.value.score - a.value.score ||
      a.value.depth - b.value.depth ||
      (a.url < b.url ? -1 : a.url > b.url ? 1 : 0),
  );
}
