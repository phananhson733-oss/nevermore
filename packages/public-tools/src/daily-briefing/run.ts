// @input  -- an injected Search Analytics client, clock and confirmed brand input
// @output -- a daily briefing with required final action evidence and optional trend reads
// @pos    -- bounded I/O orchestration; transport remains injected by apps/*

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
import {
  buildDailyBriefing,
  dailyBriefingWindowsFor,
  dailyBriefingTrendWindowsFor,
} from "./report.ts";
import type {
  DailyBriefingDateRow,
  DailyBriefingEnvelope,
  DailyBriefingQueryEvidence,
  DailyBriefingTrendRead,
} from "./types.ts";

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
 * Execute the fixed eleven-call plan.
 *
 * The date-dimension read is the report: if it fails, there is no honest KPI
 * result and the rejection propagates. The ten attachments either explain
 * rows or visualise fresh traffic, so each one degrades independently to null.
 *
 * Two query-explanation attachments read the page dimension on its own.
 * Search Console anonymizes low-volume queries but not pages, so these carry
 * click evidence the query reads structurally cannot: one measured property
 * showed 9 of 37 weekly clicks at query level and all 37 at page level.
 */
export async function runDailyBriefing(
  input: RunDailyBriefingInput,
): Promise<DailyBriefingEnvelope> {
  const windows = dailyBriefingWindowsFor(input.now);
  const trendWindows = dailyBriefingTrendWindowsFor(input.now);
  const dateResponse = await input.client({
    dimensions: ["date"],
    startDate: windows.readRange.startDate,
    endDate: windows.readRange.endDate,
    rowLimit: GSC_ROW_LIMIT,
    startRow: 0,
  });

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

  // Each attachment carries its own request timeout and shares the run
  // budget, so a failed one is left to settle alone. Cancelling its siblings
  // used to be harmless because every derived signal needed all four reads;
  // now a query lane stands on its query rows alone, and aborting a sibling
  // still in flight deletes the very evidence that survived the failure.
  const optionalBudget: ReadBudget = {
    isExpired: () => input.budget?.isExpired() === true,
  };

  const [
    currentQuery,
    previousQuery,
    currentQueryPage,
    previousQueryPage,
    currentPage,
    previousPage,
    currentTotals,
    previousTotals,
    trendDaily,
    trendHourly,
  ] = await Promise.allSettled([
    readQueryRows(
      input.client,
      windows.current7Days,
      optionalBudget,
      1,
      "byPage",
    ),
    readQueryRows(
      input.client,
      windows.previous7Days,
      optionalBudget,
      1,
      "byPage",
    ),
    readQueryPageRows(
      input.client,
      windows.current7Days,
      optionalBudget,
      1,
      "auto",
    ),
    readQueryPageRows(
      input.client,
      windows.previous7Days,
      optionalBudget,
      1,
      "auto",
    ),
    readPageRows(input.client, windows.current7Days, optionalBudget, "byPage"),
    readPageRows(input.client, windows.previous7Days, optionalBudget, "byPage"),
    readPropertyTotals(input.client, windows.current7Days, "byPage"),
    readPropertyTotals(input.client, windows.previous7Days, "byPage"),
    input.client({
      dimensions: ["date"],
      startDate: trendWindows.daily.startDate,
      endDate: trendWindows.daily.endDate,
      rowLimit: GSC_ROW_LIMIT,
      startRow: 0,
      dataState: "all",
    }),
    input.client({
      dimensions: ["hour"],
      startDate: trendWindows.hourly.startDate,
      endDate: trendWindows.hourly.endDate,
      rowLimit: GSC_ROW_LIMIT,
      startRow: 0,
      dataState: "hourly_all",
    }),
  ]);

  const currentQueryEvidence: DailyBriefingQueryEvidence = {
    queryRead: fulfilledOrNull(currentQuery),
    queryPageRead: fulfilledOrNull(currentQueryPage),
    pageRead: fulfilledOrNull(currentPage),
    propertyTotals: fulfilledOrNull(currentTotals),
  };
  const previousQueryEvidence: DailyBriefingQueryEvidence = {
    queryRead: fulfilledOrNull(previousQuery),
    queryPageRead: fulfilledOrNull(previousQueryPage),
    pageRead: fulfilledOrNull(previousPage),
    propertyTotals: fulfilledOrNull(previousTotals),
  };

  return buildDailyBriefing({
    now: input.now,
    dateRows,
    trend: {
      daily:
        trendDaily.status === "fulfilled"
          ? trendReadFrom(trendDaily.value)
          : null,
      hourly:
        trendHourly.status === "fulfilled"
          ? trendReadFrom(trendHourly.value)
          : null,
    },
    currentQueryEvidence,
    previousQueryEvidence,
    brandTerms: input.brandTerms,
    brandTermsConfirmed: input.brandTermsConfirmed,
  });
}
