// @input  -- non-brand Search Console query rows for one window
// @output -- the site's own position-banded CTR curve, and leave-one-out baselines from it
// @pos    -- the measurement every P0-1 finding is compared against
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  POSITION_BUCKETS,
  type BucketQuality,
  type CtrBucket,
  type GscQueryRow,
  type PositionBucketBounds,
  type SiteCtrCurve,
} from "./types.ts";

/**
 * Impressions a band needs before its CTR is treated as a baseline.
 *
 * Frozen at 500 by v3.1 §二.1. Below this the band's rate is dominated by
 * whichever one or two queries happen to sit in it.
 */
export const MIN_BUCKET_IMPRESSIONS = 500;

/**
 * Distinct queries a band needs.
 *
 * Impressions alone are not enough: one query with 20,000 impressions clears
 * the impression gate on its own, and a "site baseline" computed from a single
 * query is that query, not the site.
 */
export const MIN_BUCKET_QUERIES = 5;

/** The band a position falls in, or null when it falls outside every band. */
export function bucketForPosition(
  position: number,
): PositionBucketBounds | null {
  for (const bucket of POSITION_BUCKETS) {
    if (position >= bucket.min && position < bucket.max) return bucket;
  }
  return null;
}

/**
 * Gates written as positive assertions, so a NaN fails them.
 *
 * `NaN < MIN` is false, so the obvious `if (x < MIN) return insufficient`
 * form lets a NaN through and grades the band `usable` — after which its NaN
 * baseline poisons every query measured against it.
 */
function qualityOf(queryCount: number, impressions: number): BucketQuality {
  if (!(Number.isFinite(impressions) && impressions >= MIN_BUCKET_IMPRESSIONS)) {
    return "insufficient_impressions";
  }
  if (!(Number.isFinite(queryCount) && queryCount >= MIN_BUCKET_QUERIES)) {
    return "insufficient_queries";
  }
  return "usable";
}

interface BucketAccumulator {
  queryCount: number;
  clicks: number;
  impressions: number;
}

/**
 * Build the site's CTR curve from its own rows.
 *
 * Callers pass non-brand rows only (see `splitBrandQueries`). Every band is
 * emitted even when the site does not occupy it: a band that is absent from
 * the output and a band with nothing in it read the same to a consumer, and
 * only one of them is a statement about the site.
 */
export function buildSiteCtrCurve(
  nonBrandRows: readonly GscQueryRow[],
  brandRowsExcluded = 0,
): SiteCtrCurve {
  const totals = new Map<string, BucketAccumulator>();
  for (const bucket of POSITION_BUCKETS) {
    totals.set(bucket.id, { queryCount: 0, clicks: 0, impressions: 0 });
  }

  let rowsUsed = 0;
  let rowsBeyondBands = 0;

  for (const row of nonBrandRows) {
    const bucket = bucketForPosition(row.position);
    if (bucket === null) {
      rowsBeyondBands += 1;
      continue;
    }
    const acc = totals.get(bucket.id);
    if (acc === undefined) continue;
    acc.queryCount += 1;
    acc.clicks += row.clicks;
    acc.impressions += row.impressions;
    rowsUsed += 1;
  }

  const buckets: CtrBucket[] = POSITION_BUCKETS.map((bucket) => {
    const acc = totals.get(bucket.id) ?? {
      queryCount: 0,
      clicks: 0,
      impressions: 0,
    };
    return {
      bucketId: bucket.id,
      queryCount: acc.queryCount,
      clicks: acc.clicks,
      impressions: acc.impressions,
      // Unavailable is not zero: a band nobody was shown in has no rate.
      ctr: acc.impressions === 0 ? null : acc.clicks / acc.impressions,
      quality: qualityOf(acc.queryCount, acc.impressions),
    };
  });

  return { buckets, rowsUsed, brandRowsExcluded, rowsBeyondBands };
}

/**
 * The band's CTR with one query's own clicks and impressions removed.
 *
 * A query compared against a baseline it is part of is partly compared against
 * itself, and the bigger its share of the band the more the baseline bends
 * toward it. The worst case is the one that matters here: a high-impression
 * zero-click query drags its own band down until it no longer looks unusual.
 *
 * Returns null when the remainder is not a usable baseline — either nothing is
 * left, or what is left would not have cleared the gates on its own. A band
 * that only qualifies because the measured query is in it is not a baseline
 * for that query.
 */
export function leaveOneOutCtr(
  bucket: CtrBucket,
  row: GscQueryRow,
): number | null {
  const impressions = bucket.impressions - row.impressions;
  const clicks = bucket.clicks - row.clicks;
  const queryCount = bucket.queryCount - 1;

  if (!(Number.isFinite(impressions) && impressions > 0)) return null;
  // The numerator needs its own guard. Without it a bucket of 600 impressions
  // and 0 clicks, minus a row of 100 impressions and 1 click, returns
  // -1/500 — a negative CTR that flows into expectedClicks, clickGap and the
  // rendered table. Clicks outside [0, impressions] mean the row is not a
  // member of this bucket, or the upstream counts are not trustworthy.
  if (!(Number.isFinite(clicks) && clicks >= 0 && clicks <= impressions)) {
    return null;
  }
  if (qualityOf(queryCount, impressions) !== "usable") return null;

  return clicks / impressions;
}
