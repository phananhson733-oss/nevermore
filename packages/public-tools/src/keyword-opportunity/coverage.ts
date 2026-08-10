// @input  -- the site's own Search Console query rows and its crawled page titles
// @output -- a four-state read on whether the site already serves a candidate
// @pos    -- stops the tool recommending pages the site already has
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { normalizeQuery } from "../site-baseline/normalize.ts";
import type { KeywordOpportunityCoverage } from "./types.ts";

/**
 * Impressions a query needs before its position carries any weight.
 *
 * Below this one lucky impression would decide the coverage state.
 */
export const KEYWORD_COVERAGE_MIN_IMPRESSIONS = 10;

/**
 * Impression-weighted position at or *below* which coverage counts as strong.
 *
 * Positions count upward from the top of the page, so a smaller number is the
 * better placement: 10 means the site is already on page one for the query.
 */
export const KEYWORD_COVERAGE_STRONG_POSITION = 10;

/** Share of a candidate's tokens a page title must carry to look related. */
export const KEYWORD_COVERAGE_TOKEN_OVERLAP = 0.8;

export interface KeywordCoverageQueryRow {
  readonly query: string;
  readonly impressions: number;
  readonly position: number;
}

/** One crawled page reduced to the tokens it visibly targets. */
export interface KeywordCoveragePage {
  readonly url: string;
  readonly tokens: ReadonlySet<string>;
}

export interface KeywordCoverageObservation {
  readonly state: KeywordOpportunityCoverage;
  readonly supportingPageUrl: string | null;
}

const TOKEN_PATTERN = /[\p{Letter}\p{Number}]+/gu;

/** Split text into comparable word tokens, accents and CJK included. */
export function keywordTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(TOKEN_PATTERN) ?? []);
}

interface ExactObservation {
  readonly impressions: number;
  /**
   * Impressions-weighted position across the window.
   *
   * Taking the best row instead would let one incidental first-place
   * impression mark a query as strongly covered, which then hides a real
   * opening from the reader for the rest of the run.
   */
  readonly weightedPosition: number;
}

/**
 * Fold Search Console rows into one weighted observation per normalized query.
 */
export function buildKeywordCoverageIndex(
  rows: readonly KeywordCoverageQueryRow[],
): ReadonlyMap<string, ExactObservation> {
  const totals = new Map<string, { impressions: number; weighted: number }>();
  for (const row of rows) {
    if (row.impressions <= 0) continue;
    const key = normalizeQuery(row.query);
    const current = totals.get(key) ?? { impressions: 0, weighted: 0 };
    totals.set(key, {
      impressions: current.impressions + row.impressions,
      weighted: current.weighted + row.position * row.impressions,
    });
  }

  const index = new Map<string, ExactObservation>();
  for (const [key, total] of totals) {
    index.set(key, {
      impressions: total.impressions,
      weightedPosition: total.weighted / total.impressions,
    });
  }
  return index;
}

function relatedPage(
  keyword: string,
  pages: readonly KeywordCoveragePage[],
): string | null {
  const wanted = keywordTokens(keyword);
  if (wanted.size === 0) return null;
  for (const page of pages) {
    let hits = 0;
    for (const token of wanted) {
      if (page.tokens.has(token)) hits += 1;
    }
    if (hits / wanted.size >= KEYWORD_COVERAGE_TOKEN_OVERLAP) return page.url;
  }
  return null;
}

/**
 * Read coverage for one candidate.
 *
 * Search Console evidence outranks title similarity because it is the site's
 * own measured serving rather than a guess from words on a page. Similarity
 * alone can only reach `related_coverage_unverified`; it never hard-filters a
 * candidate, since two pages sharing vocabulary is not proof either one ranks.
 *
 * Absence resolves to `not_observed_in_gsc_query_sample`, spelled out in full
 * because Search Console withholds a large share of queries — the tool has not
 * shown the term is uncovered, only that it did not see it.
 */
export function observeKeywordCoverage(
  keyword: string,
  exactIndex: ReadonlyMap<string, ExactObservation>,
  pages: readonly KeywordCoveragePage[],
): KeywordCoverageObservation {
  const exact = exactIndex.get(normalizeQuery(keyword));
  if (
    exact !== undefined &&
    exact.impressions >= KEYWORD_COVERAGE_MIN_IMPRESSIONS
  ) {
    return {
      state:
        exact.weightedPosition <= KEYWORD_COVERAGE_STRONG_POSITION
          ? "observed_exact_strong"
          : "observed_exact_weak",
      supportingPageUrl: relatedPage(keyword, pages),
    };
  }

  const related = relatedPage(keyword, pages);
  if (related !== null) {
    return { state: "related_coverage_unverified", supportingPageUrl: related };
  }

  return {
    state: "not_observed_in_gsc_query_sample",
    supportingPageUrl: null,
  };
}

/**
 * Whether coverage is settled enough to withhold the row.
 *
 * Only measured Search Console serving qualifies. Title overlap stays visible
 * and labelled, because hiding a row on a lexical guess loses real openings —
 * and the Tranche 1 spike showed lexical overlap alone misfires badly when the
 * crawl never reached the site's product pages.
 */
export function isKeywordAlreadyCovered(
  state: KeywordOpportunityCoverage,
): boolean {
  return state === "observed_exact_strong" || state === "observed_exact_weak";
}
