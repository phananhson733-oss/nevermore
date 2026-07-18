/**
 * GSC row -> canonical observation transform (spec §7.4, §7.6). Pure and
 * deterministic. Aggregates raw (date, page, query) rows by canonical
 * `subjectUrl` into one `gsc.page.v1` observation per page, splitting metrics
 * into the `current28d` / `previous28d` halves of the window.
 *
 * Honesty rules (spec §1.3): a window's `position` is an impression-weighted
 * average and is `null` when that window has zero impressions — never 0. Rows
 * whose page fails canonicalization are dropped. Rows outside both halves are
 * ignored. `clicks` / `impressions` are true sums (0 is a real zero count).
 */

import { canonicalizeUrl } from "../canonical-url.ts";
import { METRIC_GSC_PAGE, buildObservation } from "../observations.ts";
import type {
  GscPageProjection,
  GscTopQuery,
  GscWindowMetrics,
} from "../observations.ts";
import type { NormalizedObservation } from "../adapter.ts";
import type { GscRow } from "./client.ts";
import type { GscWindow } from "./window.ts";

/**
 * The snapshot limitation (spec §8.4): Search Console surfaces only its top rows
 * ordered by clicks, so the query universe is inherently truncated.
 */
export const GSC_LIMITATION =
  "Google Search Console returns only the top rows sorted by clicks, not the full query universe; low-click queries and pages may be omitted.";

/** Top queries kept per page in the current 28-day window (spec §7.4). */
const TOP_QUERY_LIMIT = 10;

interface WindowAccumulator {
  clicks: number;
  impressions: number;
  weightedPositionSum: number;
}

interface QueryAccumulator {
  readonly query: string;
  clicks: number;
  impressions: number;
  weightedPositionSum: number;
}

interface PageAccumulator {
  readonly subjectUrl: string;
  readonly current: WindowAccumulator;
  readonly previous: WindowAccumulator;
  readonly currentQueries: Map<string, QueryAccumulator>;
}

function emptyWindow(): WindowAccumulator {
  return { clicks: 0, impressions: 0, weightedPositionSum: 0 };
}

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function weightedAverage(weightedSum: number, impressions: number): number | null {
  return impressions > 0 ? weightedSum / impressions : null;
}

function addToWindow(accumulator: WindowAccumulator, row: GscRow): void {
  accumulator.clicks += row.clicks;
  accumulator.impressions += row.impressions;
  accumulator.weightedPositionSum += row.position * row.impressions;
}

function addToQuery(map: Map<string, QueryAccumulator>, row: GscRow): void {
  const existing = map.get(row.query);
  if (existing === undefined) {
    map.set(row.query, {
      query: row.query,
      clicks: row.clicks,
      impressions: row.impressions,
      weightedPositionSum: row.position * row.impressions,
    });
    return;
  }
  existing.clicks += row.clicks;
  existing.impressions += row.impressions;
  existing.weightedPositionSum += row.position * row.impressions;
}

function toWindowMetrics(accumulator: WindowAccumulator): GscWindowMetrics {
  return {
    clicks: accumulator.clicks,
    impressions: accumulator.impressions,
    position: weightedAverage(accumulator.weightedPositionSum, accumulator.impressions),
  };
}

/** Sort by impressions desc, then clicks desc, then query asc (deterministic). */
function compareQueries(a: QueryAccumulator, b: QueryAccumulator): number {
  if (b.impressions !== a.impressions) return b.impressions - a.impressions;
  if (b.clicks !== a.clicks) return b.clicks - a.clicks;
  return a.query < b.query ? -1 : a.query > b.query ? 1 : 0;
}

function toTopQueries(map: Map<string, QueryAccumulator>): readonly GscTopQuery[] {
  return [...map.values()]
    .sort(compareQueries)
    .slice(0, TOP_QUERY_LIMIT)
    .map((query) => ({
      query: query.query,
      clicks: query.clicks,
      impressions: query.impressions,
      position: weightedAverage(query.weightedPositionSum, query.impressions),
    }));
}

function toObservation(page: PageAccumulator, observedAt: string): NormalizedObservation {
  const projection: GscPageProjection = {
    current28d: toWindowMetrics(page.current),
    previous28d: toWindowMetrics(page.previous),
    topQueries: toTopQueries(page.currentQueries),
  };
  return buildObservation({
    provider: "gsc",
    metricKey: METRIC_GSC_PAGE,
    subjectType: "url",
    subjectRef: page.subjectUrl,
    observedAt,
    availability: "available",
    value: { json: projection },
    unit: null,
    limitation: GSC_LIMITATION,
  });
}

/**
 * Aggregate raw GSC rows into one `gsc.page.v1` observation per canonical page.
 * `capturedAt` becomes each observation's `observedAt`. Output is sorted by
 * `subjectRef` for stable ordering.
 */
export function normalizeGscRows(
  rows: readonly GscRow[],
  window: GscWindow,
  capturedAt: string,
): readonly NormalizedObservation[] {
  const pages = new Map<string, PageAccumulator>();

  for (const row of rows) {
    const canonical = canonicalizeUrl(row.page);
    if (canonical === null) continue;

    const isCurrent = inRange(row.date, window.current28d.start, window.current28d.end);
    const isPrevious = inRange(row.date, window.previous28d.start, window.previous28d.end);
    if (!isCurrent && !isPrevious) continue;

    const subjectUrl = canonical.subjectUrl;
    let page = pages.get(subjectUrl);
    if (page === undefined) {
      page = {
        subjectUrl,
        current: emptyWindow(),
        previous: emptyWindow(),
        currentQueries: new Map<string, QueryAccumulator>(),
      };
      pages.set(subjectUrl, page);
    }

    if (isCurrent) {
      addToWindow(page.current, row);
      addToQuery(page.currentQueries, row);
    } else {
      addToWindow(page.previous, row);
    }
  }

  return [...pages.values()]
    .sort((a, b) => (a.subjectUrl < b.subjectUrl ? -1 : a.subjectUrl > b.subjectUrl ? 1 : 0))
    .map((page) => toObservation(page, capturedAt));
}
