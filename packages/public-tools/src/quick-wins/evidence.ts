// @input  -- non-brand query rows and the site CTR curve built from them
// @output -- the sorted evidence table plus a count of what never reached it
// @pos    -- layer 1 of P0-1: continuous disclosure, no hit/no-hit judgement
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  bucketForPosition,
  leaveOneOutCtr,
} from "../site-baseline/ctr-curve.ts";
import type {
  CtrBucket,
  GscQueryRow,
  SiteCtrCurve,
} from "../site-baseline/types.ts";
import { binomialLowerTail } from "./tail-probability.ts";
import type {
  QuickWinEvidenceRow,
  QuickWinExclusionCounts,
  QuickWinExclusionReason,
} from "./types.ts";

/**
 * Impressions a single query needs before it earns a row.
 *
 * Frozen at 100 by v3.1 §二.1. On the evaluated site this left 54 of roughly
 * a thousand queries — which is the honest yield, not a bug to tune away. A
 * lower floor would fill the table with rows whose observed CTR is one click
 * away from a completely different number.
 */
export const MIN_QUERY_IMPRESSIONS = 100;

/**
 * Below this the band itself is the finding, not the queries inside it.
 *
 * The 2026-07-31 evaluation found positions 4-10 on a real site earning
 * 0.5-0.7% while published benchmarks predict 3-7%. Every query in such a band
 * sits "below baseline" for the same structural reason, and presenting them as
 * a dozen separate observations would multiply one fact into twelve.
 */
export const LOW_CTR_BAND_THRESHOLD = 0.01;

export interface EvidenceTable {
  readonly rows: readonly QuickWinEvidenceRow[];
  readonly excluded: QuickWinExclusionCounts;
  readonly lowCtrBands: readonly CtrBucket[];
}

function emptyCounts(): Record<QuickWinExclusionReason, number> {
  return {
    below_impression_floor: 0,
    position_outside_bands: 0,
    bucket_not_usable: 0,
    no_leave_one_out_baseline: 0,
  };
}

/**
 * Build the evidence table.
 *
 * Rows that beat the site's own curve are kept, with a negative gap. This is a
 * measurement, not a problem list: dropping the queries that do well would
 * turn a neutral record into a page of complaints and quietly remove the only
 * context that makes the rest of the numbers readable.
 */
export function buildEvidenceTable(
  nonBrandRows: readonly GscQueryRow[],
  curve: SiteCtrCurve,
): EvidenceTable {
  const bucketsById = new Map(curve.buckets.map((b) => [b.bucketId, b]));
  const excluded = emptyCounts();
  const rows: QuickWinEvidenceRow[] = [];

  for (const row of nonBrandRows) {
    // Positive assertion: a NaN impression count fails the floor instead of
    // passing it.
    if (
      !(
        Number.isFinite(row.impressions) &&
        row.impressions >= MIN_QUERY_IMPRESSIONS
      )
    ) {
      excluded.below_impression_floor += 1;
      continue;
    }

    const bounds = bucketForPosition(row.position);
    if (bounds === null) {
      excluded.position_outside_bands += 1;
      continue;
    }

    const bucket = bucketsById.get(bounds.id);
    if (bucket === undefined || bucket.quality !== "usable") {
      excluded.bucket_not_usable += 1;
      continue;
    }

    const baselineCtr = leaveOneOutCtr(bucket, row);
    if (baselineCtr === null) {
      excluded.no_leave_one_out_baseline += 1;
      continue;
    }

    const expectedClicks = row.impressions * baselineCtr;
    const clickGap = expectedClicks - row.clicks;
    // A non-finite gap has no place in a table sorted by gap: it makes the
    // comparator intransitive (NaN - NaN is falsy, so the sort falls through
    // to the name tiebreak and can produce a < b < c < a), which silently
    // destroys the ordering of every OTHER row too.
    if (!Number.isFinite(clickGap)) {
      excluded.no_leave_one_out_baseline += 1;
      continue;
    }
    rows.push({
      query: row.query,
      position: row.position,
      bucketId: bounds.id,
      impressions: row.impressions,
      clicks: row.clicks,
      observedCtr: row.impressions === 0 ? null : row.clicks / row.impressions,
      baselineCtr,
      expectedClicks,
      clickGap,
      tailProbability: binomialLowerTail(
        row.impressions,
        row.clicks,
        baselineCtr,
      ),
      baselineBandUnderOnePercent: baselineCtr < LOW_CTR_BAND_THRESHOLD,
      // Provisional. `report.ts` narrows it once it knows which queries got a
      // wording candidate; see `track.ts` for why that cannot be decided here.
      track: "read_the_serp",
    });
  }

  // Largest shortfall first. Ties break on query so the order is stable
  // across runs — an export whose row order moves for no reason is an export
  // nobody can diff.
  const sorted = [...rows].sort(
    (a, b) => b.clickGap - a.clickGap || a.query.localeCompare(b.query),
  );

  const lowCtrBands = curve.buckets.filter(
    (b) =>
      b.quality === "usable" &&
      b.ctr !== null &&
      Number.isFinite(b.ctr) &&
      b.ctr < LOW_CTR_BAND_THRESHOLD,
  );

  return { rows: sorted, excluded, lowCtrBands };
}
