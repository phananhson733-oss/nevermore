// @input  -- finding-schemas.ts (Severity), run-schemas.ts (RunStatus indirectly), scoring.ts (Grade)
// @output -- SiteContext / RuleOutcome / DetectionRule<TInput> / RunResult / PageRecord interfaces
// @pos    -- D1 Phase 1 chunk 2 — extended types: RuleOutcome gains `evidence`
//            field; RunResult gains `findingCount`. D1 Phase 2: RuleOutcome
//            gains `affectedUrlPercent`, `sampledUrlCount` (Plan §Q-4 derived
//            percent), `sampleUrls`, `affectedTemplates`. Chunk 2a Track A:
//            PageRecord — domain-level record produced by page-fetcher.ts.
//            Chunk 2a Track C: SiteContext gains `pages: readonly PageRecord[]`
//            so detection rules can consume crawled page data.
//            Chunk 2c: PageRecord gains `redirectHops` — hop count from
//            FetchResult.hops, used by URL.REDIRECT_CHAINS detection rule.
//            Chunk 2d: PageRecord gains `headingOutline: readonly string[]`
//            for HEADING.STRUCTURE rule (h1→h2→h3 ordering analysis).
//            A10/A13 light-up: PageRecord gains optional `structuredData`
//            (parsed JSON-LD blocks → 5 A10 SD.* rules) + `analyticsTags`
//            (GA4/GTM tag scan → A1 DATA.GA4_DETECTED + 3 A13 MEASURE.* rules);
//            both optional (`?`) so the rules degrade to na when absent — and so
//            existing PageRecord fixtures stay valid (mirrors SiteContext's
//            optional snapshot fields). Adds the `StructuredDataBlock` interface.
//            Phase 3 U4a: adds the `RenderedPage` interface (§1.7 render-diff
//            fields) and `SiteContext.renderedPages?: readonly RenderedPage[]`
//            (optional — absent when no render stage ran; A5 RENDER.* rules
//            return `na` then).
//            Phase 5 U7: SiteContext gains `perf?: PerfCoverage` (PSI/CrUX
//            snapshot for the A8 PERF.* rules — optional, na when absent).
//            A1 weight-unlock: SiteContext gains `sitemapRobots?: SitemapRobotsPresence`
//            (one /sitemap.xml + one /robots.txt presence probe for the A1
//            DATA.SITEMAP_PARSED / DATA.ROBOTS_PARSED rules — optional, na when absent).
//            No Zod here: these are internal worker-process types, not API boundary schemas.
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { Severity } from "../finding-schemas";
import type { Grade } from "../scoring";
import type { GscIndexCoverage } from "./data-sources/gsc-index-coverage-source";
import type { PerfCoverage } from "./data-sources/psi-source";
import type { SitemapRobotsPresence } from "./data-sources/sitemap-robots-presence-source";
import type { UrlInventoryRow } from "./url-inventory-builder";

/**
 * The materialized context a `DetectionRule` receives. Built once per run by
 * `site-context-loader.ts`. Phase 0 carried the bare minimum
 * (runId / siteId / productId / siteUrl); Phase 2 chunk 2a Track C adds
 * `pages` + `pagesByUrl`. Future phases will add `robotsTxt`, `sitemapUrls`,
 * `gscData`, etc. Rules are pure functions over this context, so adding fields
 * is backwards-compatible.
 */
