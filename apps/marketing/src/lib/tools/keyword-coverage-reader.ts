// @input  -- a granted Search Console property and this request's access token
// @output -- the query rows the coverage check reads, or a throw the run degrades on
// @pos    -- the only Search Console read the keyword map makes; transport lives here
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  readQueryRows,
  type KeywordCoverageQueryRow,
} from "@sf/public-tools";
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
  readonly siteUrl: string;
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
}): (
  input: KeywordCoverageReadInput,
) => Promise<readonly KeywordCoverageQueryRow[]> {
  const now = options.now ?? (() => new Date());

  return async ({ siteUrl, accessToken }) => {
    const client = createSearchAnalyticsClient({
      siteUrl,
      accessToken,
      requestTimeoutMs: READ_TIMEOUT_MS,
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
