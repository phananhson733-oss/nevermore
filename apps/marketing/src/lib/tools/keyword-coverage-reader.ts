// @input  -- a granted Search Console property and this request's access token
// @output -- the query rows the coverage check reads, or a throw the run degrades on
// @pos    -- the only Search Console read the keyword map makes; transport lives here
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { readQueryRows, type KeywordCoverageQueryRow } from "@sf/public-tools";
import { createSearchAnalyticsClient } from "@sf/sources";

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
 * Read the property's own queries for the coverage check.
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
}): (
  input: KeywordCoverageReadInput,
) => Promise<readonly KeywordCoverageQueryRow[]> {
  const now = options.now ?? (() => new Date());

  return async ({ property, accessToken }) => {
    // The client's field is named `siteUrl` because that is what Google calls
    // the path segment; what it wants there is the property identifier.
    const client = createSearchAnalyticsClient({
      siteUrl: property,
      accessToken,
      requestTimeoutMs: READ_TIMEOUT_MS,
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
    });

    const endDate = shiftDays(now(), -FINALISATION_LAG_DAYS);
    const read = await readQueryRows(
      client,
      {
        startDate: isoDay(shiftDays(endDate, -(COVERAGE_WINDOW_DAYS - 1))),
        endDate: isoDay(endDate),
      },
      undefined,
      COVERAGE_MAX_PAGES,
    );

    return read.rows.map((row) => ({
      query: row.query,
      impressions: row.impressions,
      position: row.position,
    }));
  };
}
