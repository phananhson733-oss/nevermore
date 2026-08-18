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

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDays(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

export interface SearchPerformanceReadInput {
  /** `sc-domain:acme.com` or the exact verified URL prefix, never a site URL. */
  readonly property: string;
  /** From this request's grant resolution; never captured at module scope. */
  readonly accessToken: string;
}

export function createSearchPerformanceReader(options: {
  readonly now?: () => Date;
  /** Offline test seam, handed to the Search Console client. */
  readonly fetchImpl?: typeof fetch;
}): (input: SearchPerformanceReadInput) => Promise<SearchPerformanceRaw> {
  const now = options.now ?? (() => new Date());

  return async ({ property, accessToken }) => {
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

    const endDate = shiftDays(now(), -FINALISATION_LAG_DAYS);
    const startDate = shiftDays(endDate, -(WINDOW_DAYS - 1));
    const window = {
      startDate: isoDay(startDate),
      endDate: isoDay(endDate),
      rowLimit: ROW_LIMIT,
      startRow: 0,
    } as const;

    // Two separate reads, never one `[page, query]` breakdown: impressions on a
    // cross-dimension result do not sum to the site total, and every share here
    // is a share of that total.
    const [pages, queries] = await Promise.all([
      client({ ...window, dimensions: ["page"] }),
      client({ ...window, dimensions: ["query"] }),
    ]);

    const rows = (response: { readonly rows: readonly {
      readonly keys: readonly string[];
      readonly clicks: number;
      readonly impressions: number;
      readonly position: number;
    }[] }) =>
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
    };
  };
}