export interface SiteContext {
  readonly runId: string;
  readonly siteId: string;
  readonly productId: string;
  readonly siteUrl: string;
  /**
   * Crawled page records produced by the sample→fetch pipeline in
   * `loadSiteContext` (chunk 2a Track C). Empty array when the site has no
   * crawlable pages or the sampler returned nothing. Detection rules that
   * need per-page data (chunks 2b–2e) read from this field.
   */
  readonly pages: readonly PageRecord[];
  /**
   * Derived index of `pages` for O(1) lookup, keyed by `PageRecord.url` AFTER
   * passing through `_url-helpers.normalizeUrlForDedup` (Plan §D-5 — strip
   * fragment, sort query params, lowercase scheme/host). The 13 detection
   * rules in chunks 2b–2e (e.g. canonical-mismatch, h1-missing, thin-content)
   * need to fetch a specific page by URL without scanning the full `pages`
   * array on every rule invocation. Built once by `loadSiteContext` from
   * `new Map(records.map(p => [normalizeUrlForDedup(p.url), p]))` and never
   * mutated thereafter.
   *
   * Consumers MUST normalize their lookup key with the same helper or the
   * lookup will false-negative on query-order / case differences. The
   * canonical helpers in `rules/url-canonical-helpers.ts` are aligned for
   * exactly this reason (PR #93 review HIGH-1/HIGH-2/HIGH-3).
   */
  readonly pagesByUrl: ReadonlyMap<string, PageRecord>;
  /**
   * Render-stage output for the A5 RENDER.* rules (D1 v2.1 Phase 3 §1.7 +
   * AC4). One entry per sampled-and-rendered URL. OPTIONAL — absent (undefined)
   * or empty when no render stage ran (U4b not yet wired, or render disabled).
   * Every RENDER.* rule MUST return `na` when this is absent/empty rather than
   * fabricating a fail. Produced by the U4b live-render step; consumed here only
   * as fixtures (U4a builds the deterministic rule logic, not the navigation).
   */
  readonly renderedPages?: readonly RenderedPage[];
  /**
   * Frozen per-run GSC index-coverage snapshot for the A3 CRAWL.* rules (D1
   * v2.1 Phase 4 U6 / AC2/AC3/AC10). OPTIONAL — absent (undefined) when no GSC
   * data source ran. The `CRAWL.GSC_INDEX_COVERAGE` rule MUST return `na` when
   * this is absent or `status==='na'` (AC3: never display 0% for missing GSC).
   * A `GscIndexCoverage` discriminated union: see
   * `data-sources/gsc-index-coverage-source.ts`. Typed as `unknown`-free import
   * below to avoid a worker→data-source import cycle in this types module.
   */
  readonly gscCoverage?: GscIndexCoverage;
  /**
   * Frozen per-run PSI/CrUX performance snapshot for the A8 PERF.* rules (D1
   * v2.1 Phase 5 U7 / AC8). OPTIONAL — absent (undefined) when no PSI data
   * source ran. Every PERF.* rule MUST return `na` when this is absent or
   * `status==='na'` (degrade-to-na; CrUX-missing per URL is also na, excluded
   * from the scoring denominator — never a fabricated 0). A `PerfCoverage`
   * discriminated union: see `data-sources/psi-source.ts`.
   */
  readonly perf?: PerfCoverage;
  /**
   * Frozen per-run sitemap/robots PRESENCE snapshot for the A1
   * DATA.SITEMAP_PARSED / DATA.ROBOTS_PARSED rules (A1 weight-unlock).
   * OPTIONAL — absent (undefined) when the presence step never ran (e.g.
   * test contexts, or a future flag-off). Both rules MUST return `na` when
   * this is absent (data-honesty: "无法判断" ≠ a fabricated fail). Produced by
   * `buildSitemapRobotsPresence` in `loadCoverageSnapshots` (one /sitemap.xml +
   * one /robots.txt fetch, classified). Fetch failures collapse to a typed
   * `fetch_error` state INSIDE the snapshot — so "snapshot present, state error"
   * is a real site signal, distinct from "snapshot absent" (step skipped → na).
   */
  readonly sitemapRobots?: SitemapRobotsPresence;
  /**
   * Merged `technical_url_inventory` rows for the A2 URLINV.* rules (AC1). One
   * row per distinct normalized URL with the `found_in_*` multi-source flags +
   * http/index facts. OPTIONAL — absent (undefined) when the GSC coverage step
   * never ran (e.g. test contexts, or a future flag-off). Built once by
   * `runGscCoverageStep` (which already merges + writes it) and injected here by
   * `loadCoverageSnapshots`; never re-merged. Each URLINV.* rule MUST return `na`
   * when this is absent. Honest semantics: a `found_in_*` flag is false when that
   * source NEVER FLOWED (e.g. crawl-only runs have only `found_in_crawl=true`),
   * so the GSC/GA4/planned/content-queue gated checks return `na` rather than a
   * fabricated pass over a structurally-absent source. See `UrlInventoryRow`.
   */
  readonly urlInventory?: readonly UrlInventoryRow[];
}

