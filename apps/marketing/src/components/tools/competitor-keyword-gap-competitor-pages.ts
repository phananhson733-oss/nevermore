// @input  -- one v3 competitor gap row and the viewer locale
// @output -- rank-ordered competitor pages, the best safe page link, its traffic estimate, and the snapshot date label
// @pos    -- pure row derivations shared by the competitor gap chips and results table

import type {
  CompetitorKeywordGapCompetitorPage,
  CompetitorKeywordGapRow,
} from "@sf/public-tools/competitor-keyword-gap";

import { safePageUrl } from "./competitor-keyword-gap-results-shared";

/** Bounds a provider timestamp we could not parse; long enough for any real DFS format. */
const RAW_SNAPSHOT_DATE_MAX_LENGTH = 40;

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

export interface BestCompetitorPage {
  readonly domain: string;
  readonly rank: number;
  readonly url: string;
}

/**
 * The best-rank competitor's page when known, else any competitor page with a
 * safe URL. The domain travels with the URL because the fallback may name a
 * different competitor than the row's best-rank chip.
 */
export function bestCompetitorPage(
  row: CompetitorKeywordGapRow,
): BestCompetitorPage | null {
  for (const entry of rankedCompetitorPages(row)) {
    const url = safePageUrl(entry.page?.url ?? null);
    if (url !== null) return { domain: entry.domain, rank: entry.rank, url };
  }
  return null;
}

export interface CompetitorTraffic {
  readonly domain: string;
  readonly rank: number;
  readonly value: number;
}

/** Provider traffic estimate for the best-rank competitor's page only; never a fallback to another page. */
export function bestCompetitorTraffic(
  row: CompetitorKeywordGapRow,
): CompetitorTraffic | null {
  const best = rankedCompetitorPages(row)[0];
  if (best === undefined || best.page === null || best.page.etv === null) {
    return null;
  }
  return { domain: best.domain, rank: best.rank, value: best.page.etv };
}

/**
 * Null only when the provider gave no date. A date we cannot parse is shown
 * verbatim (bounded) so format drift reads as "unreadable", never "undated".
 */
export function snapshotDate(
  value: string | null,
  locale: string,
): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value.slice(0, RAW_SNAPSHOT_DATE_MAX_LENGTH);
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}
