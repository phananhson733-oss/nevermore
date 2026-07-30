// @input  -- URL string + optional opts (timeoutMs, maxBodyBytes);
//            fetchWithTimeout + safeRead from ./rules/_fetch-helpers;
//            cheerio for HTML parsing;
//            normalizeUrlForDedup + isSameSite from ./_url-helpers
// @output -- fetchAndParsePage(url, opts?): Promise<PageRecord>
// @pos    -- D1 Phase 2 chunk 2a Track A — produce one PageRecord per URL.
//            Used by page-sampler → site-context-loader → SiteContext.pages
//            (wired in PR-C). Decoupled from PR-B (page-writer).
//            Chunk 2c: propagates FetchResult.hops → PageRecord.redirectHops.
//            Chunk 2d: extracts headingOutline (h1-h6 tag sequence, capped at
//            HEADING_OUTLINE_CAP=100) for HEADING.STRUCTURE detection rule.
//            A10/A13 light-up: extracts structuredData (JSON-LD blocks) +
//            analyticsTags (GA4/GTM) via ./page-extractors for the SD.* /
//            DATA.GA4_DETECTED / MEASURE.* rules.
//            SV1.5 light-up: extracts robotsNoindex (meta-robots noindex signal)
//            via ./page-extractors for url-inventory-builder → meta_robots column.
//            A9 SOCIAL/LANG light-up: extracts socialMeta (og/twitter presence) +
//            htmlLang (<html lang>) via ./page-meta-extractors for the SOCIAL.OG /
//            SOCIAL.TWITTER / LANG.HTML_LANG rules.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import * as cheerio from "cheerio";

import { isSameSite, normalizeUrlForDedup } from "./_url-helpers";
import {
  extractAnalyticsTags,
  extractRobotsMeta,
  extractStructuredData,
  xRobotsTagNoindex,
} from "./page-extractors";
import { extractHtmlLang, extractSocialMeta } from "./page-meta-extractors";
import {
  DEFAULT_BODY_CAP_BYTES,
  fetchWithTimeout,
  safeRead,
  type FetchWithTimeoutOpts,
} from "./rules/_fetch-helpers";
import type { PageRecord } from "./types";

/**
 * Outlinks captured per page for downstream detection rules (chunk 2b-2e
 * orphan / internal-link / canonical analyses). Larger than BFS_LINKS_PER_PAGE=20
 * (frontier-discipline) because detection rules need a richer per-page graph.
 */
export const OUTLINKS_FOR_DETECTION = 50;

/**
 * Maximum number of heading tag names captured in `headingOutline` per page.
 * Caps defensive against malicious-deep DOMs (e.g. 10k nested headings).
 * Chunk 2d: HEADING.STRUCTURE rule analyzes this array.
 */
export const HEADING_OUTLINE_CAP = 100;

