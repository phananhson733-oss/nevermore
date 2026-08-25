// @input  -- normalized scope plus one sanitized DFS outcome per competitor and optional GSC rows
// @output -- one deterministic, versioned competitor keyword gap report
// @pos    -- pure merger that keeps provider failure, silence, zero, and first-party evidence distinct

import {
  COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
  COMPETITOR_KEYWORD_GAP_TOOL,
} from "./types.ts";
import type {
  CompetitorKeywordGapCompetitorCoverage,
  CompetitorKeywordGapEnvelope,
  CompetitorKeywordGapGscEvidence,
  CompetitorKeywordGapGscOverlayStatus,
  CompetitorKeywordGapMetric,
  CompetitorKeywordGapRow,
  CompetitorKeywordGapRunStatus,
} from "./types.ts";

export interface CompetitorKeywordGapProviderRow {
  readonly keyword: string;
  readonly searchVolume: number | null;
  readonly cpc: number | null;
  readonly keywordDifficulty: number | null;
  readonly providerIntent: string | null;
  readonly firstDomainRank: number;
  readonly secondDomainRank: number | null;
}

/** Sanitized provider outcome. Credentials and raw provider JSON never enter here. */
export interface CompetitorKeywordGapDataForSeoResult {
  readonly domain: string;
  readonly status: "complete" | "unavailable";
  readonly rows: readonly CompetitorKeywordGapProviderRow[];
  readonly totalCount: number | null;
  readonly costUsd: number | null;
  readonly providerStatusCode: number | null;
  readonly taskStatusCode: number | null;
  readonly failureCode?: string;
}

export interface CompetitorKeywordGapGscQueryRow {
  readonly query: string;
  readonly impressions: number;
  readonly position: number;
}

export interface CompetitorKeywordGapGscQueryPageRow
  extends CompetitorKeywordGapGscQueryRow {
  readonly page: string;
}

export interface CompetitorKeywordGapGscRead {
  readonly status: "available" | "unavailable";
  readonly queryRows: readonly CompetitorKeywordGapGscQueryRow[];
  readonly queryPageRows: readonly CompetitorKeywordGapGscQueryPageRow[];
  readonly queryTruncated: boolean;
  readonly queryPageTruncated: boolean;
}

export interface CompetitorKeywordGapReportInput {
  readonly completedAt: string;
  readonly siteDomain: string;
  readonly marketCode: string;
  readonly languageCode: string;
  readonly competitorDomains: readonly string[];
  readonly competitors: readonly CompetitorKeywordGapDataForSeoResult[];
  readonly gsc: CompetitorKeywordGapGscRead | null;
}

interface ProviderEvidence {
  readonly domain: string;
  readonly rank: number;
  readonly rowIndex: number;
  readonly row: CompetitorKeywordGapProviderRow;
}

interface MutableAggregate {
  readonly key: string;
  readonly ranks: Map<string, number>;
  readonly displaysByDomain: Map<string, string>;
  readonly evidence: ProviderEvidence[];
}

interface GscQueryAggregate {
  impressions: number;
  weightedPositions: number;
}

const GSC_STRONG_POSITION_MAX = 10;
const GSC_STRONG_IMPRESSIONS_MIN = 10;

/** Normalize only the casing and whitespace providers are free to change. */
export function competitorKeywordGapKey(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, " ");
}

function displayKeyword(keyword: string): string {
  return keyword.trim().replace(/\s+/g, " ");
}

function boundedMetric(value: number | null): CompetitorKeywordGapMetric {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return Object.freeze({
      availability: "provider_no_data",
      value: null,
    });
  }
  if (value === 0) {
    return Object.freeze({ availability: "explicit_zero", value: 0 });
  }
  return Object.freeze({ availability: "available", value });
}

function compareEvidence(a: ProviderEvidence, b: ProviderEvidence): number {
  return (
    a.rank - b.rank ||
    a.domain.localeCompare(b.domain) ||
    a.rowIndex - b.rowIndex
  );
}

function metricFrom(
  evidence: readonly ProviderEvidence[],
  read: (row: CompetitorKeywordGapProviderRow) => number | null,
): CompetitorKeywordGapMetric {
  for (const item of evidence) {
    const value = read(item.row);
    if (value !== null && Number.isFinite(value) && value >= 0) {
      return boundedMetric(value);
    }
  }
  return boundedMetric(null);
}

function intentFrom(evidence: readonly ProviderEvidence[]): string | null {
  for (const item of evidence) {
    const intent = item.row.providerIntent?.trim();
    if (intent) return intent;
  }
  return null;
}

