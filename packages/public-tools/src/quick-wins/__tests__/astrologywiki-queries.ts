// @input  -- none; a frozen fixture
// @output -- a query set reproducing the 8-11 band measured on a real property
// @pos    -- the regression anchor for "published CTR tables do not describe a real site"
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { GscQueryRow } from "../../site-baseline/types.ts";

/**
 * The 8-11 position band of `sc-domain:astrologywiki.com`, 2026-07-02 to 07-29.
 *
 * Source: `docs/plans/2026-07-31-p0-1-p0-3-evaluation-results.md` §1.1 and
 * §1.2, read out of the Owner's own Search Console session. The band totalled
 * 451 queries, 16,885 impressions and an impression-weighted CTR of 0.51%.
 *
 * The six named queries are the real high-impression rows from §1.2. The rest
 * of the band is reconstructed as filler that reproduces the published totals:
 * we have the band aggregates but not 445 individual query strings, and
 * inventing plausible-looking query text would make the fixture read as more
 * literal than it is. Every number that a test asserts on comes from the
 * report; only the distribution of the long tail is synthetic.
 *
 * Why this fixture exists: published CTR benchmarks put position 8-11 at
 * roughly 3%. This property earns 0.51% there — a sixth of it — because its
 * queries get answered in the results page. Any change that reintroduces a
 * fixed benchmark table will show up here as the whole band turning into
 * findings.
 */

/** The named rows from §1.2, with clicks derived from the published CTRs. */
export const ASTROLOGYWIKI_NAMED_QUERIES: readonly GscQueryRow[] = [
  { query: "lamine yamal zodiac sign", position: 8.9, impressions: 3439, clicks: 3 },
  { query: "erling haaland birth chart", position: 9.4, impressions: 1269, clicks: 6 },
  { query: "messi zodiac sign", position: 9.1, impressions: 960, clicks: 0 },
  { query: "jude bellingham zodiac sign", position: 9.8, impressions: 889, clicks: 0 },
  { query: "yamal zodiac sign", position: 8.6, impressions: 803, clicks: 1 },
  { query: "lionel messi zodiac sign", position: 10.2, impressions: 516, clicks: 0 },
];

const NAMED_IMPRESSIONS = 7876;
const NAMED_CLICKS = 10;
/** §1.1: 451 queries, 16,885 impressions, 0.51% CTR — so 86 clicks. */
const BAND_QUERIES = 451;
const BAND_IMPRESSIONS = 16_885;
const BAND_CLICKS = 86;

const FILLER_QUERIES = BAND_QUERIES - ASTROLOGYWIKI_NAMED_QUERIES.length;
const FILLER_IMPRESSIONS = BAND_IMPRESSIONS - NAMED_IMPRESSIONS;
const FILLER_CLICKS = BAND_CLICKS - NAMED_CLICKS;

/**
 * The long tail, spread evenly.
 *
 * Every filler row sits far below the 100-impression floor, which is itself
 * true to the property: §1.3 records only 54 queries at or above 100
 * impressions, and just 2 at or above 1,000.
 */
const FILLER_BASE = Math.floor(FILLER_IMPRESSIONS / FILLER_QUERIES);
/**
 * Impressions left over after the even split.
 *
 * Dropping them (which `Math.floor` alone does) left the band 109 impressions
 * short of the published 16,885, and the resulting CTR error hid inside the
 * test's `toBeCloseTo` tolerance. The fixture's whole purpose is to anchor
 * published numbers, so it has to reproduce them exactly.
 */
const FILLER_REMAINDER = FILLER_IMPRESSIONS - FILLER_BASE * FILLER_QUERIES;

const FILLER: readonly GscQueryRow[] = Array.from(
  { length: FILLER_QUERIES },
  (_, i) => ({
    query: `tail-query-${i}`,
    position: 9.5,
    impressions: FILLER_BASE + (i < FILLER_REMAINDER ? 1 : 0),
    clicks: i < FILLER_CLICKS ? 1 : 0,
  }),
);

export const ASTROLOGYWIKI_BAND_8_11: readonly GscQueryRow[] = [
  ...ASTROLOGYWIKI_NAMED_QUERIES,
  ...FILLER,
];

/**
 * What a published benchmark table claims for this band.
 *
 * From the v1 landing copy draft: roughly 28% at position 1, 11% at 3, 2% at
 * 10. Position 8-11 sits around 3% in that table.
 */
export const PUBLISHED_BENCHMARK_8_11 = 0.03;

/** The published band totals this fixture must reproduce exactly. */
export const ASTROLOGYWIKI_BAND_TOTALS = {
  queries: BAND_QUERIES,
  impressions: BAND_IMPRESSIONS,
  clicks: BAND_CLICKS,
} as const;
