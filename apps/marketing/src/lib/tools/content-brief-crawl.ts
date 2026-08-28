// @input  -- the deduplicated SERP URLs to read, the run's deadline, and the brief's language
// @output -- one CrawlObservation per page that parsed (h2/h3, per-heading excerpts, hash), one CrawlFailure per page that did not
// @pos    -- the Content Brief Builder's cross-site fetch; bounded by the crawl wall clock, no gate, no cache
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createHash } from "node:crypto";
import {
  CRAWL_CONCURRENCY,
  CRAWL_DEADLINE_MS,
  CRAWL_EXCERPT_MAX_CHARS,
  CRAWL_EXCERPTS_PER_PAGE_MAX,
  CRAWL_FETCH_TIMEOUT_MS,
  CRAWL_HEADINGS_PER_PAGE_MAX,
  CRAWL_MAX_BYTES_PER_PAGE,
  ENVELOPE_MS,
  HEADING_MAX_CHARS,
  isWhitespaceTokenizedLanguage,
} from "@sf/public-tools/content-brief/constants";
import type {
  CrawlExcerpt,
  CrawlFailure,
  CrawlObservation,
} from "@sf/public-tools/content-brief/contract";
import { contextPageHeadings } from "@sf/sources/crawl-context-page";
import { boundChars } from "@sf/sources/crawl-limits";
import { parsePage } from "@sf/sources/crawl-page";
import {
  fetchPublicResource,
  type PublicResourceResult,
  type PublicResourceSuccess,
} from "@sf/sources/public-http";

/**
 * Why this does not go through `openCrawlGate` or `crawl-cache`.
 *
 * Both exist for the site-level tools, where one visitor asks for one site
 * and the same site may be asked for again an hour later. Here every run reads
 * ten pages on ten different hosts chosen by the provider, and the handoff
 * rules the gate and the cache out: a per-host slot would serialise a
 * cross-host read behind a stranger's audit, and a cached body would make the
 * brief's evidence older than its SERP.
 */

export interface CrawlTarget {
  /** The SerpObservation id this URL came from, "S1" … "S10". */
  readonly serp_id: string;
  readonly url: string;
}

export interface ContentBriefCrawlInput {
  readonly targets: readonly CrawlTarget[];
  /** The run's single deadline (`start + RUN_BUDGET_MS`), in epoch ms. */
  readonly deadlineAt: number;
  readonly language: string;
}

export interface ContentBriefCrawlResult {
  readonly observed: CrawlObservation[];
  readonly failed: CrawlFailure[];
}

export interface ContentBriefCrawlDependencies {
  readonly fetchResource?: typeof fetchPublicResource;
  readonly now?: () => number;
}

type CrawlOutcome =
  | { readonly kind: "observed"; readonly value: CrawlObservation }
  | { readonly kind: "failed"; readonly value: CrawlFailure };

const SERP_ID = /^S(\d+)$/;
const HEADING_TAG = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
const BODY_TAG = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i;
/** Elements whose contents are code or graphics, never prose. */
const NOISE_ELEMENTS =
  /<\s*(script|style|noscript|template|svg|canvas|iframe)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi;
