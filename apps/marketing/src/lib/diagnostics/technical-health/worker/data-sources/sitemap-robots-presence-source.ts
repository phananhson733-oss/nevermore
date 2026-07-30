// @input  -- siteUrl + _fetch-helpers.fetchWithTimeout; pure analyze helpers
//            (analyzeSitemapBody / analyzeRobotsBody) reused from the A3 rules
// @output -- buildSitemapRobotsPresence(siteUrl): Promise<SitemapRobotsPresence> —
//            a frozen per-run presence snapshot: one /sitemap.xml + one
//            /robots.txt fetch, each classified into a discriminated state.
// @pos    -- A1 weight-unlock data source. Surfaces sitemap/robots PRESENCE onto
//            SiteContext (like gscCoverage/perf) so the A1 DATA.SITEMAP_PARSED /
//            DATA.ROBOTS_PARSED rules read a real signal. Never throws — every
//            fetch/parse failure degrades to a typed *_error / fetch_error state.
//            Zero AI, no DB. Reuses fetchWithTimeout (SSRF-guarded, timeout-bounded).
//            A1 DATA.FRESHNESS light-up: sitemap presence now also carries
//            `maxLastmodAgeDays` (most-recent <lastmod> age vs an injected run
//            reference time `nowMs` — deterministic, never Date.now() inside a rule).
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  analyzeRobotsBody,
  type RobotsAnalysis,
} from "../rules/crawl-robots-core-helpers";
import {
  analyzeSitemapBody,
  type SitemapRootTag,
} from "../rules/crawl-sitemap-exists-helpers";
import { extractMaxLastmodAgeDays } from "../rules/sitemap-lastmod-helpers";
import { fetchWithTimeout } from "../rules/_fetch-helpers";

/**
 * /sitemap.xml presence state (data-availability axis, not the A3 crawl axis):
 *   - "parsed"       — 200 + a valid <urlset> or <sitemapindex> root
 *   - "malformed"    — 200 but neither root tag (HTML error page / garbage)
 *   - "empty"        — 200 but a blank body
 *   - "server_error" — non-404 non-200 (5xx or other unexpected status)
 *   - "missing"      — 404 (no sitemap published)
 *   - "fetch_error"  — fetch threw / network/SSRF/timeout (could not read)
 */
export type SitemapPresenceState =
  | "parsed"
  | "malformed"
  | "empty"
  | "server_error"
  | "missing"
  | "fetch_error";

/**
 * /robots.txt presence state:
 *   - "parsed"      — 200 + at least one parseable User-agent group
 *   - "absent"      — 404/410 (RFC 9309: no file = open access; valid, not a defect)
 *   - "malformed"   — 200 but no User-agent directive (unreadable as robots.txt)
 *   - "fetch_error" — fetch threw OR an unexpected status (5xx etc.) — unreadable
 */
export type RobotsPresenceState =
  | "parsed"
  | "absent"
  | "malformed"
  | "fetch_error";

export interface SitemapPresence {
  readonly state: SitemapPresenceState;
  /** Root tag when status 200 + body parsed; "unknown" otherwise. */
  readonly rootTag: SitemapRootTag;
  /** HTTP status observed (0 when the fetch threw). */
  readonly statusCode: number;
  /**
   * Age in whole days of the MOST-RECENT `<lastmod>` declared in the sitemap,
   * computed against the run reference time passed to
   * `buildSitemapRobotsPresence` (A1 DATA.FRESHNESS). `null` when the sitemap
   * has no parseable `<lastmod>`, is missing, or could not be read. Reflects
   * sitemap-DECLARED freshness only — NOT verified content-update freshness.
   */
  readonly maxLastmodAgeDays: number | null;
}

export interface RobotsPresence {
  readonly state: RobotsPresenceState;
  /** Parse facts when 200 + readable; undefined otherwise. */
  readonly analysis?: RobotsAnalysis;
  /** HTTP status observed (0 when the fetch threw). */
  readonly statusCode: number;
}

