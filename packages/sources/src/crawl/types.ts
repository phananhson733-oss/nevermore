/**
 * Crawl adapter types (spec §7.3). The crawl ENGINE (`engine.ts`) performs the
 * SSRF-safe BFS fetch and produces a `CrawlRaw` site graph; the crawl ADAPTER
 * (`adapter.ts`) wraps it into the `SourceAdapter` contract and maps records to
 * canonical observations. Splitting the two keeps the fetch mechanics (heavy,
 * vendor-copied) independent of the observation vocabulary (contract-owned).
 */

import type { Availability, SourceWindow } from "../adapter.ts";
import type {
  CrawlPageProjection,
  CrawlRobotsProjection,
  CrawlSitemapProjection,
} from "../observations.ts";

export const CRAWL_DATASET_KEY = "crawl.site_graph.v1";
// v2 retains every exact initial fetch identity in CrawlRaw/PageSnapshot,
// exact canonical hrefs, and journey-correct first/final status semantics; v1
// collapsed slash variants that shared one aggregation subject.
export const CRAWL_METHOD_VERSION = "crawl.site_graph.v2";

/** Defense-in-depth run cap from spec §14.2; counts fetch-decoded body bytes. */
export const CRAWL_MAX_TOTAL_DECODED_BYTES = 128 * 1024 * 1024;

/** Frozen spec §7.1 upper bound for one crawl queue delivery. */
export const CRAWL_JOB_WALL_CLOCK_CAP_MS = 15 * 60 * 1_000;

/**
 * Time kept outside the crawl engine for raw upload, snapshot/observation
 * persistence, and the canonical terminal transition before pg-boss expiry.
 */
export const CRAWL_FINALIZATION_HEADROOM_MS = 60 * 1_000;

/** Effective provider-work budget inside the frozen fifteen-minute job cap. */
export const CRAWL_ENGINE_WALL_CLOCK_BUDGET_MS =
  CRAWL_JOB_WALL_CLOCK_CAP_MS - CRAWL_FINALIZATION_HEADROOM_MS;

/**
 * Bound a projected string by CODE POINT, never by UTF-16 code unit.
 *
 * Every string bounded here came off a real web page, so a title or anchor
 * ending in an emoji is ordinary rather than adversarial. `slice` counts code
 * units, so a cut at a fixed count can land between the two halves of one
 * character; `JSON.stringify` then emits the orphaned surrogate as `"\ud83d"`
 * and PostgreSQL's `jsonb` REFUSES the value, so a completed crawl dies on the
 * write that stores its projection. Splitting on code points makes every bound
 * storable by construction.
 */
export function boundChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const points = [...value];
  if (points.length <= maxChars) return value;
  return points.slice(0, Math.max(0, maxChars)).join("");
}

/**
 * Fixed persisted-projection bounds. These are deliberately not operator
 * tunable: a hostile but per-response-valid page must not amplify into an
 * unbounded snapshot/observation JSON value.
 */
export const CRAWL_PROJECTION_LIMITS = {
  maxUrlChars: 2_048,
  maxTitleChars: 512,
  maxMetaDescriptionChars: 2_048,
  maxRobotsDirectives: 32,
  maxRobotsDirectiveChars: 128,
  maxH1: 20,
  maxH1Chars: 512,
  maxHeadings: 100,
  maxHeadingChars: 512,
  maxParagraphs: 50,
  maxParagraphChars: 1_000,
  maxBodyExcerptChars: 500,
  maxInternalOutlinks: 500,
  maxAnchorTextChars: 512,
  maxRelChars: 256,
  maxJsonLdTypes: 100,
  maxJsonLdTypeChars: 256,
  maxJsonLdBlocks: 100,
  maxJsonLdNodes: 5_000,
  maxContentTypeChars: 256,
  maxRobotsGroups: 64,
  maxRobotsRulesPerGroup: 128,
  maxRobotsRuleChars: 512,
  maxUserAgentChars: 256,
  maxSitemaps: 50,
  maxSitemapUrls: 2_000,
  maxImages: 300,
  maxHeadingLevels: 100,
} as const;

/** Crawl budget knobs (spec §7.2, §7.3). Overridable only for tests/fixtures. */
export interface CrawlBudget {
  readonly maxUrls: number;
  readonly maxDepth: number;
  readonly maxWallClockMs: number;
  readonly maxRedirects: number;
  readonly maxBodyBytes: number;
  readonly maxTotalBytes: number;
  readonly perHostConcurrency: number;
  readonly minHostDelayMs: number;
}