function queryAggregates(
  gsc: CompetitorKeywordGapGscRead | null,
): ReadonlyMap<string, GscQueryAggregate> {
  const aggregates = new Map<string, GscQueryAggregate>();
  if (gsc?.status !== "available") return aggregates;

  for (const row of gsc.queryRows) {
    const key = competitorKeywordGapKey(row.query);
    if (
      key === "" ||
      !Number.isFinite(row.impressions) ||
      row.impressions <= 0 ||
      !Number.isFinite(row.position) ||
      row.position < 0
    ) {
      continue;
    }
    const current = aggregates.get(key) ?? {
      impressions: 0,
      weightedPositions: 0,
    };
    current.impressions += row.impressions;
    current.weightedPositions += row.position * row.impressions;
    aggregates.set(key, current);
  }
  return aggregates;
}

function supportingPage(
  key: string,
  gsc: CompetitorKeywordGapGscRead | null,
): string | null {
  if (gsc?.status !== "available" || gsc.queryPageTruncated) return null;

  const candidates = gsc.queryPageRows
    .filter(
      (row) =>
        competitorKeywordGapKey(row.query) === key &&
        row.page.trim() !== "" &&
        Number.isFinite(row.impressions) &&
        row.impressions > 0 &&
        Number.isFinite(row.position) &&
        row.position >= 0,
    )
    .toSorted(
      (a, b) =>
        b.impressions - a.impressions ||
        a.position - b.position ||
        a.page.localeCompare(b.page),
    );

  return candidates[0]?.page ?? null;
}

function gscEvidence(
  key: string,
  gsc: CompetitorKeywordGapGscRead | null,
  queries: ReadonlyMap<string, GscQueryAggregate>,
): CompetitorKeywordGapGscEvidence {
  const pageUrl = supportingPage(key, gsc);
  const nextStep =
    pageUrl === null ? "review_content_gap" : "optimize_existing";

  if (gsc?.status !== "available") {
    return Object.freeze({
      queryStatus: "gsc_query_sample_not_read",
      queryImpressions: null,
      queryPosition: null,
      pageUrl: null,
      nextStep: "review_content_gap",
    });
  }

  const observation = queries.get(key);
  if (observation === undefined) {
    return Object.freeze({
      queryStatus: gsc.queryTruncated
        ? "gsc_query_sample_not_read"
        : "not_observed_in_gsc_query_sample",
      queryImpressions: null,
      queryPosition: null,
      pageUrl,
      nextStep,
    });
  }

  const position =
    observation.weightedPositions / observation.impressions;
  const strong =
    observation.impressions >= GSC_STRONG_IMPRESSIONS_MIN &&
    position <= GSC_STRONG_POSITION_MAX;
  return Object.freeze({
    queryStatus: strong ? "observed_strong" : "observed_weak",
    queryImpressions: observation.impressions,
    queryPosition: position,
    pageUrl,
    nextStep,
  });
}

function overlayStatus(
  gsc: CompetitorKeywordGapGscRead | null,
): CompetitorKeywordGapGscOverlayStatus {
  if (gsc === null) return "not_requested";
  if (gsc.status === "unavailable") return "unavailable";
  return gsc.queryTruncated || gsc.queryPageTruncated
    ? "partial"
    : "available";
}

function runStatus(
  completed: number,
  requested: number,
  gscStatus: CompetitorKeywordGapGscOverlayStatus,
): CompetitorKeywordGapRunStatus {
  if (completed === 0) return "unavailable";
  return completed === requested &&
    (gscStatus === "not_requested" || gscStatus === "available")
    ? "complete"
    : "partial";
}

function rowSort(a: CompetitorKeywordGapRow, b: CompetitorKeywordGapRow) {
  if (a.competitorCount !== b.competitorCount) {
    return b.competitorCount - a.competitorCount;
  }
  if (a.bestCompetitorRank !== b.bestCompetitorRank) {
    return a.bestCompetitorRank - b.bestCompetitorRank;
  }
  const aVolume = a.searchVolume.value;
  const bVolume = b.searchVolume.value;
  if (aVolume === null && bVolume !== null) return 1;
  if (aVolume !== null && bVolume === null) return -1;
  if (aVolume !== null && bVolume !== null && aVolume !== bVolume) {
    return bVolume - aVolume;
  }
  return competitorKeywordGapKey(a.keyword).localeCompare(
    competitorKeywordGapKey(b.keyword),
  );
}

