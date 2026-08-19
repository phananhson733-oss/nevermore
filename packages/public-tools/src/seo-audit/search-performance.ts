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
  /**
   * Rows for the target page alone, one per query, or null when not read.
   *
   * A separate request narrowed to that one URL. The site-wide query list
   * cannot answer this: its position for "natal chart" is the property's
   * average across every page that ranked for it, and attributing that to the
   * page the visitor submitted would report someone else's ranking as theirs.
   *
   * Null means the read was not attempted — no confirmed query to look up, or
   * no URL to filter on. Empty means it ran and Search Console reported nothing
   * for that page, which is a measurement, not a missing one.
   */
  readonly targetPageQueries: readonly SearchPerformanceRow[] | null;
  /** The URL those rows were filtered to, echoed so the record can name it. */
  readonly targetPageUrl: string | null;
  /** Queries the visitor confirmed, normalised the way the match compares them. */
  readonly confirmedQueries: readonly string[];
  readonly targetPageQueriesTruncated: boolean;
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
    // Property-level numbers; whether the named page sat in this
    // population is answered by the coverage record, not by each share.
    targetTested: null,
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
    // Property-level numbers; whether the named page sat in this
    // population is answered by the coverage record, not by each share.
    targetTested: null,
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
 * How this compares a confirmed query to a Search Console one.
 *
 * Search Console lower-cases and collapses whitespace in the queries it
 * reports, so comparing the visitor's typed form directly would miss a match on
 * capitalisation alone and report a ranking page as never shown.
 */
function comparableQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The band the target page currently sits in for the queries it was submitted
 * for (9.5).
 *
 * The number judged is the impression-weighted average across the matched
 * queries — the same weighting Search Console applies inside a single row, so
 * a query the page is barely shown for cannot drag the reported band. Best and
 * worst are published beside it because one average over five queries hides
 * the case worth acting on: four at 3 and one at 40.
 *
 * Emitted on every authorized run. Every way it cannot be measured is
 * `unverified` with the reason named, never a zero and never an omission: a
 * missing record would read to the display contract as a producer that broke,
 * and a zero would read to the rule as position one.
 */
function targetQueryBandRecord(raw: SearchPerformanceRaw): SeoAuditRecord {
  const unmeasured = (limitation: string): SeoAuditRecord => ({
    id: "target_query_ranking_band",
    category: "search_performance",
    state: "unverified",
    unit: "pages",
    population: "conditional_subset",
    // Property-level numbers; whether the named page sat in this
    // population is answered by the coverage record, not by each share.
    targetTested: null,
    tested: 0,
    affected: 0,
    observations: [],
    limitation,
  });

  if (raw.confirmedQueries.length === 0) {
    return unmeasured(
      "no_target_query_was_confirmed_for_this_page_so_there_is_no_band_to_report",
    );
  }
  if (raw.targetPageUrl === null || raw.targetPageQueries === null) {
    return unmeasured(
      "the_submitted_page_was_not_collected_so_no_per_page_query_rows_were_requested",
    );
  }
  if (raw.targetPageQueriesTruncated) {
    return unmeasured(
      "target_page_query_rows_hit_the_row_cap_so_a_confirmed_query_may_be_missing",
    );
  }

  const wanted = new Set(raw.confirmedQueries.map(comparableQuery));
  const matched = raw.targetPageQueries.filter(
    (row) => wanted.has(comparableQuery(row.key)) && row.impressions > 0,
  );
  if (matched.length === 0) {
    // Not a bad band. Search Console recorded no impression for these queries
    // on this URL in the window, so there is no position to band — and calling
    // that "position 0" would report the best possible ranking.
    return unmeasured(
      "search_console_reported_no_impressions_for_the_confirmed_queries_on_this_url",
    );
  }

  let impressions = 0;
  let clicks = 0;
  let weighted = 0;
  let best = matched[0]!;
  let worst = matched[0]!;
  for (const row of matched) {
    impressions += row.impressions;
    clicks += row.clicks;
    weighted += row.position * row.impressions;
    if (row.position < best.position) best = row;
    if (row.position > worst.position) worst = row;
  }

  const average = weighted / impressions;
  const rounded = band(average);
  if (rounded === null) {
    // Reachable only from a row Search Console should not send — impressions
    // above zero at a position below one. Publishing `0` here would read to the
    // rule as better than position one, so the shape it cannot band is stated
    // as unmeasured instead.
    return unmeasured(
      "search_console_returned_a_position_this_run_cannot_band_for_this_url",
    );
  }

  return {
    id: "target_query_ranking_band",
    category: "search_performance",
    state: "observed",
    unit: "pages",
    population: "conditional_subset",
    // Property-level numbers; whether the named page sat in this
    // population is answered by the coverage record, not by each share.
    targetTested: null,
    tested: 1,
    // One affected observation, which is what makes the rule run at all:
    // `issueSeverity` reads `affected === 0` as a clean pass before it ever
    // reaches an aggregate rule.
    affected: 1,
    observations: [
      {
        url: raw.targetPageUrl,
        values: values({
          // Two numbers on purpose. The band is what the published threshold
          // is written in — "1-6 / 7-10 / 11+" are discrete positions — and it
          // is rounded the same way E2 and E3 round, so two checks reading the
          // same Search Console statistic cannot put one page in two bands.
          // The average is kept beside it because 6.4 and 6.0 are the same
          // band and very different situations, and only one of them is one
          // slot from the top.
          query_position_band: rounded,
          query_average_position: Number(average.toFixed(2)),
          best_query_average_position: Number(best.position.toFixed(2)),
          best_query: best.key,
          worst_query_average_position: Number(worst.position.toFixed(2)),
          worst_query: worst.key,
          queries_measured: matched.length,
          queries_confirmed: raw.confirmedQueries.length,
          impressions_total: impressions,
          clicks_total: clicks,
          property: raw.property,
        }),
      },
    ],
    limitation:
      matched.length < raw.confirmedQueries.length
        ? "some_confirmed_queries_had_no_impressions_on_this_url_and_are_not_in_this_average"
        : "one_impression_weighted_average_per_query_over_the_reported_window_only",
  };
}

