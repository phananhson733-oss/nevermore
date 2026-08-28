// @input  -- the primary keyword and the Search Console rows a brief run read
// @output -- the create / update / undecidable verdict and the ledger rows behind it
// @pos    -- the one place the self-competition rule lives; pure, deterministic, shared by producer and parser
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  SELF_COMPETE_MAX_POSITION,
  SELF_COMPETE_MIN_IMPRESSIONS,
} from "./constants.ts";
import type { BriefGscQueryPageRow, GscReadMeta, Verdict } from "./contract.ts";

/**
 * Why the verdict only looks at the primary keyword.
 *
 * Supporting keywords are things the article should cover, not things the
 * visitor is deciding whether to write a new page for. Mixing them in would
 * let the highest-impression supporting term pick the page and the copy would
 * then say "you already rank for this" about a different query. v1 also keeps
 * the three-state shape on purpose (Owner ruling of 2026-08-28); the four-state
 * arbitration is v2.
 *
 * Two entry points, one decision table. `computeVerdict` runs on the raw
 * reader rows and produces both the verdict and the read metadata; the
 * parser, which only has the brief, calls `deriveVerdictFromLedger` on the
 * ledger + that metadata. Both go through `decide`, so the producer cannot
 * emit a verdict the parser derives differently.
 */

export interface VerdictQueryRow {
  readonly query: string;
  readonly impressions: number;
  readonly position: number;
}

export interface VerdictQueryPageRow {
  readonly query: string;
  readonly page: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number;
}

export interface VerdictInput {
  readonly primary: string;
  readonly queryRows: readonly VerdictQueryRow[];
  readonly queryPageRows: readonly VerdictQueryPageRow[];
  /** From page-reader: true when the query read stopped before the last page. */
  readonly queryPagingTruncated: boolean;
  readonly queryUnreadableRows: number;
  /** queryPageCoverage(queryRows, queryPageRows).get(key), or undefined when key is absent. */
  readonly coverageOf: (query: string) => number | null | undefined;
  readonly minDimensionCoverage: number;
}

type AvailableGscRead = Extract<GscReadMeta, { status: "complete" | "partial" }>;
type PrimaryCoverage = AvailableGscRead["primary_coverage"];

export interface VerdictResult {
  readonly verdict: Verdict;
  /** The primary keyword's query×page rows, position normalised (never 0). */
  readonly ledgerRows: BriefGscQueryPageRow[];
  readonly primaryCoverage: PrimaryCoverage;
  readonly matchedQueries: number;
}

const GSC_HEURISTIC = { method: "heuristic", origin: "gsc" } as const;

export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

/** The reader turns a missing position into 0; 0 (or anything non-positive) is "unknown". */
export function normalizePosition(position: number): number | null {
  return Number.isFinite(position) && position > 0 ? position : null;
}

/** UTF-16 code-unit order: locale-independent, the same ordering canonical keys use. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface PageAggregate {
  readonly page: string;
  readonly impressions: number;
  readonly rows: number;
  readonly rows_with_position: number;
  readonly avg_position: number | null;
}

/**
 * One (query, page) pair is one row, so several rows for a page only appear
 * when the primary keyword has spelling variants. Positions are weighted by
 * the impressions of the rows that actually carry one; rows without one count
 * toward `rows` but not `rows_with_position`, and the page prints that ratio.
 */
export function aggregateByPage(rows: readonly BriefGscQueryPageRow[]): PageAggregate[] {
  const byPage = new Map<
    string,
    { impressions: number; rows: number; withPosition: number; weighted: number; weight: number }
  >();
  for (const row of rows) {
    const current = byPage.get(row.page) ?? { impressions: 0, rows: 0, withPosition: 0, weighted: 0, weight: 0 };
    byPage.set(row.page, {
      impressions: current.impressions + row.impressions,
      rows: current.rows + 1,
      withPosition: current.withPosition + (row.position === null ? 0 : 1),
      weighted: current.weighted + (row.position === null ? 0 : row.position * row.impressions),
      weight: current.weight + (row.position === null ? 0 : row.impressions),
    });
  }
  return [...byPage.entries()]
    .map(([page, value]) => ({
      page,
      impressions: value.impressions,
      rows: value.rows,
      rows_with_position: value.withPosition,
      avg_position: value.withPosition === 0 || value.weight === 0 ? null : value.weighted / value.weight,
    }))
    .sort((a, b) => b.impressions - a.impressions || compareCodeUnits(a.page, b.page));
}

/* ------------------------------------------------------------------ */
/* the decision table                                                   */
/* ------------------------------------------------------------------ */

interface DecisionInput {
  readonly matchedQueries: number;
  readonly primaryCoverage: PrimaryCoverage;
  readonly queryTruncated: boolean;
  readonly queryUnreadableRows: number;
  readonly ledgerRows: readonly BriefGscQueryPageRow[];
  readonly minDimensionCoverage: number;
}

