// @input  -- an injected Search Analytics client, a clock, and brand terms
// @output -- the finished P0-1 envelope for one property
// @pos    -- the per-run query plan; built, used, and discarded, never stored
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  readPropertyTotals,
  readQueryRows,
  type PropertyTotals,
} from "../gsc-analytics/reader.ts";
import type { ReadBudget } from "../gsc-analytics/reader.ts";
import type { GscQueryClient } from "../gsc-analytics/types.ts";
import { latestFinalWindow } from "../gsc-analytics/window.ts";
import { buildQuickWinsReport } from "./report.ts";
import type { QuickWinsEnvelope } from "./types.ts";

export interface QuickWinsRunInput {
  readonly client: GscQueryClient;
  /** Supplied by the caller so a run is reproducible from its inputs. */
  readonly now: Date;
  readonly brandTerms: readonly string[];
  /** Stops paging once the request has run out of wall clock. */
  readonly budget?: ReadBudget;
}

/**
 * Run P0-1 end to end for one property.
 *
 * The plan is built per run and thrown away with it. There is no cache and no
 * store: this is private search-performance data for someone else's site, and
 * the tool has no storage contract that would justify keeping it.
 *
 * The two reads are issued concurrently because neither depends on the other.
 * They fail differently on purpose. The query read is the measurement — losing
 * it means there is no report, and an empty table returned in its place would
 * read as "we looked and your site is fine". The totals read only sizes the
 * withheld remainder; losing it costs one caveat, so the run continues with
 * the gap reported as unknown rather than as zero.
 */
export async function runQuickWins(
  input: QuickWinsRunInput,
): Promise<QuickWinsEnvelope> {
  const window = latestFinalWindow(input.now);

  const [queryRead, totalsRead] = await Promise.allSettled([
    readQueryRows(input.client, window, input.budget),
    readPropertyTotals(input.client, window),
  ]);

  if (queryRead.status === "rejected") {
    throw queryRead.reason instanceof Error
      ? queryRead.reason
      : new Error(String(queryRead.reason));
  }

  const totals: PropertyTotals | null =
    totalsRead.status === "fulfilled" ? totalsRead.value : null;

  return buildQuickWinsReport({
    window,
    rows: queryRead.value.rows,
    brandTerms: input.brandTerms,
    completedAt: input.now.toISOString(),
    truncated: queryRead.value.paging.truncated,
    queryAggregation: queryRead.value.responseAggregationType,
    ...(totals === null ? {} : { propertyTotals: totals }),
  });
}
