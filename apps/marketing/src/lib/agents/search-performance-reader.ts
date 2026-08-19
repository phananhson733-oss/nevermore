// @input  -- a granted Search Console property and this request's access token
// @output -- the page and query rows the search-performance checks read, or null
// @pos    -- the only place the Agent audit touches Search Console
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createSearchAnalyticsClient } from "@sf/sources";
import type { SearchPerformanceRaw } from "@sf/public-tools/seo-audit/search-performance";

/** Matches the other Search Console tools, so one grant reads one window. */
const WINDOW_DAYS = 28;
/**
 * Search Console keeps revising the last few days. Ending the window short of
 * today reads finalised numbers instead of ones that move under the reader.
 */
const FINALISATION_LAG_DAYS = 3;
/**
 * Rows per dimension, one request each.
 *
 * Not a sample size — a cap. Hitting it means the checks that read that list
 * publish nothing, because a shortened list biases every share it feeds in the
 * flattering direction. Five thousand covers the sites this tool crawls (its
 * own crawl stops near a thousand pages) while keeping one audit to two
 * bounded requests.
 */
const ROW_LIMIT = 5_000;
/** An audit must not wait on Search Console; it degrades to the gated state. */
const READ_TIMEOUT_MS = 12_000;

/**
 * Today's Search Console reporting day.
 *
 * Search Console closes its days in Pacific time, not UTC. Taking the UTC
 * calendar date meant that between UTC midnight and Pacific midnight the window
 * ran a day ahead of what the API considers finalised — the exact data this lag
 * exists to avoid — and daylight saving moved the error twice a year.
 */
function reportingDay(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Calendar arithmetic on a reporting day, which has no time zone of its own. */
function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export interface SearchPerformanceReadInput {
  /** `sc-domain:acme.com` or the exact verified URL prefix, never a site URL. */
  readonly property: string;
  /** From this request's grant resolution; never captured at module scope. */
  readonly accessToken: string;
  /**
   * The collected page the band question is about, or null when there is none.
   *
   * Must be the URL the crawl actually landed on, not the submitted one:
   * Search Console keys rows by the final URL, so filtering on a form that
   * redirected returns nothing and reads as "never shown".
   */
  readonly targetPageUrl: string | null;
  /** Queries the visitor confirmed for that page; empty skips the third read. */
  readonly targetQueries: readonly string[];
}

/**
 * Rows for one page, one per query.
 *
 * A page rarely has thousands of distinct queries, and unlike the site lists
 * this one is not a denominator — hitting the cap means a confirmed query might
 * be missing, which the record reports rather than averages around.
 */
const TARGET_PAGE_ROW_LIMIT = 1_000;

export function createSearchPerformanceReader(options: {
  readonly now?: () => Date;
  /** Offline test seam, handed to the Search Console client. */
  readonly fetchImpl?: typeof fetch;
}): (input: SearchPerformanceReadInput) => Promise<SearchPerformanceRaw> {
  const now = options.now ?? (() => new Date());

  return async ({ property, accessToken, targetPageUrl, targetQueries }) => {
    const client = createSearchAnalyticsClient({
      // The client's field is named `siteUrl` because that is what Google calls
      // the path segment; what it wants there is the property identifier.
      siteUrl: property,
      accessToken,
      requestTimeoutMs: READ_TIMEOUT_MS,
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
    });

    const endDate = shiftDay(reportingDay(now()), -FINALISATION_LAG_DAYS);
    const window = {
      startDate: shiftDay(endDate, -(WINDOW_DAYS - 1)),
      endDate,
      rowLimit: ROW_LIMIT,
      startRow: 0,
    } as const;

    // Two separate reads, never one `[page, query]` breakdown: impressions on a
    // cross-dimension result do not sum to the site total, and every share here
    // is a share of that total.
    //
    // The third is not a share, which is why it is allowed to be per-page: the
    // band check asks where one URL ranks for one query, and the site-wide
    // query list answers a different question — its position for that query is
    // the property's average across every page that ranked for it. It is only
    // requested when there is both a collected page and a confirmed query, so
    // an audit that cannot use it never spends the call.
    const wantsTargetRows = targetPageUrl !== null && targetQueries.length > 0;
    const [pages, queries, targetRows] = await Promise.all([
      client({ ...window, dimensions: ["page"] }),
      client({ ...window, dimensions: ["query"] }),
      wantsTargetRows
        ? client({
            ...window,
            rowLimit: TARGET_PAGE_ROW_LIMIT,
            dimensions: ["query"],
            filters: [{ dimension: "page", expression: targetPageUrl }],
          })
        : null,
    ]);

    const rows = (response: {
      readonly rows: readonly {
        readonly keys: readonly string[];
        readonly clicks: number;
        readonly impressions: number;
        readonly position: number;
      }[];
    }) =>
      response.rows.flatMap((row) => {
        const key = row.keys[0];
        return key === undefined
          ? []
          : [
              {
                key,
                clicks: row.clicks,
                impressions: row.impressions,
                position: row.position,
              },
            ];
      });

    return {
      property,
      startDate: window.startDate,
      endDate: window.endDate,
      pages: rows(pages),
      queries: rows(queries),
      pagesTruncated: pages.rows.length >= ROW_LIMIT,
      queriesTruncated: queries.rows.length >= ROW_LIMIT,
      // Null and empty are different answers here. Null is "not asked"; empty
      // is "asked, and Search Console reported nothing for that URL" — the
      // second is a measurement the record is entitled to state.
      targetPageQueries: targetRows === null ? null : rows(targetRows),
      targetPageUrl: wantsTargetRows ? targetPageUrl : null,
      confirmedQueries: targetQueries,
      targetPageQueriesTruncated:
        targetRows !== null && targetRows.rows.length >= TARGET_PAGE_ROW_LIMIT,
    };
  };
}
