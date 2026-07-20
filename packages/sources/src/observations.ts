/**
 * The normalized-observation vocabulary (spec §7.6, §7.7) — the contract seam
 * between the WP2 source adapters (producers) and the WP3 diagnostic rules
 * (consumers). Every adapter emits `NormalizedObservation`s whose `metricKey`
 * and `valueJson` shape are fixed here, so a rule can consume any provider's
 * output without knowing adapter internals.
 *
 * Each observation carries EXACTLY ONE value when `availability === "available"`
 * and ALL-null values otherwise (spec §7.6, AC-017). The `valueJson` projections
 * below are the "one value" for structured providers; `unavailable` numeric
 * facts are still `null`, never 0.
 */

import type {
  Availability,
  Grade,
  NormalizedObservation,
  ObservationOrigin,
  ObservationSubjectType,
} from "./adapter.ts";

// ---------------------------------------------------------------------------
// Metric keys (versioned; a shape change bumps the suffix).
// ---------------------------------------------------------------------------
export const METRIC_CRAWL_PAGE = "crawl.page.v1";
export const METRIC_CRAWL_ROBOTS = "crawl.robots.v1";
export const METRIC_CRAWL_SITEMAP = "crawl.sitemap.v1";
export const METRIC_GSC_PAGE = "gsc.page.v1";
export const METRIC_GA4_LANDING = "ga4.landing.v1";
export const METRIC_CSV_KEYWORD_GAP = "csv.keyword_gap.v1";

// ---------------------------------------------------------------------------
// Crawl projections (produced by the crawl adapter's normalize()).
// ---------------------------------------------------------------------------

/** One HTML link discovered on a page (already same-origin filtered upstream). */
export interface CrawlLinkProjection {
  /** subjectUrl (canonical_url.v1) of the link target. */
  readonly targetSubjectUrl: string;
  readonly rel: string | null;
  readonly anchorText: string | null;
}

/** JSON-LD block outcome for a page. */
export interface CrawlJsonLdProjection {
  readonly types: readonly string[];
  readonly errorCount: number;
}

/** Per-page crawl fact projection (metricKey `crawl.page.v1`, subjectType url). */
export interface CrawlPageProjection {
  readonly fetchUrl: string;
  readonly status: number | null;
  readonly finalStatus: number | null;
  readonly redirectChain: readonly string[];
  readonly canonicalTarget: string | null;
  readonly robotsIndexable: boolean;
  readonly robotsDirectives: readonly string[];
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly h1: readonly string[];
  readonly headings: readonly string[];
  readonly wordCount: number | null;
  readonly internalOutlinks: readonly CrawlLinkProjection[];
  readonly jsonLd: CrawlJsonLdProjection;
  readonly sitemapMember: boolean;
  readonly bodyExcerpt: string | null;
  readonly paragraphs: readonly string[];
  readonly responseMs: number | null;
  readonly contentType: string | null;
}

/** Site-level robots.txt projection (metricKey `crawl.robots.v1`, subjectType site). */
export interface CrawlRobotsProjection {
  readonly fetched: boolean;
  /** For each user-agent group: the disallow rules the crawler observed. */
  readonly groups: readonly {
    readonly userAgent: string;
    readonly disallow: readonly string[];
    readonly allow: readonly string[];
  }[];
  readonly sitemaps: readonly string[];
}

/** Site-level sitemap membership projection (metricKey `crawl.sitemap.v1`). */
export interface CrawlSitemapProjection {
  readonly fetched: boolean;
  readonly urlCount: number;
  readonly subjectUrls: readonly string[];
}

// ---------------------------------------------------------------------------
// GSC / GA4 / CSV projections.
// ---------------------------------------------------------------------------

export interface GscWindowMetrics {
  readonly clicks: number;
  readonly impressions: number;
  /** Impression-weighted average position over the window. */
  readonly position: number | null;
}

export interface GscTopQuery {
  readonly query: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number | null;
}

/** Per-page GSC projection (metricKey `gsc.page.v1`, subjectType url). */
export interface GscPageProjection {
  readonly current28d: GscWindowMetrics;
  readonly previous28d: GscWindowMetrics;
  readonly topQueries: readonly GscTopQuery[];
}

/** Per-landing-page GA4 projection (metricKey `ga4.landing.v1`, subjectType url). */
export interface Ga4LandingProjection {
  readonly sessions: number;
  readonly engagedSessions: number | null;
  readonly engagementRate: number | null;
  /** null when key events are unmapped/incompatible (spec §7.4); never 0. */
  readonly keyEvents: number | null;
  readonly keyEventUnavailableReason: string | null;
}

/** Per-keyword CSV projection (metricKey `csv.keyword_gap.v1`, subjectType keyword_cluster). */
export interface CsvKeywordProjection {
  readonly keyword: string;
  readonly clusterKey: string;
  /** null when the source cell was empty (spec §7.5); never 0. */
  readonly searchVolume: number | null;
  readonly currentUrl: string | null;
  readonly currentRank: number | null;
  readonly competitorDomain: string | null;
  readonly competitorRank: number | null;
  readonly marketCode: string;
  readonly languageCode: string;
}

// ---------------------------------------------------------------------------
// Evidence-axis mapping (spec §7.7). Adapters build observations through these
// helpers so origin/grade are never hand-set inconsistently.
// ---------------------------------------------------------------------------

interface AxisSpec {
  readonly origin: ObservationOrigin;
  readonly grade: Grade;
}

const PROVIDER_AXES = {
  gsc: { origin: "first_party", grade: "A" },
  ga4: { origin: "first_party", grade: "A" },
  crawl: { origin: "direct_public", grade: "B" },
  dataforseo: { origin: "vendor_observation", grade: "B" },
  csv: { origin: "user_provided", grade: "C" },
} as const satisfies Record<string, AxisSpec>;

export type ObservationProvider = keyof typeof PROVIDER_AXES;

interface BuildObservationInput {
  readonly provider: ObservationProvider;
  readonly metricKey: string;
  readonly subjectType: ObservationSubjectType;
  readonly subjectRef: string;
  readonly observedAt: string;
  readonly availability: Availability;
  readonly value: {
    readonly numeric?: number | null;
    readonly text?: string | null;
    readonly json?: unknown;
  };
  readonly unit?: string | null;
  readonly limitation: string;
}

/**
 * Build a canonical `NormalizedObservation` with the correct evidence axes for
 * its provider (spec §7.7). When availability is not "available", ALL values are
 * forced to null regardless of what the caller passed (spec §7.6, AC-017).
 */
export function buildObservation(input: BuildObservationInput): NormalizedObservation {
  const axes = PROVIDER_AXES[input.provider];
  const available = input.availability === "available";
  return {
    metricKey: input.metricKey,
    subjectType: input.subjectType,
    subjectRef: input.subjectRef,
    observedAt: input.observedAt,
    availability: input.availability,
    valueNumeric: available ? input.value.numeric ?? null : null,
    valueText: available ? input.value.text ?? null : null,
    valueJson: available ? input.value.json ?? null : null,
    unit: input.unit ?? null,
    origin: axes.origin,
    grade: axes.grade,
    support: "supports",
    limitation: input.limitation,
  };
}