const HTML_CONTENT_TYPES = ["text/html", "application/xhtml+xml"] as const;
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const ENTITY = /&(?:#(x[0-9a-f]+|\d+)|([a-z]+));/gi;
const MIN_FETCH_TIMEOUT_MS = 1;
/**
 * How long past its own timeout one fetch may hold a worker slot.
 *
 * `fetchPublicResource` enforces `timeoutMs` on the request, then awaits the
 * pinned dispatcher's close without a bound. A connection whose teardown
 * hangs would hold the slot until the platform killed the run, and with five
 * slots that is a fifth of the crawl gone per stuck host. After this grace
 * the slot is released and the page recorded as `timeout`; the late result,
 * if it ever comes, is discarded.
 */
export const CRAWL_TEARDOWN_GRACE_MS = 2_000;
/** The HTTP status range a page must answer in to count as the page that ranks. */
const SUCCESS_STATUS_MIN = 200;
const SUCCESS_STATUS_MAX = 299;

/** The crawl id carries the SERP ordinal so "C3" and "S3" name the same page. */
function observationId(serpId: string): string {
  const ordinal = SERP_ID.exec(serpId)?.[1];
  if (ordinal === undefined) {
    throw new RangeError(`content-brief crawl target serp_id must match S<n>: ${serpId}`);
  }
  return `C${ordinal}`;
}

function decodeEntities(value: string): string {
  return value.replace(
    ENTITY,
    (match, numeric: string | undefined, named: string | undefined) => {
      if (numeric) {
        const code = numeric.toLowerCase().startsWith("x")
          ? Number.parseInt(numeric.slice(1), 16)
          : Number.parseInt(numeric, 10);
        const scalar =
          Number.isSafeInteger(code) &&
          code > 0 &&
          code <= 0x10ffff &&
          (code < 0xd800 || code > 0xdfff);
        return scalar ? String.fromCodePoint(code) : " ";
      }
      return named === undefined ? match : HTML_ENTITIES[named.toLowerCase()] ?? match;
    },
  );
}

/** Markup to text. Tags become spaces so `a</b><b>b` cannot become one word. */
function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** The prose region: `<body>` when declared, without code or graphics. */
function proseHtml(html: string): string {
  const body = BODY_TAG.exec(html)?.[1] ?? html;
  return body.replace(NOISE_ELEMENTS, " ");
}

interface HeadingSpan {
  readonly level: "h2" | "h3";
  readonly heading: string;
  /** Where the prose under this heading starts in the body HTML. */
  readonly from: number;
  /** Where the next heading starts, i.e. where this one's prose ends. */
  readonly to: number;
}

function headingSpans(body: string): readonly HeadingSpan[] {
  const matches = [...body.matchAll(HEADING_TAG)];
  return matches.map((match, index) => ({
    level: match[1] === "2" ? "h2" : "h3",
    heading: plainText(match[2] ?? ""),
    from: match.index + match[0].length,
    to: matches[index + 1]?.index ?? body.length,
  }));
}

/**
 * Prose under each h2/h3, in document order.
 *
 * Split at every h2 and h3, so an h2's excerpt stops where its first h3
 * starts: the excerpt is what the page says under that heading before it
 * changes subject, which is what a must-answer question needs as evidence.
 * A heading with no prose under it contributes nothing — an empty excerpt
 * would be an observation that says the page said nothing there.
 */
function excerptsOf(body: string): CrawlExcerpt[] {
  return headingSpans(body)
    .flatMap((span): CrawlExcerpt[] => {
      const text = plainText(body.slice(span.from, span.to));
      if (span.heading === "" || text === "") return [];
      return [
        {
          heading: boundChars(span.heading, HEADING_MAX_CHARS),
          level: span.level,
          text: boundChars(text, CRAWL_EXCERPT_MAX_CHARS),
        },
      ];
    })
    .slice(0, CRAWL_EXCERPTS_PER_PAGE_MAX);
}

/**
 * Exact media type, not a substring: `application/x-not-text/htmlish`
 * contains "text/html" and is not a page. Parameters after the semicolon
 * (charset) are the server's business.
 */
function isHtml(contentType: string | null): boolean {
  if (contentType === null) return false;
  const mediaType = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  return HTML_CONTENT_TYPES.some((type) => type === mediaType);
}

function failure(
  target: CrawlTarget,
  reason: CrawlFailure["reason"],
  code: string | null,
): CrawlOutcome {
  return { kind: "failed", value: { serp_id: target.serp_id, url: target.url, reason, code } };
}

/**
 * The first `CRAWL_HEADINGS_PER_PAGE_MAX` headings of one level, in document
 * order, each bounded by characters. A third-party page can carry hundreds of
 * h3s (every FAQ entry, every product card), and ten such pages would push
 * the brief past its handoff byte cap on headings alone.
 */
function boundHeadings(headings: readonly string[]): string[] {
  return headings
    .slice(0, CRAWL_HEADINGS_PER_PAGE_MAX)
    .map((heading) => boundChars(heading, HEADING_MAX_CHARS));
}

interface ObservationContext {
  readonly language: string;
  readonly fetchedAt: string;
}

/**
 * Project one fetched document into the ledger shape.
 *
 * `word_count` is null on a truncated body (counting a prefix would publish a
 * shorter page than the one that ranks) and on a language the counter cannot
 * tokenise (`zh` has no whitespace between words, so the count would be
 * sentences). Null, not 0: the page has words, we do not know how many.
 */
function observe(
  target: CrawlTarget,
  page: PublicResourceSuccess,
  context: ObservationContext,
): CrawlOutcome {
  const parsed = parsePage(page.body, page.finalUrl);
  const headings = contextPageHeadings(page.body);
  const body = proseHtml(page.body);
  const base = {
    id: observationId(target.serp_id),
    serp_id: target.serp_id,
    url: target.url,
    final_url: page.finalUrl,
    fetched_at: context.fetchedAt,
    h2: boundHeadings(headings.h2),
    h3: boundHeadings(headings.h3),
    excerpts: excerptsOf(body),
    content_hash: createHash("sha256").update(plainText(body)).digest("hex"),
  };
  const value: CrawlObservation = page.bodyComplete
    ? {
        ...base,
        body_complete: true,
        word_count: isWhitespaceTokenizedLanguage(context.language)
          ? parsed.wordCount
          : null,
      }
    : { ...base, body_complete: false, word_count: null };
  return { kind: "observed", value };
}

interface CrawlClock {
  readonly now: () => number;
  /** The instant after which no new URL is started. */
  readonly wallClockAt: number;
}

/**
 * How long one fetch may take: its own cap, or whatever is left of the crawl
 * wall clock, whichever is shorter. A fetch that could outlive the wall clock
 * would hold the run past the deadline the visitor was promised.
 */
function fetchTimeoutMs(clock: CrawlClock): number {
  return Math.min(CRAWL_FETCH_TIMEOUT_MS, Math.floor(clock.wallClockAt - clock.now()));
}

type FetchRace =
  | { readonly kind: "settled"; readonly value: PublicResourceResult }
  | { readonly kind: "threw" }
  | { readonly kind: "expired" };

/**
 * Wait for a fetch, but not forever. The operation keeps running after
 * `expired`; its eventual outcome is dropped, and a rejection is absorbed so
 * nothing surfaces as an unhandled rejection after the crawl has moved on.
 */
function raceFetch(operation: Promise<PublicResourceResult>, limitMs: number): Promise<FetchRace> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "expired" }), limitMs);
    operation
      .then(
        (value) => resolve({ kind: "settled", value }),
        () => resolve({ kind: "threw" }),
      )
      .finally(() => clearTimeout(timer))
      .catch(() => undefined);
  });
}