/**
 * Per-URL raw-vs-rendered comparison produced by the A5 render stage
 * (PRD v2.1 §6 A5 / ref §1.7). All counts are deterministic measurements; no
 * AI. `template` buckets the URL (e.g. "/", "/blog/*") so RENDER.* rules can
 * aggregate one finding per template instead of one per page.
 *
 * Length/count fields feed `diff-calculator.calcRenderDiff`:
 *   contentRatio = rawHtmlTextLength / max(renderedTextLength, 1)  (clamped 0..1)
 *   linkRatio    = rawInternalAnchorCount / max(renderedInternalAnchorCount, 1)
 *
 * The boolean `jsRequiredFor*` flags are convenience summaries the render stage
 * may set; rules derive their own verdicts from the ratios, not these flags.
 */
export interface RenderedPage {
  /** Input URL that was rendered (canonical, pre-redirect). */
  readonly url: string;
  /** Template bucket for per-template aggregation (e.g. "/", "/blog/*"). */
  readonly template: string;
  /** Visible text length of the RAW (pre-JS) HTML body. */
  readonly rawHtmlTextLength: number;
  /** Visible text length of the RENDERED (post-JS) DOM body. */
  readonly renderedTextLength: number;
  /** Internal-anchor count in the RAW HTML. */
  readonly rawInternalAnchorCount: number;
  /** Internal-anchor count in the RENDERED DOM. */
  readonly renderedInternalAnchorCount: number;
  /** `<h1>` count in the RAW HTML. */
  readonly rawH1Count: number;
  /** `<h1>` count in the RENDERED DOM. */
  readonly renderedH1Count: number;
  /** Structured-data block count in the RAW HTML. */
  readonly rawStructuredDataCount: number;
  /** Structured-data block count in the RENDERED DOM. */
  readonly renderedStructuredDataCount: number;
  /** Console error messages captured during render (fatal-JS detection). */
  readonly consoleErrors: readonly string[];
  /** URLs of resources (JS/CSS) that failed to load during render. */
  readonly failedResources: readonly string[];
  /** True when main content only appears after JS execution. */
  readonly jsRequiredForMainContent: boolean;
  /** True when internal links only appear after JS execution. */
  readonly jsRequiredForLinks: boolean;
  /** True when head tags (title/canonical/meta) only appear after JS. */
  readonly jsRequiredForHeadTags: boolean;
  /** Wall-clock render duration in milliseconds (timeout detection). */
  readonly renderDurationMs: number;
  /** `<title>` text in the RAW HTML, null if absent pre-JS. */
  readonly rawTitle: string | null;
  /** canonical href in the RAW HTML, null if absent pre-JS. */
  readonly rawCanonical: string | null;
  /** `<title>` text in the RENDERED DOM, null if absent. */
  readonly renderedTitle: string | null;
  /** canonical href in the RENDERED DOM, null if absent. */
  readonly renderedCanonical: string | null;
}

/**
 * Evidence record attached to a RuleOutcome. Each record captures one
 * atomic piece of observed data. The shape is an open object so individual
 * rules can attach domain-specific fields (statusCode, snippet, etc.) without
 * a global union type here.
 *
 * Phase 1 evidence kinds used by CRAWL.ROBOTS_CORE:
 *   - "http_response" — { url, statusCode, error? }
 *   - "extracted_text" — { snippet }
 */
export type EvidenceRecord = Readonly<Record<string, unknown>>;

/**
 * The uniform envelope each detection rule returns. The finding-builder
 * lifts this to `DiagnosticFinding` by attaching severity from
 * `check-thresholds.ts`, observed/affected metadata, evidence rows, and
 * narrative columns (problem_definition / why_it_matters / etc.).
 *
 * Phase 2 additions (all optional — existing rules are backwards-compatible):
 *   - `affectedUrlPercent`: 0..100 inclusive. The percentage of sampled URLs
 *     that triggered this finding. Forwarded to `affected_url_percent`.
 *   - `sampleUrls`: up to 5 representative URLs that triggered the issue.
 *     finding-builder caps at 5 entries before insert (Plan §D-3 evidence URLs).
 *   - `affectedTemplates`: template-bucket strings e.g. `"/products/*"`.
 *     Pass-through array; no format validation. Forwarded to `affected_templates`.
 *
 * DB columns present since migration 20260520010000; insert path fully wired.
 */
