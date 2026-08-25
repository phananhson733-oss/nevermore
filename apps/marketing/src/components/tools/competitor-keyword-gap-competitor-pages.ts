// @input  -- one v3 competitor gap row and the viewer locale
// @output -- rank-ordered competitor pages, the best safe page URL and its domain, the best-rank traffic estimate, and the snapshot date label
// @pos    -- pure row derivations shared by the competitor gap chips and results table

import type {
  CompetitorKeywordGapCompetitorPage,
  CompetitorKeywordGapRow,
} from "@sf/public-tools/competitor-keyword-gap";

import { safePageUrl } from "./competitor-keyword-gap-results-shared";

export interface RankedCompetitorPage {
  readonly domain: string;
  readonly rank: number;
  readonly page: CompetitorKeywordGapCompetitorPage | null;
}

/** Competitors by provider rank, best first; ties break on domain so the order is stable. */
export function rankedCompetitorPages(
  row: CompetitorKeywordGapRow,
): readonly RankedCompetitorPage[] {
  return Object.entries(row.competitorRanks)
    .map(([domain, rank]) => ({
      domain,
      rank,
      page: row.competitorPages[domain] ?? null,
    }))
    .sort((a, b) => a.rank - b.rank || a.domain.localeCompare(b.domain));
}

export function competitorLink(
  row: CompetitorKeywordGapRow,
  domain: string,
): string | null {
  return safePageUrl(row.competitorPages[domain]?.url ?? null);
}

/**
 * The best-rank competitor's page URL when known and safe, else any competitor
 * page with a safe URL.
 */
export function bestCompetitorPageUrl(
  row: CompetitorKeywordGapRow,
): string | null {
  for (const entry of rankedCompetitorPages(row)) {
    const url = safePageUrl(entry.page?.url ?? null);
    if (url !== null) return url;
  }
  return null;
}

/**
 * The domain whose page `bestCompetitorPageUrl` returned, so a button can name
 * where it is about to send the reader. Kept next to that function because the
 * two must agree: naming one competitor and opening another's page is exactly
 * the kind of quiet mismatch a link label is trusted not to have.
 */
export function bestCompetitorPageDomain(
  row: CompetitorKeywordGapRow,
): string | null {
  for (const entry of rankedCompetitorPages(row)) {
    if (safePageUrl(entry.page?.url ?? null) !== null) return entry.domain;
  }
  return null;
}

/** Provider traffic estimate for the best-rank competitor's page only; never a fallback to another page. */
export function bestCompetitorTrafficEstimate(
  row: CompetitorKeywordGapRow,
): number | null {
  const best = rankedCompetitorPages(row)[0];
  if (best === undefined || best.page === null) return null;
  return best.page.etv;
}

/**
 * Null when the provider gave no date or one this runtime cannot parse; the
 * caller renders the undated label in both cases rather than throwing.
 */
export function snapshotDate(
  value: string | null,
  locale: string,
): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}
