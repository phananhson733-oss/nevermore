// @input  -- authorized Search Console rows plus the pages this crawl collected
// @output -- evidence records for the search-performance checks (E1, E2, E3)
// @pos    -- pure projection; owns no credential, makes no request
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { subjectUrlOf } from "@sf/sources/canonical-url";

import type {
  SeoAuditEvidenceValueEntry,
  SeoAuditObservation,
  SeoAuditPage,
  SeoAuditRecord,
} from "./types.ts";

/**
 * One Search Analytics row, reduced to what these checks read.
 *
 * `key` is the single requested dimension's value: a page URL for the page
 * query, the query text for the query one. The two are never mixed, because
 * impressions on a `[page, query]` breakdown do not sum to the site total and
 * every share here is a share of that total.
 */
export interface SearchPerformanceRow {
  readonly key: string;
  readonly clicks: number;
  readonly impressions: number;
  /** Impression-weighted average position, as the API reports it. */
  readonly position: number;
}

export interface SearchPerformanceRaw {
  /** `sc-domain:example.com` or the exact verified URL prefix. */
  readonly property: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly pages: readonly SearchPerformanceRow[];
  readonly queries: readonly SearchPerformanceRow[];
  /**
   * Whether a row cap cut each list short, tracked separately.
   *
   * A truncated list is not a smaller sample of the same thing. Rows come back
   * ordered by clicks, so what a cap drops is the long tail: many impressions,
   * few clicks, mostly ranked past the tenth result. Dividing by that shortened
   * total inflates every band share, which reports a site as performing better
   * than it does — so a truncated list publishes no share at all rather than a
   * flattering one.
   */
  readonly pagesTruncated: boolean;
  readonly queriesTruncated: boolean;
}

/** Highest average position still counted in the top band. */
const TOP_BAND_MAX = 6;
/** Highest average position still counted in the low-click band. */
const LOW_CLICK_BAND_MAX = 10;

function values(
  entries: Readonly<Record<string, string | number | boolean | null>>,
): readonly SeoAuditEvidenceValueEntry[] {
  return Object.entries(entries).map(([label, value]) => ({ label, value }));
}

/**
 * Which band an average position falls in.
 *
 * The API reports one impression-weighted average per row, so a query that sits
 * at 3 for half its impressions and 20 for the rest reports about 11 and counts
 * in neither band. Rounding is the closest honest reading of a single average:
 * a row at 6.4 was shown at position 6 more often than at 7.
 */
function band(position: number): number | null {
  if (!Number.isFinite(position) || position < 1) return null;
  return Math.round(position);
}

function impressionShareInBand(
  rows: readonly SearchPerformanceRow[],
  lowest: number,
  highest: number,
): { share: number; impressions: number; total: number } | null {
  let total = 0;
  let inBand = 0;
  for (const row of rows) {
    if (row.impressions <= 0) continue;
    total += row.impressions;
    const rank = band(row.position);
    if (rank !== null && rank >= lowest && rank <= highest) {
      inBand += row.impressions;
    }
  }
  // No impressions at all is not a zero share, it is nothing to divide by. The
  // aggregate rules read a missing value as unmeasured, never as a pass.
  if (total === 0) return null;
  return { share: inBand / total, impressions: inBand, total };
}

function bandRecord(
  id: string,
  raw: SearchPerformanceRaw,
  lowest: number,
  highest: number,
  shareLabel: string,
): SeoAuditRecord {
  const measured = raw.queriesTruncated
    ? null
    : impressionShareInBand(raw.queries, lowest, highest);
  const observations: readonly SeoAuditObservation[] =
    measured === null
      ? []
      : [
          {
            url: null,
            values: values({
              [shareLabel]: Number(measured.share.toFixed(4)),
              impressions_in_band: measured.impressions,
              impressions_total: measured.total,
              queries_measured: raw.queries.filter((row) => row.impressions > 0)
                .length,
            // Named so the reader can see whose numbers these are. A domain
            // property covers every subdomain, so its rows are the property's
            // performance, not only the audited origin's.
            property: raw.property,
            }),
          },
        ];
  return {
    id,
    category: "search_performance",
    state: measured === null ? "unverified" : "observed",
    unit: "pages",
    population: "conditional_subset",
    tested: measured === null ? 0 : 1,
    affected: observations.length,
    observations,
    // Two limits, always both true. Search Console withholds low-volume and
    // anonymised queries, so the rows it returns are not every impression the
    // site received and this share is of the reported ones. And a row's
    // position is one impression-weighted average, so a query shown at 3 for
    // half its impressions and 20 for the rest reports about 11 and counts in
    // neither band.
    limitation: raw.queriesTruncated
      ? "query_rows_hit_the_row_cap_so_the_reported_total_is_short"
      : "share_of_reported_queries_only_banded_by_one_average_position_each",
  };
}

