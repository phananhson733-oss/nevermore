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
import type { GscQueryRow } from "../site-baseline/types.ts";
import { latestFinalWindow } from "../gsc-analytics/window.ts";
import {
  readPageRows,
  readQueryPageRows,
  queryPageCoverage,
} from "../gsc-analytics/page-reader.ts";
import { planDrafts } from "./draft-plan.ts";
import { runDrafts, type DraftRunDependencies } from "./draft-run.ts";
import { buildQuickWinsReport } from "./report.ts";
import type {
  QuickWinEvidenceRow,
  QuickWinsDraftView,
  QuickWinsEnvelope,
} from "./types.ts";

export interface QuickWinsRunInput {
  readonly client: GscQueryClient;
  /** Supplied by the caller so a run is reproducible from its inputs. */
  readonly now: Date;
  readonly brandTerms: readonly string[];
  /** Stops paging once the request has run out of wall clock. */
  readonly budget?: ReadBudget;
  /**
   * Crawl and model seams for Title/Meta drafts.
   *
   * Omitted when the deployment has no model configured. The run then
   * produces the evidence table and no drafts, which is a complete result —
   * drafts are an attachment to a row, never the row itself.
   */
  readonly draftDependencies?: DraftRunDependencies;
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

  const evidence = buildQuickWinsReport({
    window,
    rows: queryRead.value.rows,
    brandTerms: input.brandTerms,
    completedAt: input.now.toISOString(),
    truncated: queryRead.value.paging.truncated,
    queryAggregation: queryRead.value.responseAggregationType,
    ...(totals === null ? {} : { propertyTotals: totals }),
  });

  if (input.draftDependencies === undefined) return evidence;

  const drafted = await attachDrafts(
    input,
    window,
    evidence.result.rows,
    // The REAL query rows, so coverage is measured against real impressions.
    queryRead.value.rows,
    input.draftDependencies,
  );

  return buildQuickWinsReport({
    window,
    rows: queryRead.value.rows,
    brandTerms: input.brandTerms,
    completedAt: input.now.toISOString(),
    truncated: queryRead.value.paging.truncated,
    queryAggregation: queryRead.value.responseAggregationType,
    ...(totals === null ? {} : { propertyTotals: totals }),
    drafts: drafted.drafts,
    draftsSkipped: drafted.skipped,
  });
}

/**
 * Produce drafts for the rows worth drafting, or explain why none were.
 *
 * Runs AFTER the evidence table, on purpose: the table is the product and it
 * must not be delayed or endangered by a crawl. Every failure here degrades
 * to "no draft, and here is why" — the caller already holds a complete
 * report before this is called.
 */
async function attachDrafts(
  input: QuickWinsRunInput,
  window: ReturnType<typeof latestFinalWindow>,
  rows: readonly QuickWinEvidenceRow[],
  queryRows: readonly GscQueryRow[],
  dependencies: DraftRunDependencies,
): Promise<{
  readonly drafts: readonly QuickWinsDraftView[];
  readonly skipped: Record<string, string>;
}> {
  const skipped: Record<string, string> = {};
  if (rows.length === 0) return { drafts: [], skipped };

  const [pageRead, queryPageRead] = await Promise.allSettled([
    readPageRows(input.client, window, input.budget),
    readQueryPageRows(input.client, window, input.budget),
  ]);

  // Either read failing costs the drafts, never the report.
  if (pageRead.status !== "fulfilled" || queryPageRead.status !== "fulfilled") {
    for (const row of rows) skipped[row.query] = "page_dimension_unavailable";
    return { drafts: [], skipped };
  }

  const plan = planDrafts({
    rows,
    pages: pageRead.value.rows,
    queryPages: queryPageRead.value.rows,
    // Measured against the query rows' real impressions. Passing a stand-in
    // denominator here would make every split look like it over-covers, and
    // every row would silently fall out as low_dimension_coverage.
    coverage: queryPageCoverage(queryRows, queryPageRead.value.rows),
  });
  for (const [query, reason] of plan.skipped) skipped[query] = reason;

  const run = await runDrafts(plan.tasks, dependencies);
  for (const [query, reason] of run.failed) skipped[query] = reason;

  return {
    drafts: run.drafts.map((d) => ({
      query: d.query,
      subjectPage: d.subjectPage,
      title: d.title,
      metaDescription: d.metaDescription,
      comparablePage: d.comparablePage,
    })),
    skipped,
  };
}