/** Fixed MVP budgets (spec §7.2, §7.3). Not operator-tunable in production. */
export const CRAWL_BUDGET: CrawlBudget = {
  maxUrls: 2000,
  maxDepth: 6,
  maxWallClockMs: CRAWL_ENGINE_WALL_CLOCK_BUDGET_MS,
  maxRedirects: 5,
  maxBodyBytes: 5 * 1024 * 1024,
  maxTotalBytes: CRAWL_MAX_TOTAL_DECODED_BYTES,
  perHostConcurrency: 5,
  minHostDelayMs: 250,
};

/** Validated crawl connection config (the default public crawl source has none). */
export interface CrawlConfig {
  readonly userAgent: string;
}

/** Parameters for one crawl collection. */
export interface CrawlParams {
  readonly origin: string;
  readonly host: string;
  /**
   * Optional exact product/page transport seed. The engine admits only an
   * absolute, credential-free, fragment-free URL on `origin`; invalid values
   * are ignored before guard or transport.
   */
  readonly seedUrl?: string | null;
}

/**
 * One exact crawl journey. `subjectUrl` is the initial request URL's
 * canonical_url.v1 aggregation key and may therefore repeat across records.
 * `projection.fetchUrl` is the exact initial HTTP identity retained for
 * Evidence/PageSnapshot lineage; projection status/finalStatus describe that
 * journey's initial/terminal responses and redirectChain retains its targets.
 */
/**
 * What one `<img>` contributes to the image checks.
 *
 * `src` is kept verbatim rather than resolved: the only thing read from it is
 * the file extension, and resolving it against the page would turn a broken or
 * templated reference into a URL that looks measured.
 */
export interface CrawlImageObservation {
  readonly src: string | null;
  /** Whether an alt attribute was present at all, empty or not. */
  readonly hasAltAttribute: boolean;
  /** Whether that attribute carried text. An empty alt is a deliberate mark. */
  readonly altHasText: boolean;
}

/**
 * Page facts the audit reads that `crawl.page.v1` does not carry.
 *
 * Deliberately on the record and not on the projection. The projection is a
 * persisted, versioned contract read back by a `.strict()` Zod schema in the
 * product app, so one added field would fail validation on every row already
 * stored. These live beside it, in memory, for the length of one run — the same
 * place `htmlLanguage` and the frontier targets already live.
 */
export interface CrawlPageAssets {
  readonly images: readonly CrawlImageObservation[];
  /** True count, so a page past `maxImages` still reports its real total. */
  readonly imageCount: number;
  readonly openGraph: {
    readonly title: boolean;
    readonly description: boolean;
    readonly image: boolean;
  };
  /**
   * Heading levels in document order, collected independently of the text
   * filter and of the closing-tag requirement the text collector applies.
   * An icon-only `<h2>` still occupies a level, and dropping it would
   * fabricate a skip that the document does not contain.
   */
  readonly headingLevels: readonly number[];
  /** Normalised body text, for measures the frozen `wordCount` cannot express. */
  readonly bodyText: string | null;
}

export interface CrawlPageRecord {
  readonly subjectUrl: string;
  readonly depth: number;
  readonly projection: CrawlPageProjection;
  /** Absent for a record built before this existed, or by a fixture. */
  readonly assets?: CrawlPageAssets;
}

/**
 * The raw crawl site graph (the `R` in `CollectionResult<R>`). Persisted to
 * Storage verbatim (as the snapshot raw object) and mapped to observations.
 */
export interface CrawlRaw {
  readonly origin: string;
  readonly host: string;
  readonly pages: readonly CrawlPageRecord[];
  readonly robots: CrawlRobotsProjection;
  readonly sitemap: CrawlSitemapProjection;
  /** Overall availability: `partial` when a budget cut the crawl short. */
  readonly availability: Availability;
  readonly capturedAt: string;
  readonly sourceWindow: SourceWindow;
  readonly stopReason: string | null;
  readonly providerUsage: Record<string, number>;
  readonly limitation: string;
}

/** The engine's injectable fetch surface, so tests can drive fixtures offline. */
export interface CrawlFetcher {
  fetch(url: string, init: { readonly signal: AbortSignal }): Promise<Response>;
}