/**
 * Pages the crawl collected that Search Console never showed in a result.
 *
 * Modelled as affected pages rather than as a bare share so the reader gets the
 * list, not just the number. Zero-impression rows are dropped first: the API
 * returns them, and treating a row's presence as coverage would report a page
 * nobody ever saw as a page that performs.
 */
function coverageRecord(
  raw: SearchPerformanceRaw,
  pages: readonly SeoAuditPage[],
): SeoAuditRecord {
  const withImpressions = new Set(
    raw.pages
      .filter((row) => row.impressions > 0)
      .map((row) => subjectUrlOf(row.key))
      .filter((subject): subject is string => subject !== null),
  );
  const uncovered = pages.filter(
    (page) => !withImpressions.has(page.subjectUrl),
  );
  // A capped page list is missing rows for pages that do have impressions, and
  // every one of those would be reported here as a page nobody ever saw.
  const measurable = pages.length > 0 && !raw.pagesTruncated;

  return {
    id: "page_without_search_impressions",
    category: "search_performance",
    state: measurable ? "observed" : "unverified",
    unit: "pages",
    population: "every_collected_page",
    tested: measurable ? pages.length : 0,
    affected: measurable ? uncovered.length : 0,
    observations: (measurable ? uncovered : []).map((page) => ({
      url: page.url,
      values: values({
        impressions: 0,
        sitemap_member: page.sitemapMember,
        observed_inbound_links: page.inboundLinks,
      }),
    })),
    limitation: raw.pagesTruncated
      ? "page_rows_hit_the_row_cap_so_a_page_with_impressions_may_be_missing"
      : "search_console_window_may_predate_a_recently_published_page",
  };
}

/**
 * Records for the checks that need an authorized Search Console property.
 *
 * Returns nothing at all when no grant covered this run, so the checks stay
 * excluded with their own reason rather than passing on an empty measurement.
 */
export function buildSearchPerformanceRecords(
  raw: SearchPerformanceRaw | null | undefined,
  htmlPages: readonly SeoAuditPage[],
): readonly SeoAuditRecord[] {
  if (!raw) return [];
  return [
    coverageRecord(raw, htmlPages),
    bandRecord(
      "impression_share_top_positions",
      raw,
      1,
      TOP_BAND_MAX,
      "top_position_impression_share",
    ),
    bandRecord(
      "impression_share_low_click_positions",
      raw,
      TOP_BAND_MAX + 1,
      LOW_CLICK_BAND_MAX,
      "low_click_position_impression_share",
    ),
  ];
}

/**
 * Observation labels these records publish.
 *
 * Declared for the same reason as the crawl ledger's: the UI fails closed on a
 * label it cannot name, and it does so by blanking the panel rather than
 * showing an odd row.
 */
export const SEARCH_PERFORMANCE_EVIDENCE_LABELS: readonly string[] = [
  "impressions",
  "sitemap_member",
  "observed_inbound_links",
  "top_position_impression_share",
  "low_click_position_impression_share",
  "impressions_in_band",
  "impressions_total",
  "queries_measured",
  "property",
];

/** Record ids this module emits, in the order it emits them. */
export const SEARCH_PERFORMANCE_RECORD_IDS: readonly string[] = [
  "page_without_search_impressions",
  "impression_share_top_positions",
  "impression_share_low_click_positions",
];
