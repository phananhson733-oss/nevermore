// @input  -- an injected Search Analytics client, clock and confirmed brand input
// @output -- a daily briefing anchored to its newest valid daily observation
// @pos    -- bounded I/O orchestration; transport remains injected by apps/*

import { SourceError } from "@sf/sources/adapter";

import {
  GSC_ROW_LIMIT,
  readPropertyTotals,
  readQueryRows,
  type ReadBudget,
} from "../gsc-analytics/reader.ts";
import {
  readPageRows,
  readQueryPageRows,
} from "../gsc-analytics/page-reader.ts";
import type { GscQueryClient } from "../gsc-analytics/types.ts";
import { shiftDate } from "../gsc-analytics/window.ts";
import {
  buildDailyBriefing,
  DAILY_BRIEFING_TREND_DAYS,
  dailyBriefingWindowsFor,
  dailyBriefingTrendWindowsFor,
} from "./report.ts";
import type {
  DailyBriefingDateRow,
  DailyBriefingEnvelope,
  DailyBriefingQueryEvidence,
  DailyBriefingTrendRead,
} from "./types.ts";
import { verifyDailyBriefing } from "./verification.ts";

export interface RunDailyBriefingInput {
  readonly client: GscQueryClient;
  readonly now: Date;
  readonly brandTerms: readonly string[];
  readonly brandTermsConfirmed: boolean;
  readonly budget?: ReadBudget;
}

function fulfilledOrNull<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function trendReadFrom(
  response: Awaited<ReturnType<GscQueryClient>>,
): DailyBriefingTrendRead {
  return {
    rows: response.rows.flatMap((row) => {
      const key = row.keys[0];
      return typeof key === "string"
        ? [
            {
              key,
              clicks: row.clicks,
              impressions: row.impressions,
              position: row.position,
            },
          ]
        : [];
    }),
    firstIncompleteDate: response.metadata?.firstIncompleteDate ?? null,
    firstIncompleteHour: response.metadata?.firstIncompleteHour ?? null,
  };
}

/**
 * Read fresh daily observations before freezing the analysis windows.
 *
 * The date-dimension read is the report: if it fails or has an unknown basis,
 * there is no honest KPI result and no attachments start. Its response supplies
 * the daily trend, with only the missing prefix read when observations lag.
 * Analysis attachments and hourly traffic degrade independently to null.
 *
 * Two query-explanation attachments read the page dimension on its own.
 * Search Console anonymizes low-volume queries but not pages, so these carry
 * click evidence the query reads structurally cannot: one measured property
 * showed 9 of 37 weekly clicks at query level and all 37 at page level.
 */
