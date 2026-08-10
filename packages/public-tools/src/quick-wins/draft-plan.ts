// @input  -- the evidence table plus the property's page rows and query split
// @output -- at most MAX_DRAFT_ROWS draft tasks, the URLs to crawl, and why the rest were skipped
// @pos    -- decides what a draft run costs BEFORE any page is fetched
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type {
  GscPageRow,
  GscQueryPageRow,
} from "../gsc-analytics/page-reader.ts";
import { selectComparablePage } from "./comparable-page.ts";
import type { QuickWinEvidenceRow } from "./types.ts";

/**
 * Rows that get a draft, at most.
 *
 * Each task means fetching two pages from the visitor's site inside a request
 * they are watching, plus a share of one LLM call. The cap is the budget: it
 * is set here rather than discovered at crawl time so the cost of a run is
 * known before anything is fetched (v3.1 §2.5 — crawling is capped at the top
 * N evidence rows and their comparables, never the whole site).
 */
export const MAX_DRAFT_ROWS = 5;

export type DraftSkipReason =
  /** The query beat its own site's curve; there is no shortfall to work on. */
  | "no_shortfall"
  /** The page split does not cover the query, so no subject page is knowable. */
  | "low_dimension_coverage"
  /** The split names no page we have totals for. */
  | "no_subject_page"
  /** No same-band page earns clearly more with a sample worth trusting. */
  | "no_comparable_high_ctr_page"
  /** Beyond the per-run cap. Not a judgement about the row. */
  | "beyond_draft_cap";

export interface DraftTask {
  readonly query: string;
  readonly bucketId: string;
  readonly subjectPage: string;
  readonly subjectCtr: number;
  readonly comparablePage: string;
  readonly comparableCtr: number;
}

export interface DraftPlan {
  readonly tasks: readonly DraftTask[];
  /** Deduplicated; one comparable page often serves several tasks. */
  readonly urlsToFetch: readonly string[];
  readonly skipped: ReadonlyMap<string, DraftSkipReason>;
}

export interface DraftPlanInput {
  readonly rows: readonly QuickWinEvidenceRow[];
  readonly pages: readonly GscPageRow[];
  readonly queryPages: readonly GscQueryPageRow[];
  readonly coverage: ReadonlyMap<string, number | null>;
}

/**
 * Decide which rows get a draft.
 *
 * Rows are considered largest-shortfall first, so the cap spends the budget
 * where the measured gap is biggest. Every row that does not get a task
 * records why — a row that silently produced nothing is indistinguishable
 * from a row we never looked at, and the surface needs to tell those apart.
 */
export function planDrafts(input: DraftPlanInput): DraftPlan {
  const skipped = new Map<string, DraftSkipReason>();
  const tasks: DraftTask[] = [];

  const candidates = [...input.rows]
    .filter((row) => {
      if (row.clickGap > 0) return true;
      // Not a failure to find something — a page doing better than its own
      // site's curve. Drafting a rewrite for it would be inventing work.
      skipped.set(row.query, "no_shortfall");
      return false;
    })
    .sort((a, b) => b.clickGap - a.clickGap || a.query.localeCompare(b.query));

  for (const row of candidates) {
    // The comparable search runs for every candidate, including rows already
    // past the cap. It is pure arithmetic over rows we have — it fetches
    // nothing — so the run's network cost is still fixed by MAX_DRAFT_ROWS.
    // What it buys is an honest reason: checking the cap first labelled every
    // remaining row "beyond the per-run cap", including rows with no
    // comparable page, which reads as "raise the cap and you get a draft" for
    // rows that would produce nothing at any cap.
    const selection = selectComparablePage({
      query: row.query,
      pages: input.pages,
      queryPages: input.queryPages,
      coverage: input.coverage.get(row.query) ?? null,
    });

    if (selection.kind !== "found") {
      skipped.set(row.query, selection.kind);
      continue;
    }

    if (tasks.length >= MAX_DRAFT_ROWS) {
      skipped.set(row.query, "beyond_draft_cap");
      continue;
    }

    tasks.push({
      query: row.query,
      bucketId: selection.bucketId,
      subjectPage: selection.subjectPage,
      subjectCtr: selection.subjectCtr,
      comparablePage: selection.comparablePage,
      comparableCtr: selection.comparableCtr,
    });
  }

  const urls = new Set<string>();
  for (const task of tasks) {
    urls.add(task.subjectPage);
    urls.add(task.comparablePage);
  }

  return { tasks, urlsToFetch: [...urls], skipped };
}
