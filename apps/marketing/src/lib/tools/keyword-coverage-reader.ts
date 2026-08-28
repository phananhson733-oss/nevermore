// @input  -- a granted Search Console property and this request's access token
// @output -- query and query-page rows with bounded paging facts, or a rejected read
// @pos    -- the keyword map's Search Console adapter; transport lives here
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  readQueryPageRows,
  readQueryRows,
} from "@sf/public-tools/gsc-analytics";
import type { KeywordCoverageRead } from "@sf/public-tools/keyword-opportunity";
import { createSearchAnalyticsClient } from "@sf/sources/gsc/search-analytics";

/** Per-call deadline for one Search Console request. */
const READ_TIMEOUT_MS = 15_000;

/**
 * Length of the coverage window, in days.
 *
 * The same 28 days every other window in this codebase uses, which keeps the
 * connected tools comparable. Shorter would make it worse in the specific way
 * that matters here: query-dimension coverage scales with volume, and over
 * seven days most of a small property's queries sit under Search Console's
 * anonymization threshold and never appear at all — so a narrow window would
 * report "not observed" for terms the site plainly serves.
 */
export const COVERAGE_WINDOW_DAYS = 28;

/**
 * Pages this read may fetch.
 *
 * One window, so the shared cap of 4 is the right budget rather than the
 * halved one the two-window traffic-drop reader needs. Quota is counted per
 * GCP project, not per visitor, so this number is shared with every other
 * tool's reads.
 */
const COVERAGE_MAX_PAGES = 4;

/** Days between the last finalised day and today. */
const FINALISATION_LAG_DAYS = 3;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDays(from: Date, days: number): Date {
  const shifted = new Date(from);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

export interface KeywordCoverageReadInput {
  /**
   * A Search Console property identifier, resolved from the visitor's grant.
   *
   * `sc-domain:acme.com` or the exact verified URL prefix — never a site URL
   * the visitor typed. Search Console addresses properties and refuses
   * anything else, which is how the first live run lost this stage on every
   * request.
   */
  readonly property: string;
  readonly accessToken: string;
}

/**
 * Read the property's queries and their positively observed pages.
 *
 * Rejects rather than returning an empty list when the read fails. An empty
 * list is a real answer — a property that served nothing — and handing that
 * back for a network error would silently turn every candidate into
 * "not observed in the query sample", which is the exact false-negative this
 * stage exists to prevent. The orchestration catches the rejection and marks
 * the stage unavailable, so the run says what it could not check.
 */
export function createKeywordCoverageReader(options: {
  readonly now?: () => Date;
  /**
   * Offline test seam, handed to the Search Console client.
   *
   * Present because the one thing this adapter has to get right — which
   * identifier ends up in the request path — is invisible from the outside
   * without it, and shipping it wrong is what cost the whole coverage stage
   * on the first live run.
   */
  readonly fetchImpl?: typeof fetch;
  /**
   * Absolute epoch-ms mark past which this read stops paging.
   *
   * Set by the route. Coverage was the last stage in this route with no view
   * of the request's clock: two parallel lanes of up to four serial 15-second
   * pages, each page with one retry, is roughly two minutes on a large
   * property — enough to carry a slow run from inside its budget to the
   * platform kill, where no envelope survives at all. Coverage is optional by
   * contract (a rejected read marks the stage unavailable), so running out of
   * budget degrades exactly like a network failure. Omitted callers page
   * unbounded, as before.
   */
  readonly deadlineAt?: number;
}): (input: KeywordCoverageReadInput) => Promise<KeywordCoverageRead> {
  const now = options.now ?? (() => new Date());

  return async ({ property, accessToken }) => {
    // Both reads are one logical observation. If either lane fails, the other
    // must stop before it spends more shared GSC quota paging a result the
    // handler can no longer use.
    const siblingController = new AbortController();
    // The client's field is named `siteUrl` because that is what Google calls
    // the path segment; what it wants there is the property identifier.
    const client = createSearchAnalyticsClient({
      siteUrl: property,
      accessToken,
      requestTimeoutMs: READ_TIMEOUT_MS,
      signal: siblingController.signal,
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
    });

    // Armed before the first request. Aborting the sibling controller is the
    // reader's own established stop: both lanes end promptly, the read
    // rejects, and the handler records the stage unavailable — the same
    // degradation a network failure produces, instead of the platform kill
    // that produces nothing.
    let expire = (): void => {};
    if (options.deadlineAt !== undefined) {
      const remainingMs = options.deadlineAt - now().getTime();
      if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
        siblingController.abort();
      } else {
        const timer = setTimeout(() => {
          siblingController.abort();
        }, remainingMs);
        expire = () => {
          clearTimeout(timer);
        };
      }
    }

    const endDate = shiftDays(now(), -FINALISATION_LAG_DAYS);
    const window = {
      startDate: isoDay(shiftDays(endDate, -(COVERAGE_WINDOW_DAYS - 1))),
      endDate: isoDay(endDate),
    };
    const [queryRead, queryPageRead] = await Promise.all([
      readQueryRows(client, window, undefined, COVERAGE_MAX_PAGES),
      readQueryPageRows(client, window),
    ])
      .catch((error: unknown) => {
        siblingController.abort();
        throw error;
      })
      .finally(expire);

    return {
      queryRows: queryRead.rows.map((row) => ({
        query: row.query,
        impressions: row.impressions,
        position: row.position,
      })),
      queryPageRows: queryPageRead.rows.map((row) => ({
        query: row.query,
        page: row.page,
        impressions: row.impressions,
        position: row.position,
      })),
      queryPaging: queryRead.paging,
      queryPagePaging: queryPageRead.paging,
    };
  };
}