function decide(input: DecisionInput): Verdict {
  if (input.matchedQueries === 0) {
    if (input.queryTruncated || input.queryUnreadableRows > 0) {
      return { action: "undecidable", reason: "gsc_partial", provenance: GSC_HEURISTIC };
    }
    return { action: "create", reason: "not_observed", existing: null, provenance: GSC_HEURISTIC };
  }
  const pages = aggregateByPage(input.ledgerRows);
  const best = pages[0] ?? null;
  const coverage = input.primaryCoverage;
  if (coverage.ratio === null) {
    if (coverage.reason === "no_query_impressions") {
      return {
        action: "create",
        reason: "below_impression_floor",
        existing:
          best === null
            ? null
            : { page: best.page, impressions: best.impressions, rows: best.rows, rows_with_position: best.rows_with_position, avg_position: best.avg_position },
        provenance: GSC_HEURISTIC,
      };
    }
    // split_exceeds_total, or a query_not_in_sample that contradicts matchedQueries > 0.
    return { action: "undecidable", reason: "gsc_inconsistent", provenance: GSC_HEURISTIC };
  }
  if (coverage.ratio < input.minDimensionCoverage) {
    return { action: "undecidable", reason: "gsc_partial", provenance: GSC_HEURISTIC };
  }
  if (best === null) {
    return { action: "create", reason: "not_observed", existing: null, provenance: GSC_HEURISTIC };
  }
  const existing = { page: best.page, impressions: best.impressions, rows: best.rows, rows_with_position: best.rows_with_position };
  if (best.impressions < SELF_COMPETE_MIN_IMPRESSIONS) {
    return { action: "create", reason: "below_impression_floor", existing: { ...existing, avg_position: best.avg_position }, provenance: GSC_HEURISTIC };
  }
  if (best.avg_position === null) {
    return { action: "undecidable", reason: "position_unavailable", provenance: GSC_HEURISTIC };
  }
  if (best.avg_position <= SELF_COMPETE_MAX_POSITION) {
    return {
      action: "update",
      reason: "self_compete",
      target_url: best.page,
      observed: { ...existing, avg_position: best.avg_position, rows_with_position: best.rows_with_position },
      provenance: GSC_HEURISTIC,
    };
  }
  return { action: "create", reason: "beyond_position_cap", existing: { ...existing, avg_position: best.avg_position }, provenance: GSC_HEURISTIC };
}

/* ------------------------------------------------------------------ */
/* producer entry                                                       */
/* ------------------------------------------------------------------ */

export function computeVerdict(input: VerdictInput): VerdictResult {
  const target = normalizeQuery(input.primary);
  const matchingQueries = input.queryRows.filter((row) => normalizeQuery(row.query) === target);
  const keys = new Set(matchingQueries.map((row) => row.query));
  const ledgerRows: BriefGscQueryPageRow[] = input.queryPageRows
    .filter((row) => keys.has(row.query))
    .map((row) => ({
      query: row.query,
      page: row.page,
      clicks: row.clicks,
      impressions: row.impressions,
      position: normalizePosition(row.position),
    }));
  const matchedQueries = keys.size;

  let primaryCoverage: PrimaryCoverage;
  if (keys.size === 0) {
    primaryCoverage = { ratio: null, reason: "query_not_in_sample" };
  } else {
    // Coverage is taken on the highest-impression spelling of the primary keyword.
    const keyRow = [...matchingQueries].sort(
      (a, b) => b.impressions - a.impressions || compareCodeUnits(a.query, b.query),
    )[0];
    if (keyRow === undefined) throw new Error("unreachable: keys is non-empty");
    const coverage = input.coverageOf(keyRow.query);
    if (typeof coverage === "number") {
      primaryCoverage = { ratio: coverage };
    } else if (!(Number.isFinite(keyRow.impressions) && keyRow.impressions > 0)) {
      primaryCoverage = { ratio: null, reason: "no_query_impressions" };
    } else {
      primaryCoverage = { ratio: null, reason: "split_exceeds_total" };
    }
  }

  const verdict = decide({
    matchedQueries,
    primaryCoverage,
    queryTruncated: input.queryPagingTruncated,
    queryUnreadableRows: input.queryUnreadableRows,
    ledgerRows,
    minDimensionCoverage: input.minDimensionCoverage,
  });
  return { verdict, ledgerRows, primaryCoverage, matchedQueries };
}

/* ------------------------------------------------------------------ */
/* parser entry                                                         */
/* ------------------------------------------------------------------ */

/**
 * What the parser can prove from the brief alone. The raw query rows are not
 * in the ledger, so `matched_queries` and `primary_coverage` are taken from
 * `reads.gsc` as reported; everything downstream of them is recomputed.
 */
export function deriveVerdictFromLedger(input: {
  readonly reads: GscReadMeta;
  readonly rows: readonly BriefGscQueryPageRow[];
  readonly minDimensionCoverage: number;
}): Verdict {
  const { reads } = input;
  if (reads.status === "unavailable") {
    return reads.reason === "not_requested"
      ? { action: "undecidable", reason: "no_gsc_property", provenance: null }
      : { action: "undecidable", reason: "gsc_unavailable", provenance: GSC_HEURISTIC };
  }
  return decide({
    matchedQueries: reads.matched_queries,
    primaryCoverage: reads.primary_coverage,
    queryTruncated: reads.truncated.includes("query"),
    queryUnreadableRows: reads.unreadable_rows.query,
    ledgerRows: input.rows,
    minDimensionCoverage: input.minDimensionCoverage,
  });
}