export async function runDailyBriefing(
  input: RunDailyBriefingInput,
): Promise<DailyBriefingEnvelope> {
  const trendWindows = dailyBriefingTrendWindowsFor(input.now);
  const dateResponse = await input.client({
    dimensions: ["date"],
    startDate: trendWindows.daily.startDate,
    endDate: trendWindows.daily.endDate,
    rowLimit: GSC_ROW_LIMIT,
    startRow: 0,
    dataState: "all",
    aggregationType: "byProperty",
  });
  if (dateResponse.responseAggregationType !== "byProperty") {
    throw new SourceError("UNAVAILABLE", "Daily Search Console aggregation is unavailable.");
  }

  const dateRows: DailyBriefingDateRow[] = [];
  for (const row of dateResponse.rows) {
    const date = row.keys[0];
    if (typeof date !== "string") continue;
    dateRows.push({
      date,
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    });
  }

  let windowEndDate: string | null = null;
  for (const row of dateRows) {
    if (
      !isDateKey(row.date) ||
      row.date < trendWindows.daily.startDate ||
      row.date > trendWindows.daily.endDate ||
      !Number.isFinite(row.clicks) ||
      row.clicks < 0 ||
      !Number.isFinite(row.impressions) ||
      row.impressions < 0 ||
      row.clicks > row.impressions ||
      !Number.isFinite(row.position) ||
      row.position < 0
    ) {
      continue;
    }
    if (windowEndDate === null || row.date > windowEndDate) windowEndDate = row.date;
  }

  // A 90-day range ending today is shorter than 90 observed days when GSC
  // lags. Fill only the newly discovered prefix without moving the frozen end.
  const prefixStart = windowEndDate === null
    ? null : shiftDate(windowEndDate, -(DAILY_BRIEFING_TREND_DAYS - 1));
  const prefixEnd = shiftDate(trendWindows.daily.startDate, -1);
  const datePrefix = prefixStart !== null && prefixStart < trendWindows.daily.startDate
    ? input.client({
        dimensions: ["date"],
        startDate: prefixStart,
        endDate: prefixEnd,
        rowLimit: GSC_ROW_LIMIT,
        startRow: 0,
        dataState: "all",
        aggregationType: "byProperty",
      }).then((response) => {
        if (response.responseAggregationType !== "byProperty" || response.rows.some((row) => {
          const key = row.keys[0];
          return key === undefined || !isDateKey(key) || key < prefixStart || key > prefixEnd;
        })) return null;
        return response;
      }, () => null)
    : null;

  const trendHourly = input.client({
    dimensions: ["hour"],
    startDate: trendWindows.hourly.startDate,
    endDate: trendWindows.hourly.endDate,
    rowLimit: GSC_ROW_LIMIT,
    startRow: 0,
    dataState: "hourly_all",
    aggregationType: "byProperty",
  }).then(
    (response) => response.responseAggregationType === "byProperty" ? trendReadFrom(response) : null,
    () => null,
  );
  let currentQueryEvidence: DailyBriefingQueryEvidence | null = null;
  let previousQueryEvidence: DailyBriefingQueryEvidence | null = null;

  if (windowEndDate !== null) {
    const windows = dailyBriefingWindowsFor(windowEndDate);

    // Readers keep their shared safe default. Only this briefing's attachments
    // opt into the same freshness state as the date response that froze them.
    const freshClient: GscQueryClient = (request) => input.client({
      ...request,
      dataState: "all",
    });
    // A failed attachment must not cancel useful siblings still in flight.
    const optionalBudget: ReadBudget = {
      isExpired: () => input.budget?.isExpired() === true,
    };

    const [
      currentQuery,
      previousQuery,
      currentQueryPageTotals,
      previousQueryPageTotals,
      currentQueryPage,
      previousQueryPage,
      currentPage,
      previousPage,
      currentTotals,
      previousTotals,
    ] = await Promise.allSettled([
      readQueryRows(freshClient, windows.current7Days, optionalBudget, 1, "byProperty"),
      readQueryRows(freshClient, windows.previous7Days, optionalBudget, 1, "byProperty"),
      readQueryRows(freshClient, windows.current7Days, optionalBudget, 1, "byPage"),
      readQueryRows(freshClient, windows.previous7Days, optionalBudget, 1, "byPage"),
      readQueryPageRows(freshClient, windows.current7Days, optionalBudget, 1, "auto"),
      readQueryPageRows(freshClient, windows.previous7Days, optionalBudget, 1, "auto"),
      readPageRows(freshClient, windows.current7Days, optionalBudget, "byPage"),
      readPageRows(freshClient, windows.previous7Days, optionalBudget, "byPage"),
      readPropertyTotals(freshClient, windows.current7Days, "byPage"),
      readPropertyTotals(freshClient, windows.previous7Days, "byPage"),
    ]);

    currentQueryEvidence = {
      queryRead: fulfilledOrNull(currentQuery),
      queryPageTotalsRead: fulfilledOrNull(currentQueryPageTotals),
      queryPageRead: fulfilledOrNull(currentQueryPage),
      pageRead: fulfilledOrNull(currentPage),
      propertyTotals: fulfilledOrNull(currentTotals),
    };
    previousQueryEvidence = {
      queryRead: fulfilledOrNull(previousQuery),
      queryPageTotalsRead: fulfilledOrNull(previousQueryPageTotals),
      queryPageRead: fulfilledOrNull(previousQueryPage),
      pageRead: fulfilledOrNull(previousPage),
      propertyTotals: fulfilledOrNull(previousTotals),
    };
  }

  let trendDaily: DailyBriefingTrendRead | null = trendReadFrom(dateResponse);
  let firstIncompleteDate = trendDaily.firstIncompleteDate;
  if (datePrefix !== null) {
    const prefixResponse = await datePrefix;
    if (prefixResponse === null) {
      // The original response still supports its own analysis, but cannot
      // stand in for a failed read required by the requested 90-day trend.
      trendDaily = null;
    } else {
      const prefix = trendReadFrom(prefixResponse);
      const boundaries = [firstIncompleteDate, prefix.firstIncompleteDate]
        .filter((boundary): boundary is string => boundary !== null);
      firstIncompleteDate = boundaries.find((boundary) => !isDateKey(boundary))
        ?? boundaries.sort()[0] ?? null;
      trendDaily = {
        rows: [...prefix.rows, ...trendDaily.rows],
        firstIncompleteDate,
        firstIncompleteHour: trendDaily.firstIncompleteHour ?? prefix.firstIncompleteHour,
      };
      dateRows.push(...prefix.rows.map((row) => ({
        date: row.key,
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
      })));
    }
  }

  const envelope = buildDailyBriefing({
    now: input.now,
    windowEndDate,
    firstIncompleteDate,
    dateRows,
    trend: {
      daily: trendDaily,
      hourly: await trendHourly,
    },
    currentQueryEvidence,
    previousQueryEvidence,
    brandTerms: input.brandTerms,
    brandTermsConfirmed: input.brandTermsConfirmed,
  });
  return await verifyDailyBriefing(envelope, input.client, {
    ...(input.budget === undefined ? {} : { budget: input.budget }),
  });
}
