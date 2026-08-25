// @input  -- an injected Search Analytics client, clock and confirmed brand input
// @output -- a daily briefing whose KPI read is required and query attachments soft-fail
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
} from "./report.ts";
import type {
  DailyBriefingDateRow,
  DailyBriefingEnvelope,
  DailyBriefingQueryEvidence,
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

/**
 * Execute the fixed nine-call plan.
 *
 * The date-dimension read is the report: if it fails, there is no honest KPI
 * result and the rejection propagates. The eight attachments only explain
 * which rows deserve attention, so each one degrades independently to null.
 *
 * Two of the eight read the page dimension on its own. Search Console
 * anonymizes low-volume queries but not pages, so these carry click evidence
 * the query reads structurally cannot: one measured property showed 9 of 37
 * weekly clicks at query level and all 37 at page level.
 */
export async function runDailyBriefing(
  input: RunDailyBriefingInput,
): Promise<DailyBriefingEnvelope> {
  const windows = dailyBriefingWindowsFor(input.now);
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
    readPageRows(input.client, windows.current7Days, optionalBudget),
    readPageRows(input.client, windows.previous7Days, optionalBudget),
    readPropertyTotals(input.client, windows.current7Days, "byPage"),
    readPropertyTotals(input.client, windows.previous7Days, "byPage"),
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
    currentQueryEvidence,
    previousQueryEvidence,
    brandTerms: input.brandTerms,
    brandTermsConfirmed: input.brandTermsConfirmed,
  });
}