export interface RuleOutcome {
  readonly checkId: string;
  readonly status: "pass" | "warning" | "fail" | "na";
  /**
   * Rule-stated severity override. When a rule's verdict needs a finer severity
   * than `getDefaultSeverity(checkId, status)` can express — e.g. GSC index
   * coverage where <30% is P0 but 30-60% is P1, both with status "fail" — the
   * rule sets this directly. The finding-builder / check-writer use this when
   * present, else fall back to the deterministic status→severity map. Still
   * zero-AI: a deterministic function of the rule's measured inputs.
   */
  readonly severity?: Severity;
  readonly observedValue?: unknown;
  readonly affectedPageIds?: readonly string[];
  readonly evidence?: readonly EvidenceRecord[];
  /**
   * Phase 2: 0..100 — percentage of sampled URLs triggering this finding.
   * When `sampledUrlCount` is also provided, the builder ignores this field
   * and derives the percent from `affectedPageIds.length / sampledUrlCount`.
   * Used as fallback when `sampledUrlCount` is absent. Clamped to 0..100.
   */
  readonly affectedUrlPercent?: number;
  /**
   * Total URLs sampled when running this rule. Builder derives
   * `affected_url_percent` from `(affectedPageIds.length / sampledUrlCount) * 100`
   * and rounds to 1 decimal. When undefined, falls back to `affectedUrlPercent`
   * if provided (clamped), else 0. Optional for backwards-compatibility.
   */
  readonly sampledUrlCount?: number;
  /** Phase 2: up to 5 representative URLs that triggered the issue. */
  readonly sampleUrls?: readonly string[];
  /** Phase 2: template-bucket strings e.g. "/products/*", "/blog/*". */
  readonly affectedTemplates?: readonly string[];
}

/**
 * Pure-TS rule interface. The default `TInput = SiteContext` lets specialized
 * rules narrow to a subset (e.g. a rule that only needs `crawledPages` can
 * declare `DetectionRule<Pick<SiteContext, 'crawledPages'>>`).
 *
 * Phase 3+ rules with async I/O will be lifted to `@workflow/next`
 * `step.run()` callsites — the async signature is forward-compatible.
 */
export interface DetectionRule<TInput = SiteContext> {
  readonly checkId: string;
  readonly run: (ctx: TInput) => Promise<RuleOutcome>;
}

/**
 * The runner's terminal return value.
 * - `completed`: full happy path finished; counters + findingCount are valid.
 * - `failed`: rule loop or infrastructure threw; `error` carries the message.
 * - `running`: idempotent re-entry — another worker already owns this row;
 *   no transition was issued. Cron logs should treat this as "skipped".
 * Phase 0 always returns `overallScore: null` because no scorer is wired yet.
 * Phase 1 adds `findingCount` — the number of finding rows inserted.
 */
export interface RunResult {
  readonly runId: string;
  readonly status: "completed" | "failed" | "running" | "cancelled";
  readonly overallScore: number | null;
  /** Grade per PRD §9 (A/B/C/D/F). Null when overallScore is null. */
  readonly grade: Grade | null;
  readonly p0Count: number;
  readonly p1Count: number;
  readonly p2Count: number;
  readonly p3Count: number;
  readonly findingCount: number;
  readonly error?: string;
}

/**
 * Re-exported severity union so worker callers don't have to reach into
 * `finding-schemas.ts` for a type that morally belongs to the worker layer.
 */
export type { Severity };

/**
 * One parsed `<script type="application/ld+json">` block (A10 SD.* rules).
 * Produced by page-fetcher.ts: each block is `JSON.parse`d (errors captured,
 * never thrown). `@type` is normalized to a string array (array-safe — a node
 * may declare a single type or an array of types). A top-level `@graph` array
 * is flattened so each node becomes its own `StructuredDataBlock`.
 *
 * Honest semantics: a page with NO json-ld yields an EMPTY `structuredData`
 * array (not a parseError block) — "no structured data" is a coverage gap, not
 * a parse failure. `parseError: true` only when the block's JSON is malformed;
 * `types` is then `[]`.
 */
export interface StructuredDataBlock {
  /** Normalized `@type` values for this block (array-safe). Empty on parse error. */
  readonly types: readonly string[];
  /** True when the block's JSON could not be parsed (malformed). */
  readonly parseError: boolean;
}

