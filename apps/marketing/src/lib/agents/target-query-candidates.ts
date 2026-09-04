// @input  -- an inspected page URL and the visitor's Search Console grant
// @output -- queries that actually earned this page impressions, or a typed reason there are none
// @pos    -- pure read; owns no credential, writes nothing, never falls back to a guess
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { keywordCoverageProperty } from "@sf/public-tools/keyword-opportunity";
import { createSearchAnalyticsClient } from "@sf/sources/gsc/search-analytics";

/**
 * How far back a candidate may have earned its impressions.
 *
 * The same 28 days the other Search Console tools read, so a visitor who
 * compares two screens is not comparing two windows.
 */
export const TARGET_QUERY_WINDOW_DAYS = 28;

/**
 * Days excluded from the end of the window.
 *
 * Search Console finalises a day's rows some time after it ends. Reading right
 * up to today returns a partial final day, and a query that looks like it lost
 * its impressions has only lost the hours not yet counted.
 */
export const TARGET_QUERY_FINALISATION_LAG_DAYS = 3;

/** Rows requested. Small on purpose: this is a shortlist, not a keyword export. */
const ROW_LIMIT = 25;

/** Candidates offered. More than this is a list nobody reads to the end of. */
export const TARGET_QUERY_CANDIDATE_LIMIT = 8;

const READ_TIMEOUT_MS = 15_000;

export interface TargetQueryCandidate {
  readonly query: string;
  readonly impressions: number;
  readonly clicks: number;
  /**
   * Impression-weighted average position over the window.
   *
   * Kept because it is the one number that separates "this page is already the
   * answer for this query" from "this page is on page four for it", and those
   * two suggest very different work.
   */
  readonly position: number;
}

export type TargetQueryCandidatesRead =
  | {
      readonly kind: "candidates";
      readonly property: string;
      readonly windowStart: string;
      readonly windowEnd: string;
      readonly candidates: readonly TargetQueryCandidate[];
    }
  /** A grant exists, but no verified property covers this page. */
  | { readonly kind: "no_property" }
  /** The property covers the page and Search Console has no rows for it. */
  | {
      readonly kind: "no_rows";
      readonly property: string;
      readonly windowStart: string;
      readonly windowEnd: string;
    }
  /** No usable Search Console grant. The visitor's route on is the consent screen. */
  | { readonly kind: "no_grant" }
  /** The read failed for a reason that says nothing about the page. */
  | { readonly kind: "unavailable" };

function isoDay(at: Date, minusDays: number): string {
  const day = new Date(at.getTime() - minusDays * 24 * 60 * 60 * 1000);
  return day.toISOString().slice(0, 10);
}

export function targetQueryWindow(at: Date): {
  readonly startDate: string;
  readonly endDate: string;
} {
  return {
    startDate: isoDay(
      at,
      TARGET_QUERY_FINALISATION_LAG_DAYS + TARGET_QUERY_WINDOW_DAYS,
    ),
    endDate: isoDay(at, TARGET_QUERY_FINALISATION_LAG_DAYS),
  };
}

/**
 * Read the queries this exact page was shown for.
 *
 * Filtered by page rather than aggregated over the property: the whole point
 * is a phrase this page can plausibly own, and a site's best query is usually
 * some other page's.
 *
 * Rejects rather than returning an empty list when the read fails. An empty
 * list is a real answer -- a page nobody has found yet -- and handing that back
 * for a network error would tell a visitor their page earns no impressions
 * when the truth is that we could not ask.
 */
export function createTargetQueryCandidateReader(options: {
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
  readonly deadlineAt?: number;
}): (input: {
  readonly inspectedUrl: string;
  readonly accessToken: string;
  readonly properties: readonly string[];
}) => Promise<TargetQueryCandidatesRead> {
  const now = options.now ?? (() => new Date());

  return async ({ inspectedUrl, accessToken, properties }) => {
    const property = keywordCoverageProperty(inspectedUrl, properties);
    if (property === null) return { kind: "no_property" };

    const { startDate, endDate } = targetQueryWindow(now());
    const client = createSearchAnalyticsClient({
      // The field is named for the path segment; what it wants is the property.
      siteUrl: property,
      accessToken,
      requestTimeoutMs: READ_TIMEOUT_MS,
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
      ...(options.deadlineAt === undefined
        ? {}
        : { remainingMs: () => options.deadlineAt! - Date.now() }),
    });

    let response;
    try {
      response = await client({
        dimensions: ["query"],
        startDate,
        endDate,
        rowLimit: ROW_LIMIT,
        startRow: 0,
        /*
          Search Console keys its rows by the URL the visit landed on, which is
          the end of any redirect journey. The audit's inspected URL is that
          same form -- the submitted URL is not, and filtering by it on a site
          that redirects returns nothing at all while looking like a page with
          no impressions.
        */
        filters: [{ dimension: "page", expression: inspectedUrl }],
      });
    } catch {
      return { kind: "unavailable" };
    }

    const candidates = response.rows
      .map((row) => ({
        query: row.keys[0] ?? "",
        impressions: row.impressions,
        clicks: row.clicks,
        position: row.position,
      }))
      .filter((row) => row.query !== "" && row.impressions > 0)
      .sort((left, right) => right.impressions - left.impressions)
      .slice(0, TARGET_QUERY_CANDIDATE_LIMIT);

    if (candidates.length === 0) {
      return { kind: "no_rows", property, windowStart: startDate, windowEnd: endDate };
    }
    return {
      kind: "candidates",
      property,
      windowStart: startDate,
      windowEnd: endDate,
      candidates,
    };
  };
}