/**
 * The frozen per-run sitemap/robots PRESENCE snapshot injected onto SiteContext
 * by `loadCoverageSnapshots`. Both sub-results always carry a concrete state —
 * fetch failures collapse to `fetch_error`, never absence — so an A1 rule treats
 * "snapshot absent" (ctx.sitemapRobots === undefined, presence step never ran) as
 * `na`, distinct from "fetched and failed" (a real state).
 */
export interface SitemapRobotsPresence {
  readonly sitemap: SitemapPresence;
  readonly robots: RobotsPresence;
}

/** Sitemap presence with no parseable body (no rootTag / no lastmod). */
function sitemapNullPresence(
  state: SitemapPresenceState,
  statusCode: number,
): SitemapPresence {
  return { state, rootTag: "unknown", statusCode, maxLastmodAgeDays: null };
}

async function probeSitemap(
  siteUrl: string,
  nowMs: number,
): Promise<SitemapPresence> {
  const sitemapUrl = new URL("/sitemap.xml", siteUrl).toString();
  const { response, error } = await fetchWithTimeout(sitemapUrl);

  if (error !== null || response === null) {
    return sitemapNullPresence("fetch_error", 0);
  }

  const statusCode = response.status;
  if (statusCode === 404) {
    return sitemapNullPresence("missing", statusCode);
  }
  if (statusCode !== 200) {
    return sitemapNullPresence("server_error", statusCode);
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    return sitemapNullPresence("fetch_error", statusCode);
  }

  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return sitemapNullPresence("empty", statusCode);
  }

  // A1 DATA.FRESHNESS: most-recent <lastmod> age vs the injected run reference
  // time (deterministic — never reads the wall clock here).
  const maxLastmodAgeDays = extractMaxLastmodAgeDays(trimmed, nowMs);

  const { rootTag } = analyzeSitemapBody(trimmed);
  if (rootTag === "urlset" || rootTag === "sitemapindex") {
    return { state: "parsed", rootTag, statusCode, maxLastmodAgeDays };
  }
  return { state: "malformed", rootTag, statusCode, maxLastmodAgeDays };
}

async function probeRobots(siteUrl: string): Promise<RobotsPresence> {
  const robotsUrl = new URL("/robots.txt", siteUrl).toString();
  const { response, error } = await fetchWithTimeout(robotsUrl);

  if (error !== null || response === null) {
    return { state: "fetch_error", statusCode: 0 };
  }

  const statusCode = response.status;
  // RFC 9309 §2.3.1: 404/410 ⇒ no restrictions; a missing robots.txt is valid.
  if (statusCode === 404 || statusCode === 410) {
    return { state: "absent", statusCode };
  }
  if (statusCode !== 200) {
    // 5xx / unexpected status ⇒ could not read the file ⇒ fetch_error.
    return { state: "fetch_error", statusCode };
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    return { state: "fetch_error", statusCode };
  }

  const analysis = analyzeRobotsBody(body);
  if (!analysis.hasUserAgent) {
    return { state: "malformed", analysis, statusCode };
  }
  return { state: "parsed", analysis, statusCode };
}

/**
 * Fetch /sitemap.xml + /robots.txt once each and classify presence. Never
 * throws — every failure path degrades to a typed error state. The caller
 * (`loadCoverageSnapshots`) further wraps this in degrade-to-na: if the whole
 * presence step is skipped, `ctx.sitemapRobots` stays undefined and the rules
 * abstain (na).
 *
 * `nowMs` is the run reference time for the A1 DATA.FRESHNESS lastmod-age
 * computation. It defaults to `Date.now()` HERE — at the data-source boundary,
 * captured ONCE per run — never inside a rule. Tests pass a fixed epoch so the
 * snapshot (and the FRESHNESS verdict) is deterministic.
 */
export async function buildSitemapRobotsPresence(
  siteUrl: string,
  nowMs: number = Date.now(),
): Promise<SitemapRobotsPresence> {
  const [sitemap, robots] = await Promise.all([
    probeSitemap(siteUrl, nowMs),
    probeRobots(siteUrl),
  ]);
  return { sitemap, robots };
}