/**
 * GA4 / GTM analytics tag ids scanned from `<script>` tags (src + inline) by
 * page-fetcher.ts. Consumed by A1 `DATA.GA4_DETECTED` and the A13
 * `MEASURE.GA4_TAG_PRESENT` / `MEASURE.GTM_TAG_PRESENT` / `MEASURE.DUPLICATE_TAGS`
 * rules. Ids are deduped per page. This is a FRONT-END tag presence signal only
 * (it does not assert that data actually reaches GA4/GTM) — see SPEC §A13 precond.
 */
export interface AnalyticsTags {
  /** Deduped GA4 measurement ids (`G-XXXXXXXXXX`) found on the page. */
  readonly ga4Ids: readonly string[];
  /** Deduped GTM container ids (`GTM-XXXXXXX`) found on the page. */
  readonly gtmIds: readonly string[];
}

/**
 * Open Graph + Twitter Card meta-tag presence scanned from `<head>` `<meta>`
 * tags by page-meta-extractors.ts. Consumed by the A9 `SOCIAL.OG` /
 * `SOCIAL.TWITTER` rules. Each flag is true only when the tag exists with a
 * non-empty `content` (an empty tag is treated as absent — front-end markup
 * presence only, no value validation).
 */
export interface SocialMeta {
  /** `<meta property|name="og:title">` present with non-empty content. */
  readonly ogTitle: boolean;
  /** `<meta property|name="og:description">` present with non-empty content. */
  readonly ogDescription: boolean;
  /** `<meta property|name="og:image">` present with non-empty content. */
  readonly ogImage: boolean;
  /** `<meta name|property="twitter:card">` present with non-empty content. */
  readonly twitterCard: boolean;
}

/**
 * Domain-level record produced by `fetchAndParsePage` (page-fetcher.ts) for
 * a single URL. Chunk 2a Track A — consumed by chunk 2b/2c/2d/2e detection
 * rules via `ctx.pages: readonly PageRecord[]` (wired in PR-C).
 *
 * Error classification strings (HIGH-2/HIGH-3 PR #87 review tightened):
 *   "fetch_timeout"      — AbortError (timeout signal) ONLY
 *   "fetch_error"        — generic non-Abort fetch failure (DNS, ECONNREFUSED, ...)
 *   "ssrf_blocked"       — SSRF guard rejected the URL
 *   "too_many_redirects" — redirect chain exceeded MAX_REDIRECTS
 *   "unsupported_scheme" — URL was not http(s)
 *   "redirect_invalid"   — 3xx Location header was unparseable
 *   "body_too_large"     — Content-Length exceeded MAX_RESPONSE_BYTES OR
 *                          safeRead saw text=null without a stream error
 *                          (current safeRead never produces this, but the
 *                          contract permits it — handled defensively)
 *   "read_error"         — HTTP response succeeded but the body stream failed
 *                          mid-read. `statusCode` + `finalUrl` are preserved.
 *   "parse_error"        — cheerio load threw unexpectedly (defensive)
 *   null                 — no error; fetch + parse succeeded
 *
 * Note: a non-200 status code (e.g. 404) does NOT set `error`. The fetch
 * succeeded; the page simply isn't 200. Rules inspect `statusCode` directly.
 */
