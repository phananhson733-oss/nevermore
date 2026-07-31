// @input  -- a granted property, a lookback length, and the visitor's access token
// @output -- the property's daily clicks/impressions series
// @pos    -- binds the shared GSC daily reader to one request's token
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { HttpGscDailySeriesReader } from "@sf/sources";
import type { TrafficDailyPoint } from "@sf/public-tools";

/** Leaves room for Search Console paging and backoff inside the route's budget. */
const READ_WALL_CLOCK_MS = 40_000;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export interface TrafficDropReadInput {
  readonly property: string;
  readonly lookbackDays: number;
}

/**
 * Read one property's daily series.
 *
 * The access token is passed per call and never stored on the reader: it
 * belongs to one visitor's request, and a reader that outlived the request
 * would be a token that outlived it too.
 */
export function createTrafficDropReader(options: {
  readonly accessToken: string;
  readonly now?: () => Date;
}): (input: TrafficDropReadInput) => Promise<readonly TrafficDailyPoint[]> {
  const now = options.now ?? (() => new Date());

  return async ({ property, lookbackDays }) => {
    const end = now();
    const start = new Date(end.getTime() - lookbackDays * 86_400_000);

    const reader = new HttpGscDailySeriesReader({
      siteUrl: property,
      accessToken: options.accessToken,
      maxWallClockMs: READ_WALL_CLOCK_MS,
    });

    // The reader already guarantees the two things that matter here: days
    // Search Console omits stay omitted, and an exhausted retry throws rather
    // than handing back a truncated series that would read as a collapse.
    return reader.readDailySeries({
      startDate: isoDate(start),
      endDate: isoDate(end),
    });
  };
}