async function crawlOne(
  target: CrawlTarget,
  clock: CrawlClock,
  language: string,
  fetchResource: typeof fetchPublicResource,
): Promise<CrawlOutcome> {
  const timeoutMs = fetchTimeoutMs(clock);
  if (timeoutMs < MIN_FETCH_TIMEOUT_MS) return failure(target, "timeout", null);

  const raced = await raceFetch(
    fetchResource(target.url, { timeoutMs, maxBodyBytes: CRAWL_MAX_BYTES_PER_PAGE }),
    timeoutMs + CRAWL_TEARDOWN_GRACE_MS,
  );
  if (raced.kind === "expired") return failure(target, "timeout", null);
  // A throw is the transport failing outside its own error contract, so
  // there is no PublicResourceErrorCode to record.
  if (raced.kind === "threw") return failure(target, "provider_error", null);
  const page = raced.value;
  if (page.kind === "error") {
    return failure(target, page.code === "timeout" ? "timeout" : "provider_error", page.code);
  }
  // A 404 or 500 that happens to be served as HTML is not the page that
  // ranks: its "Page not found" headings would count as shared subtopics in
  // must_answer. The status is kept in `code` so the ledger can say which.
  if (page.finalStatus < SUCCESS_STATUS_MIN || page.finalStatus > SUCCESS_STATUS_MAX) {
    return failure(target, "provider_error", `http_${page.finalStatus}`);
  }
  if (!isHtml(page.contentType)) return failure(target, "validation_failed", null);

  try {
    return observe(target, page, {
      language,
      fetchedAt: new Date(clock.now()).toISOString(),
    });
  } catch {
    return failure(target, "validation_failed", null);
  }
}

/**
 * A fixed-size worker pool over an ordered list.
 *
 * Each worker takes the next unstarted item when it finishes its own, so
 * `limit` fetches are in flight at once and a slow host delays only the
 * items behind it in the queue. Results come back in input order.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/**
 * Fetch and parse the brief's competitor pages.
 *
 * Every target ends up in exactly one of the two lists. The crawl stops
 * starting URLs at its wall clock — the earlier of `CRAWL_DEADLINE_MS` from
 * now and the run deadline less the assembly envelope — and records whatever
 * had not begun as `timeout`, so the ledger can say "3 pages were not read"
 * with the same denominator the SERP produced.
 */
export async function crawlContentBriefTargets(
  input: ContentBriefCrawlInput,
  dependencies: ContentBriefCrawlDependencies = {},
): Promise<ContentBriefCrawlResult> {
  // Checked before any fetch: a malformed id is the handler's bug, and the
  // ledger invariant "C<n> names the same page as S<n>" cannot be repaired
  // after the fact.
  for (const target of input.targets) observationId(target.serp_id);
  const now = dependencies.now ?? Date.now;
  const fetchResource = dependencies.fetchResource ?? fetchPublicResource;
  // `deadlineAt` is the run's entry deadline with nothing subtracted yet; the
  // envelope comes off exactly once, here. Per-fetch timeouts are then cut
  // against `wallClockAt`, never against `deadlineAt` again.
  const clock: CrawlClock = {
    now,
    wallClockAt: Math.min(now() + CRAWL_DEADLINE_MS, input.deadlineAt - ENVELOPE_MS),
  };
  const outcomes = await mapWithConcurrency(
    input.targets,
    CRAWL_CONCURRENCY,
    (target) => crawlOne(target, clock, input.language, fetchResource),
  );
  return {
    observed: outcomes.flatMap((outcome) =>
      outcome.kind === "observed" ? [outcome.value] : [],
    ),
    failed: outcomes.flatMap((outcome) =>
      outcome.kind === "failed" ? [outcome.value] : [],
    ),
  };
}