export function buildCompetitorKeywordGapReport(
  input: CompetitorKeywordGapReportInput,
): CompetitorKeywordGapEnvelope {
  const providerByDomain = new Map<string, CompetitorKeywordGapDataForSeoResult>();
  for (const result of input.competitors) {
    if (!providerByDomain.has(result.domain)) {
      providerByDomain.set(result.domain, result);
    }
  }

  const aggregates = new Map<string, MutableAggregate>();
  const competitorCoverage: CompetitorKeywordGapCompetitorCoverage[] = [];

  for (const domain of input.competitorDomains) {
    const provider = providerByDomain.get(domain);
    if (provider?.status !== "complete") {
      competitorCoverage.push(
        Object.freeze({
          domain,
          status: "unavailable",
          returnedRows: 0,
          totalCount: null,
          truncated: false,
          failureCode: "keyword_source_unavailable",
        }),
      );
      continue;
    }

    competitorCoverage.push(
      Object.freeze({
        domain,
        status: "complete",
        returnedRows: provider.rows.length,
        totalCount: provider.totalCount,
        truncated:
          provider.totalCount !== null &&
          provider.totalCount > provider.rows.length,
        failureCode: null,
      }),
    );

    provider.rows.forEach((row, rowIndex) => {
      const key = competitorKeywordGapKey(row.keyword);
      const displayed = displayKeyword(row.keyword);
      if (
        key === "" ||
        displayed === "" ||
        !Number.isFinite(row.firstDomainRank) ||
        row.firstDomainRank <= 0 ||
        row.secondDomainRank !== null
      ) {
        return;
      }

      const aggregate = aggregates.get(key) ?? {
        key,
        ranks: new Map<string, number>(),
        displaysByDomain: new Map<string, string>(),
        evidence: [],
      };
      const currentRank = aggregate.ranks.get(domain);
      if (currentRank === undefined || row.firstDomainRank < currentRank) {
        aggregate.ranks.set(domain, row.firstDomainRank);
      }
      if (!aggregate.displaysByDomain.has(domain)) {
        aggregate.displaysByDomain.set(domain, displayed);
      }
      aggregate.evidence.push({
        domain,
        rank: row.firstDomainRank,
        rowIndex,
        row,
      });
      aggregates.set(key, aggregate);
    });
  }

  const queries = queryAggregates(input.gsc);
  const rows = [...aggregates.values()]
    .map((aggregate): CompetitorKeywordGapRow => {
      const evidence = aggregate.evidence.toSorted(compareEvidence);
      const bestEvidence = evidence[0];
      if (bestEvidence === undefined) {
        throw new Error("Competitor keyword aggregate has no evidence");
      }
      const rankEntries = [...aggregate.ranks.entries()].toSorted(([a], [b]) =>
        a.localeCompare(b),
      );
      const competitorRanks = Object.freeze(Object.fromEntries(rankEntries));
      const ranks = rankEntries.map(([, rank]) => rank);

      return Object.freeze({
        keyword:
          aggregate.displaysByDomain.get(bestEvidence.domain) ?? aggregate.key,
        competitorRanks,
        competitorCount: rankEntries.length,
        bestCompetitorRank: Math.min(...ranks),
        ownState: "not_observed_in_provider_rankings",
        searchVolume: metricFrom(evidence, (row) => row.searchVolume),
        cpc: metricFrom(evidence, (row) => row.cpc),
        keywordDifficulty: metricFrom(
          evidence,
          (row) => row.keywordDifficulty,
        ),
        providerIntent: intentFrom(evidence),
        gsc: gscEvidence(aggregate.key, input.gsc, queries),
      });
    })
    .toSorted(rowSort);

  const completedCompetitors = competitorCoverage.filter(
    (competitor) => competitor.status === "complete",
  ).length;
  const requestedCompetitors = input.competitorDomains.length;
  const gscStatus = overlayStatus(input.gsc);
  const status = runStatus(
    completedCompetitors,
    requestedCompetitors,
    gscStatus,
  );
  const frozenCoverage = Object.freeze(competitorCoverage);
  const frozenRows = Object.freeze(rows);

  return Object.freeze({
    run: Object.freeze({
      tool: COMPETITOR_KEYWORD_GAP_TOOL,
      schemaVersion: COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
      mode: "public_preview",
      scope: "site",
      persistence: "none",
      completedAt: input.completedAt,
      status,
    }),
    result: Object.freeze({
      capturedAt: input.completedAt,
      siteDomain: input.siteDomain,
      competitorDomains: Object.freeze([...input.competitorDomains]),
      marketCode: input.marketCode,
      languageCode: input.languageCode,
      requestedCompetitors,
      completedCompetitors,
      unavailableCompetitors: requestedCompetitors - completedCompetitors,
      competitors: frozenCoverage,
      rows: frozenRows,
      resultTruncated: competitorCoverage.some(
        (competitor) => competitor.truncated,
      ),
      overlayStatus: gscStatus,
      gscQueryTruncated: input.gsc?.queryTruncated ?? false,
      gscQueryPageTruncated: input.gsc?.queryPageTruncated ?? false,
    }),
  });
}
