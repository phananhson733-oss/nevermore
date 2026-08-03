// @input  -- Search Console query rows for one 28-day window
// @output -- the shared shapes every site-baseline computation reads and returns
// @pos    -- type boundary for the per-run baseline shared by the connected public tools
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * One Search Console query row for a single window.
 *
 * `position` is the impression-weighted average position Search Console
 * reports for that window. It is an average over every impression, not a rank:
 * a query that sat at 3 for one week and 25 for three reports something in
 * between, and nothing in this row can tell those two histories apart. Every
 * consumer of this field has to treat it as an aggregate, never as "where the
 * page ranks".
 */
export interface GscQueryRow {
  readonly query: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number;
}

/**
 * Position bands the CTR curve is grouped by.
 *
 * Bands are deliberately unequal in width: click-through falls steeply across
 * the first few positions and flattens after that, so equal-width buckets
 * would put 1 and 2 (which behave very differently) in one bucket and 15 and
 * 20 (which barely differ) in separate ones. These boundaries match the ones
 * the 2026-07-31 real-data evaluation used, so a curve computed here can be
 * read against that report without re-bucketing.
 *
 * Nothing beyond position 21 gets a band. Down there CTR is close enough to
 * zero that "below your site's baseline" stops carrying information.
 */
export type PositionBucketId =
  | "1-2"
  | "2-3"
  | "3-4"
  | "4-6"
  | "6-8"
  | "8-11"
  | "11-16"
  | "16-21";

export interface PositionBucketBounds {
  readonly id: PositionBucketId;
  /** Inclusive. */
  readonly min: number;
  /** Exclusive. */
  readonly max: number;
}

export const POSITION_BUCKETS: readonly PositionBucketBounds[] = [
  { id: "1-2", min: 1, max: 2 },
  { id: "2-3", min: 2, max: 3 },
  { id: "3-4", min: 3, max: 4 },
  { id: "4-6", min: 4, max: 6 },
  { id: "6-8", min: 6, max: 8 },
  { id: "8-11", min: 8, max: 11 },
  { id: "11-16", min: 11, max: 16 },
  { id: "16-21", min: 16, max: 21 },
];

/**
 * Why a bucket cannot be used as a baseline.
 *
 * `usable` is the only value that lets a query be compared against the bucket.
 * The rest are reported to the visitor rather than silently swallowed: a band
 * we could not measure is a different statement from a band where nothing was
 * wrong, and collapsing the two is how a tool ends up telling a small site
 * that it has no opportunities when the truth is that we could not look.
 */
export type BucketQuality =
  | "usable"
  | "insufficient_impressions"
  | "insufficient_queries";

export interface CtrBucket {
  readonly bucketId: PositionBucketId;
  readonly queryCount: number;
  readonly clicks: number;
  readonly impressions: number;
  /** Null when impressions === 0. An unavailable ratio is never reported as 0. */
  readonly ctr: number | null;
  readonly quality: BucketQuality;
}

/**
 * The site's own click-through curve for one window.
 *
 * Built from non-brand queries only. Brand queries earn several times the
 * click-through of non-brand ones at the same position, so leaving them in
 * raises the whole curve and turns ordinary non-brand pages into apparent
 * under-performers.
 */
export interface SiteCtrCurve {
  readonly buckets: readonly CtrBucket[];
  /** Rows that went into the curve (non-brand, position within a band). */
  readonly rowsUsed: number;
  /** Rows excluded as brand queries. Reported so the visitor can overrule it. */
  readonly brandRowsExcluded: number;
  /** Rows whose position fell beyond the last band (21+). */
  readonly rowsBeyondBands: number;
}