export interface FetchAndParseOpts extends FetchWithTimeoutOpts {
  /** Override the streaming body cap (bytes). Default: DEFAULT_BODY_CAP_BYTES (5 MB). */
  readonly maxBodyBytes?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Determine a short error code from an error message. The message format
 * from fetchWithTimeout uses the code as a prefix (e.g. "ssrf_blocked: ...").
 *
 * Discriminated codes (HIGH-2 PR #87 review): redirect / scheme errors used
 * to silently collapse into `fetch_timeout` because none of their prefixes
 * matched. The catch-all has been narrowed:
 *   - "fetch_timeout"  — AbortError ONLY (timeout signal)
 *   - "fetch_error"    — generic non-Abort fetch failure (DNS, ECONNREFUSED, ...)
 */
function classifyError(err: Error): string {
  const msg = err.message;
  if (msg.startsWith("ssrf_blocked")) return "ssrf_blocked";
  if (msg.startsWith("body_too_large")) return "body_too_large";
  if (msg.startsWith("too_many_redirects")) return "too_many_redirects";
  if (msg.startsWith("unsupported_scheme")) return "unsupported_scheme";
  if (msg.startsWith("redirect_invalid_location")) return "redirect_invalid";
  if (err.name === "AbortError" || msg.includes("AbortError")) {
    return "fetch_timeout";
  }
  return "fetch_error";
}

// ---------------------------------------------------------------------------
// Null (error) PageRecord factory
// ---------------------------------------------------------------------------

function nullPageRecord(
  url: string,
  error: string,
  redirectHops: number = 0,
): PageRecord {
  return {
    url,
    finalUrl: null,
    statusCode: 0,
    title: null,
    metaDescription: null,
    canonical: null,
    h1Count: 0,
    headingOutline: [],
    internalOutlinks: [],
    rawTextLength: 0,
    error,
    redirectHops,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetch a URL and parse the HTML response into a domain-level PageRecord.
 * Never throws — all error paths return a PageRecord with `error` set.
 *
 * TODO(PR-C): Non-utf-8 charsets misdecode silently. iconv-lite re-decode
 * requires `safeRead` to expose raw bytes (Uint8Array) alongside the decoded
 * string — deferred until chunk 2a integration PR.
 */
export async function fetchAndParsePage(
  url: string,
  opts: FetchAndParseOpts = {},
): Promise<PageRecord> {
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_BODY_CAP_BYTES;

  // 1. Fetch (SSRF-hardened, redirect-revalidated, timeout-guarded).
  const {
    response,
    error: fetchError,
    hops,
  } = await fetchWithTimeout(url, {
    timeoutMs: opts.timeoutMs,
    userAgent: opts.userAgent,
  });

  if (fetchError !== null || response === null) {
    return nullPageRecord(
      url,
      classifyError(fetchError ?? new Error("fetch_timeout")),
      hops,
    );
  }

  const finalUrl = response.url ?? url;
  const statusCode = response.status;

  // 2. Read body with streaming cap.
  const {
    text,
    truncated,
    error: readError,
  } = await safeRead(response, maxBodyBytes);

  // HIGH-3 PR #87 review: distinguish stream-error from truncation. Both used
  // to collapse into `body_too_large` and drop the successful response's
  // statusCode + finalUrl. The HTTP response existed; only the body failed.
  if (readError !== null) {
    return {
      url,
      finalUrl,
      statusCode,
      title: null,
      metaDescription: null,
      canonical: null,
      h1Count: 0,
      headingOutline: [],
      internalOutlinks: [],
      rawTextLength: 0,
      error: "read_error",
      redirectHops: hops,
    };
  }
  if (text === null) {
    // safeRead never returns text=null without a readError today, but the
    // contract permits it; treat defensively as truncation (best-effort).
    return {
      url,
      finalUrl,
      statusCode,
      title: null,
      metaDescription: null,
      canonical: null,
      h1Count: 0,
      headingOutline: [],
      internalOutlinks: [],
      rawTextLength: 0,
      error: "body_too_large",
      redirectHops: hops,
    };
  }

  // 3. Parse HTML with cheerio (permissive — never throws on malformed HTML).
  // `xmlMode: false` selects parse5 (HTML spec parser), which always decodes
  // named/numeric entities per the spec. The `decodeEntities` flag only
  // applies to htmlparser2 (xml mode); in HTML mode entity decoding is
  // implicit and cannot be disabled — documented here so reviewers don't
  // re-add a now-rejected `decodeEntities: true` option (MED-4 PR #87).
  let $: ReturnType<typeof cheerio.load>;
  try {
    $ = cheerio.load(text, { xmlMode: false });
  } catch {
    return {
      url,
      finalUrl,
      statusCode,
      title: null,
      metaDescription: null,
      canonical: null,
      h1Count: 0,
      headingOutline: [],
      internalOutlinks: [],
      rawTextLength: 0,
      error: "parse_error",
      redirectHops: hops,
    };
  }

  // 4. Extract fields.
  const rawTitle = $("title").first().text();
  const title = rawTitle.trim().length > 0 ? rawTitle.trim() : null;

  const rawDesc = $('meta[name="description"]').attr("content") ?? null;
  const metaDescription = rawDesc !== null ? rawDesc.trim() || null : null;

  const canonicalHref = $('link[rel="canonical"]').attr("href") ?? null;
  let canonical: string | null = null;
  if (canonicalHref) {
    try {
      canonical = new URL(canonicalHref, finalUrl).toString();
    } catch {
      canonical = null;
    }
  }

  const h1Count = $("h1").length;

  // 4b. Extract heading outline — ordered sequence of heading tag names, capped
  // at HEADING_OUTLINE_CAP to defend against malicious-deep DOMs. Used by the
  // HEADING.STRUCTURE detection rule (chunk 2d) for level-skip detection.
  const headingOutlineRaw: string[] = [];
  $("h1,h2,h3,h4,h5,h6").each((_, el) => {
    if (headingOutlineRaw.length >= HEADING_OUTLINE_CAP) return false; // break
    headingOutlineRaw.push(el.tagName.toLowerCase());
  });
  const headingOutline: readonly string[] = Object.freeze([
    ...headingOutlineRaw,
  ]);

  // 5. Collect internal outlinks (same-site, normalized, deduped, capped).
  // NB: `isSameSite` here is intentionally laxer than the BFS crawler's
  // `isSameOrigin` (port-agnostic, www-stripping). Detection rules treat
  // www / no-www / dev-port variants as conceptually the same site; BFS
  // does not because frontier discipline must be strict.
  const seen = new Set<string>();
  const outlinks: string[] = [];
  $("a[href]").each((_, el) => {
    if (outlinks.length >= OUTLINKS_FOR_DETECTION) return false; // break
    const href = $(el).attr("href");
    if (!href) return;
    let resolved: string;
    try {
      resolved = new URL(href, finalUrl).toString();
    } catch {
      return;
    }
    if (!isSameSite(resolved, finalUrl)) return;
    const key = normalizeUrlForDedup(resolved);
    if (seen.has(key)) return;
    seen.add(key);
    outlinks.push(key);
  });

  const rawTextLength = $("body").text().length;

  // Freeze the outlinks array so the readonly-string[] contract on PageRecord
  // is enforced at runtime, not just at the type level (covariance lets a
  // mutable array satisfy the readonly slot which would let downstream rules
  // mutate it).
  const internalOutlinks: readonly string[] = Object.freeze([...outlinks]);

  // 6. Extract structured-data (JSON-LD) + analytics tags (GA4/GTM) + meta-robots
  // noindex signal for the A10 SD.* / A1/A13 DATA/MEASURE.* / SV1.5 rules.
  // Pure cheerio extraction (no I/O).
  const structuredData = extractStructuredData($);
  const analyticsTags = extractAnalyticsTags($);
  // A9 SOCIAL.OG / SOCIAL.TWITTER + LANG.HTML_LANG signals (pure cheerio scan).
  const socialMeta = extractSocialMeta($);
  const htmlLang = extractHtmlLang($);
  const robotsMeta = extractRobotsMeta($);
  const xRobotsNoindex = xRobotsTagNoindex(
    response.headers.get("x-robots-tag"),
  );

  // robotsNoindex 三态（喂 SV1.5 isIndexable 的 provenance）：
  // - X-Robots-Tag header noindex 权威（body 截断也可信）→ true
  // - 否则 body 截断时 meta 扫描不完整、无法确认"干净" → undefined（unknown）
  // - 否则完整扫描，取 meta 信号（true/false）
  const robotsNoindex: boolean | undefined = xRobotsNoindex
    ? true
    : truncated
      ? undefined
      : robotsMeta.noindex;

  return {
    url,
    finalUrl,
    statusCode,
    title,
    metaDescription,
    canonical,
    h1Count,
    headingOutline,
    internalOutlinks,
    rawTextLength,
    error: truncated ? "body_too_large" : null,
    redirectHops: hops,
    structuredData,
    analyticsTags,
    socialMeta,
    htmlLang,
    robotsNoindex,
  };
}