/**
 * Share of clicks that did not come from the site's own name (E4).
 *
 * Published, never judged: the check's own threshold says a healthy split
 * depends on brand maturity and asks the reader to look at the trend, not the
 * level. The brand terms are derived from the property rather than typed in by
 * the visitor — a tool that needs an answer before it can say anything is the
 * empty form this whole layer exists to remove.
 *
 * A query merely CONTAINING the brand counts as brand: "acme pricing" is
 * someone who already knows the name.
 */
function nonBrandClickShareRecord(
  raw: SearchPerformanceRaw,
  brandTerms: readonly string[],
): SeoAuditRecord {
  const terms = brandTerms
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 3);
  const measurable = !raw.queriesTruncated && terms.length > 0;
  let brandClicks = 0;
  let totalClicks = 0;
  if (measurable) {
    for (const row of raw.queries) {
      if (row.clicks <= 0) continue;
      totalClicks += row.clicks;
      const query = row.key.toLowerCase();
      if (terms.some((term) => query.includes(term))) brandClicks += row.clicks;
    }
  }
  if (!measurable || totalClicks === 0) {
    return {
      id: "non_brand_click_share",
      category: "search_performance",
      state: "unverified",
      unit: "pages",
      population: "conditional_subset",
      targetTested: null,
      tested: 0,
      affected: 0,
      observations: [],
      limitation: raw.queriesTruncated
        ? "query_rows_hit_the_row_cap_so_the_reported_total_is_short"
        : "no_clicks_were_reported_in_the_window_so_there_is_no_split_to_publish",
    };
  }
  return {
    id: "non_brand_click_share",
    category: "search_performance",
    state: "observed",
    unit: "pages",
    population: "conditional_subset",
    targetTested: null,
    tested: 1,
    affected: 1,
    observations: [
      {
        url: null,
        values: values({
          non_brand_click_share: Number(
            ((totalClicks - brandClicks) / totalClicks).toFixed(4),
          ),
          brand_clicks: brandClicks,
          clicks_total: totalClicks,
          brand_terms_used: terms.join(" "),
          property: raw.property,
        }),
      },
    ],
    limitation:
      "brand_terms_derived_from_the_property_and_matched_as_substrings",
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
  /** Derived from the property by the caller; never typed in by the visitor. */
  brandTerms: readonly string[] = [],
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
    targetQueryBandRecord(raw),
    nonBrandClickShareRecord(raw, brandTerms),
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
  "query_position_band",
  "query_average_position",
  "best_query_average_position",
  "best_query",
  "worst_query_average_position",
  "worst_query",
  "queries_confirmed",
  "clicks_total",
  "non_brand_click_share",
  "brand_clicks",
  "brand_terms_used",
];

/** Record ids this module emits, in the order it emits them. */
export const SEARCH_PERFORMANCE_RECORD_IDS: readonly string[] = [
  "page_without_search_impressions",
  "impression_share_top_positions",
  "impression_share_low_click_positions",
  "target_query_ranking_band",
  "non_brand_click_share",
];