export interface PageRecord {
  /** Input URL (canonical input, before redirects). */
  readonly url: string;
  /**
   * URL after redirects. Equals `url` when no redirect, otherwise the final
   * resolved URL. Detection rules that care about redirect chains MUST
   * compare `url !== finalUrl` themselves; no separate `redirected: boolean`
   * is provided (yagni until a rule needs it).
   */
  readonly finalUrl: string | null;
  /** HTTP status code. 0 when fetch failed (SSRF-blocked, timeout, network error). */
  readonly statusCode: number;
  /** Text content of the first `<title>` element, trimmed. Null if absent. */
  readonly title: string | null;
  /** Content attribute of `<meta name="description">`, trimmed. Null if absent. */
  readonly metaDescription: string | null;
  /**
   * Page-declared canonical URL, absolutized against `finalUrl`. MAY BE
   * ATTACKER-CONTROLLED CROSS-ORIGIN (a malicious page can declare
   * `<link rel="canonical" href="https://attacker.example/">`). Consumers
   * MUST NOT re-fetch this URL without going through `fetchWithTimeout`
   * (SSRF-revalidated). Null if absent or unparseable.
   */
  readonly canonical: string | null;
  /** Number of `<h1>` elements on the page. */
  readonly h1Count: number;
  /**
   * Ordered sequence of heading tag names encountered on the page
   * (e.g. `["h1", "h2", "h3", "h2"]`). Extracted by page-fetcher.ts via
   * cheerio `$('h1,h2,h3,h4,h5,h6').each(...)`, capped at 100 entries per
   * page (defensive against malicious-deep DOMs). Used by HEADING.STRUCTURE
   * rule (chunk 2d) for h1→h2→h3 ordering and level-skip detection.
   *
   * Empty array when no headings are present or the page errored.
   */
  readonly headingOutline: readonly string[];
  /**
   * Same-site `<a href>` URLs resolved against `finalUrl`, Plan §D-5
   * normalized (strip fragment + sort query params), deduped, capped at
   * OUTLINKS_FOR_DETECTION=50. "Same-site" strips leading `www.` from both
   * sides and is port-agnostic (see `_url-helpers.ts isSameSite`).
   */
  readonly internalOutlinks: readonly string[];
  /** `$('body').text().length` — whitespace as returned by cheerio. */
  readonly rawTextLength: number;
  /** Null on success; short error code string on failure (see union above). */
  readonly error: string | null;
  /**
   * Number of HTTP redirect hops followed before reaching the final response.
   * Populated from `FetchResult.hops` (chunk 2c). 0 for direct responses.
   * Consumed by `URL.REDIRECT_CHAINS` detection rule to flag chains >1 hop.
   */
  readonly redirectHops: number;
  /**
   * Parsed JSON-LD structured-data blocks (A10 SD.* rules). EMPTY array when the
   * page has no `<script type="application/ld+json">`. OPTIONAL (`?`) — absent on
   * error PageRecords and on legacy fixtures; the SD.* rules treat absent / empty
   * as "no structured data" (the JSONLD_PARSE rule abstains na when the WHOLE site
   * has none, never fabricating a parse-failure). See `StructuredDataBlock`.
   */
  readonly structuredData?: readonly StructuredDataBlock[] | null;
  /**
   * GA4 / GTM analytics tag ids scanned from `<script>` tags (A1
   * DATA.GA4_DETECTED + 3 A13 MEASURE.* rules). OPTIONAL (`?`) — absent on error
   * PageRecords and legacy fixtures; the rules treat absent as no-signal. On a
   * successfully parsed page this is always present with deduped (possibly empty)
   * id arrays. Front-end presence only — see `AnalyticsTags`.
   */
  readonly analyticsTags?: AnalyticsTags | null;
  /**
   * Open Graph + Twitter Card meta-tag presence (A9 SOCIAL.OG / SOCIAL.TWITTER
   * rules). OPTIONAL (`?`) — absent on error PageRecords and legacy fixtures; the
   * rules treat absent as no-signal (excluded from the denominator, never a
   * fabricated fail). On a successfully parsed page this is always present.
   * Front-end markup presence only — see `SocialMeta`.
   */
  readonly socialMeta?: SocialMeta | null;
  /**
   * Trimmed `<html lang>` attribute value (A9 LANG.HTML_LANG rule). `null` when
   * the attribute is absent OR present-but-empty/whitespace (present-but-empty is
   * no more useful than missing). OPTIONAL (`?`) — `undefined` on error
   * PageRecords / legacy fixtures (not scanned); the rule treats `undefined` as
   * no-signal (excluded from the denominator) and `null` as "scanned, lang
   * missing" (counted against coverage). Never fabricated.
   */
  readonly htmlLang?: string | null;
  /**
   * Tri-state noindex provenance for SV1.5 indexability:
   * - true  = scanned, has noindex (HTML `<meta robots|googlebot>` noindex/none
   *           OR X-Robots-Tag header noindex — page-fetcher ORs both signals)
   * - false = crawled + FULLY scanned with NO noindex (indexable-eligible)
   * - undefined = not fully scanned (truncated body / read|parse error / legacy
   *           fixture) → unknown. Do NOT collapse undefined to false.
   * Produced by `extractRobotsMeta` + `xRobotsTagNoindex` (`page-extractors.ts`).
   * Mapped by `url-inventory-builder.ts` to tri-state `meta_robots`
   * (`'noindex' | 'index' | null`); consumed by `load-crawl-snapshot.ts`
   * `deriveIndexable` (requires the positive `'index'` signal).
   */
  readonly robotsNoindex?: boolean;
}
