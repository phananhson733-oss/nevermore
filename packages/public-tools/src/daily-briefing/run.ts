// @input  -- an injected Search Analytics client, clock and confirmed brand input
// @output -- a daily briefing whose KPI read is required and query attachments soft-fail
// @pos    -- bounded I/O orchestration; transport remains injected by apps/*

import {
  GSC_ROW_LIMIT,
  readPropertyTotals,
  readQueryRows,
  type ReadBudget,
} from "../gsc-analytics/reader.ts";
import { readQueryPageRows } from "../gsc-analytics/page-reader.ts";
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
  /**
   * Shared cancellation seam for failures in the query/query-page read group.
   *
   * Marketing may bind this to one AbortController owned by its transport.
   * A property-totals failure does not invoke it, because totals only size
   * anonymization and must not abort otherwise usable action evidence. The
   * package neither imports nor constructs a transport-specific signal.
   */
  readonly cancelOptionalReads?: () => void;
}

function fulfilledOrNull<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

/**
 * Execute the fixed seven-call plan.
 *
 * The date-dimension read is the report: if it fails, there is no honest KPI
 * result and the rejection propagates. The six query attachments only explain
 * which rows deserve attention, so each one degrades independently to null.
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

  let optionalReadsCancelled = false;
  const optionalBudget: ReadBudget = {
    isExpired: () =>
      optionalReadsCancelled || input.budget?.isExpired() === true,
  };
  const observeOptional = <T>(read: Promise<T>): Promise<T> =>
    read.catch((error: unknown) => {
      if (!optionalReadsCancelled) {
        optionalReadsCancelled = true;
        input.cancelOptionalReads?.();
      }
      throw error;
    });

  const [
    currentQuery,
    previousQuery,
    currentQueryPage,
    previousQueryPage,
    currentTotals,
    previousTotals,
  ] = await Promise.allSettled([
    observeOptional(
      readQueryRows(
        input.client,
        windows.current7Days,
        optionalBudget,
        1,
        "byPage",
      ),
    ),
    observeOptional(
      readQueryRows(
        input.client,
        windows.previous7Days,
        optionalBudget,
        1,
        "byPage",
      ),
    ),
    observeOptional(
      readQueryPageRows(
        input.client,
        windows.current7Days,
        optionalBudget,
        1,
        "auto",
      ),
    ),
    observeOptional(
      readQueryPageRows(
        input.client,
        windows.previous7Days,
        optionalBudget,
        1,
        "auto",
      ),
    ),
    readPropertyTotals(input.client, windows.current7Days, "byPage"),
    readPropertyTotals(input.client, windows.previous7Days, "byPage"),
  ]);

  const currentQueryEvidence: DailyBriefingQueryEvidence = {
    queryRead: fulfilledOrNull(currentQuery),
    queryPageRead: fulfilledOrNull(currentQueryPage),
    propertyTotals: fulfilledOrNull(currentTotals),
  };
  const previousQueryEvidence: DailyBriefingQueryEvidence = {
    queryRead: fulfilledOrNull(previousQuery),
    queryPageRead: fulfilledOrNull(previousQueryPage),
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
