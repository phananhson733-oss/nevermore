// @input  -- normalized scope, the sample rule, one sanitized DFS outcome per competitor and optional GSC rows
// @output -- one deterministic competitor keyword gap report on the v3 contract, pre-screen attached per row
// @pos    -- pure merger that keeps provider failure, silence, zero, and first-party evidence distinct

import {
  COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS,
  COMPETITOR_KEYWORD_GAP_SCHEMA_VERSION,
  COMPETITOR_KEYWORD_GAP_TOOL,
} from "./types.ts";
import { preScreenCompetitorKeyword } from "./pre-screen.ts";
import {
  MIN_DIMENSION_COVERAGE,
  queryPageCoverage,
} from "../gsc-analytics/page-reader.ts";
import type {
  CompetitorKeywordGapCompetitorCoverage,
  CompetitorKeywordGapCompetitorPage,
  CompetitorKeywordGapEnvelope,
  CompetitorKeywordGapGscEvidence,
  CompetitorKeywordGapGscPageStatus,
  CompetitorKeywordGapGscOverlayStatus,
  CompetitorKeywordGapMetric,
  CompetitorKeywordGapPreScreenBand,
  CompetitorKeywordGapRow,
  CompetitorKeywordGapRunStatus,
  CompetitorKeywordGapSampleRule,
  CompetitorKeywordGapSearchVolumeTrend,
  CompetitorKeywordGapSerpSnapshot,
} from "./types.ts";

/**
 * Mirrors the sanitized sources row field for field; the public-tools package
 * must not import `@sf/sources`, so the shape is restated here.
 */
export interface CompetitorKeywordGapProviderRow {
  readonly keyword: string;
  readonly searchVolume: number | null;
  readonly cpc: number | null;
  readonly keywordDifficulty: number | null;
  readonly providerIntent: string | null;
  readonly firstDomainRank: number;
  readonly secondDomainRank: number | null;
  readonly firstDomainUrl: string | null;
  readonly firstDomainTitle: string | null;
  readonly firstDomainEtv: number | null;
  readonly coreKeyword: string | null;
  readonly searchVolumeTrend: CompetitorKeywordGapSearchVolumeTrend | null;
  /** null is provider silence; an empty list is a reported, empty snapshot. */
  readonly serpItemTypes: readonly string[] | null;
  readonly serpUpdatedAt: string | null;
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
  /** Echoed verbatim so the surface can state what the sample was, not what it wishes it were. */
  readonly sampleRule: CompetitorKeywordGapSampleRule;
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

interface GscPageAggregate {
  readonly pageUrl: string;
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

/** The first evidence in rank order whose field is not provider silence. */
function firstWith<T>(
  evidence: readonly ProviderEvidence[],
  read: (row: CompetitorKeywordGapProviderRow) => T | null,
): T | null {
  for (const item of evidence) {
    const value = read(item.row);
    if (value !== null) return value;
  }
  return null;
}

/** Each competitor's best-rank page; the keys are exactly the domains in `competitorRanks`. */
function competitorPagesFrom(
  rankEntries: readonly (readonly [string, number])[],
  evidence: readonly ProviderEvidence[],
): Readonly<Record<string, CompetitorKeywordGapCompetitorPage>> {
  return Object.freeze(
    Object.fromEntries(
      rankEntries.map(([domain]) => {
        const best = evidence.find((item) => item.domain === domain);
        return [
          domain,
          Object.freeze({
            url: best?.row.firstDomainUrl ?? null,
            title: best?.row.firstDomainTitle ?? null,
            etv: best?.row.firstDomainEtv ?? null,
          }),
        ];
      }),
    ),
  );
}

function trendFrom(
  evidence: readonly ProviderEvidence[],
): CompetitorKeywordGapSearchVolumeTrend | null {
  const trend = firstWith(evidence, (row) => row.searchVolumeTrend);
  return trend === null
    ? null
    : Object.freeze({
        monthly: trend.monthly,
        quarterly: trend.quarterly,
        yearly: trend.yearly,
      });
}

/** Null only when every evidence row is silent; an empty item list is a reported snapshot. */
function serpSnapshotFrom(
  evidence: readonly ProviderEvidence[],
): CompetitorKeywordGapSerpSnapshot | null {
  const source = evidence.find((item) => item.row.serpItemTypes !== null);
  return source === undefined
    ? null
    : Object.freeze({
        itemTypes: Object.freeze([...(source.row.serpItemTypes ?? [])]),
        updatedAt: source.row.serpUpdatedAt,
      });
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

function safePageUrl(page: string): string | null {
  const candidate = page.trim();
  if (candidate === "") return null;
  try {
    const url = new URL(candidate);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function pageAggregates(
  gsc: CompetitorKeywordGapGscRead | null,
): ReadonlyMap<string, ReadonlyMap<string, GscPageAggregate>> {
  const aggregates = new Map<string, Map<string, GscPageAggregate>>();
  if (gsc?.status !== "available") return aggregates;

  for (const row of gsc.queryPageRows) {
    const key = competitorKeywordGapKey(row.query);
    const pageUrl = safePageUrl(row.page);
    if (
      key === "" ||
      pageUrl === null ||
      !Number.isFinite(row.impressions) ||
      row.impressions <= 0 ||
      !Number.isFinite(row.position) ||
      row.position < 0
    ) {
      continue;
    }
    const pages = aggregates.get(key) ?? new Map<string, GscPageAggregate>();
    const current = pages.get(pageUrl) ?? {
      pageUrl,
      impressions: 0,
      weightedPositions: 0,
    };
    current.impressions += row.impressions;
    current.weightedPositions += row.position * row.impressions;
    pages.set(pageUrl, current);
    aggregates.set(key, pages);
  }
  return aggregates;
}

function bestPage(
  key: string,
  pages: ReadonlyMap<string, ReadonlyMap<string, GscPageAggregate>>,
): GscPageAggregate | null {
  const queryPages = pages.get(key);
  if (queryPages === undefined) return null;

  return (
    [...queryPages.values()].toSorted(
      (a, b) =>
        b.impressions - a.impressions ||
        a.weightedPositions / a.impressions - b.weightedPositions / b.impressions ||
        a.pageUrl.localeCompare(b.pageUrl),
    )[0] ?? null
  );
}

function observedFromQuery(
  observation: GscQueryAggregate | undefined,
): "observed_strong" | "observed_weak" | null {
  if (observation === undefined) return null;
  const position = observation.weightedPositions / observation.impressions;
  return observation.impressions >= GSC_STRONG_IMPRESSIONS_MIN &&
      position <= GSC_STRONG_POSITION_MAX
    ? "observed_strong"
    : "observed_weak";
}

function pageStatusFrom(
  key: string,
  page: GscPageAggregate | null,
  query: GscQueryAggregate | undefined,
  pages: ReadonlyMap<string, ReadonlyMap<string, GscPageAggregate>>,
  gsc: CompetitorKeywordGapGscRead | null,
): {
  readonly pageStatus: CompetitorKeywordGapGscPageStatus;
  readonly pageImpressions: number | null;
  readonly pagePosition: number | null;
  readonly queryPageCoverage: number | null;
} {
  if (gsc?.status !== "available") {
    return {
      pageStatus: "gsc_query_page_sample_not_read",
      pageImpressions: null,
      pagePosition: null,
      queryPageCoverage: null,
    };
  }
  if (page === null) {
    return {
      pageStatus: gsc.queryPageTruncated
        ? "gsc_query_page_sample_not_read"
        : "not_observed_in_gsc_query_page_sample",
      pageImpressions: null,
      pagePosition: null,
      queryPageCoverage: null,
    };
  }

  const pagePosition = page.weightedPositions / page.impressions;
  const queryPages = pages.get(key);
  const coverage =
    query === undefined || queryPages === undefined
      ? null
      : queryPageCoverage(
          [
            {
              query: key,
              clicks: 0,
              impressions: query.impressions,
              position: query.weightedPositions / query.impressions,
            },
          ],
          [...queryPages.values()].map((queryPage) => ({
            query: key,
            page: queryPage.pageUrl,
            clicks: 0,
            impressions: queryPage.impressions,
            position:
              queryPage.weightedPositions / queryPage.impressions,
          })),
        ).get(key) ?? null;
  const sufficient =
    !gsc.queryPageTruncated &&
    coverage !== null &&
    Number.isFinite(coverage) &&
    coverage >= 0 &&
    coverage <= 1 &&
    coverage >= MIN_DIMENSION_COVERAGE;

  return {
    pageStatus: sufficient ? "observed_sufficient" : "observed_partial",
    pageImpressions: page.impressions,
    pagePosition,
    queryPageCoverage: coverage,
  };
}

function gscEvidence(
  key: string,
  gsc: CompetitorKeywordGapGscRead | null,
  queries: ReadonlyMap<string, GscQueryAggregate>,
  pages: ReadonlyMap<string, ReadonlyMap<string, GscPageAggregate>>,
): CompetitorKeywordGapGscEvidence {
  if (gsc?.status !== "available") {
    return Object.freeze({
      queryStatus: "gsc_query_sample_not_read",
      evidenceBasis: null,
      queryImpressions: null,
      queryPosition: null,
      pageStatus: "gsc_query_page_sample_not_read",
      pageUrl: null,
      pageImpressions: null,
      pagePosition: null,
      queryPageCoverage: null,
      nextStep: "verify_own_coverage",
    });
  }

  const observation = queries.get(key);
  const page = bestPage(key, pages);
  const observedQueryStatus = observedFromQuery(observation);
  const queryStatus =
    observedQueryStatus ??
    (page !== null
      ? "observed_weak"
      : gsc.queryTruncated
        ? "gsc_query_sample_not_read"
        : "not_observed_in_gsc_query_sample");
  const evidenceBasis =
    observedQueryStatus !== null ? "query" : page !== null ? "query_page" : null;
  const pageFacts = pageStatusFrom(key, page, observation, pages, gsc);
  const queryPosition =
    observation === undefined ? null : observation.weightedPositions / observation.impressions;

  const nextStep =
    queryStatus === "observed_strong"
      ? "review_existing_query"
      : queryStatus === "observed_weak"
        ? pageFacts.pageStatus === "observed_sufficient" &&
            evidenceBasis === "query"
          ? "optimize_existing"
          : "review_existing_query"
        : queryStatus === "not_observed_in_gsc_query_sample" &&
            pageFacts.pageStatus === "not_observed_in_gsc_query_page_sample"
          ? "review_content_gap"
          : "verify_own_coverage";
  return Object.freeze({
    queryStatus,
    evidenceBasis,
    queryImpressions:
      evidenceBasis === "query" ? observation?.impressions ?? null : null,
    queryPosition: evidenceBasis === "query" ? queryPosition : null,
    pageStatus: pageFacts.pageStatus,
    pageUrl: page?.pageUrl ?? null,
    pageImpressions: pageFacts.pageImpressions,
    pagePosition: pageFacts.pagePosition,
    queryPageCoverage: pageFacts.queryPageCoverage,
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

/** Band order inside a lane is owned by the contract's band list, so it is not restated here. */
function bandPriority(band: CompetitorKeywordGapPreScreenBand): number {
  return COMPETITOR_KEYWORD_GAP_PRE_SCREEN_BANDS.indexOf(band);
}

function gapRow(
  aggregate: MutableAggregate,
  input: CompetitorKeywordGapReportInput,
  queries: ReadonlyMap<string, GscQueryAggregate>,
  pages: ReadonlyMap<string, ReadonlyMap<string, GscPageAggregate>>,
): CompetitorKeywordGapRow {
  const evidence = aggregate.evidence.toSorted(compareEvidence);
  const bestEvidence = evidence[0];
  if (bestEvidence === undefined) {
    throw new Error("Competitor keyword aggregate has no evidence");
  }
  const rankEntries = [...aggregate.ranks.entries()].toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  const competitorRanks = Object.freeze(Object.fromEntries(rankEntries));
  const competitorPages = competitorPagesFrom(rankEntries, evidence);
  const bestCompetitorRank = Math.min(...rankEntries.map(([, rank]) => rank));
  const searchVolume = metricFrom(evidence, (row) => row.searchVolume);
  const cpc = metricFrom(evidence, (row) => row.cpc);
  const keywordDifficulty = metricFrom(evidence, (row) => row.keywordDifficulty);
  const providerIntent = intentFrom(evidence);

  return Object.freeze({
    keyword:
      aggregate.displaysByDomain.get(bestEvidence.domain) ?? aggregate.key,
    competitorRanks,
    competitorPages,
    competitorCount: rankEntries.length,
    bestCompetitorRank,
    ownState: "not_observed_in_provider_rankings",
    searchVolume,
    cpc,
    keywordDifficulty,
    providerIntent,
    coreKeyword: firstWith(evidence, (row) => row.coreKeyword),
    searchVolumeTrend: trendFrom(evidence),
    serpSnapshot: serpSnapshotFrom(evidence),
    preScreen: preScreenCompetitorKeyword({
      keyword: aggregate.key,
      keywordDifficulty,
      searchVolume,
      bestCompetitorRank,
      providerIntent,
      competitorPages,
      competitorDomains: input.competitorDomains,
    }),
    gsc: gscEvidence(aggregate.key, input.gsc, queries, pages),
  });
}

function rowSort(a: CompetitorKeywordGapRow, b: CompetitorKeywordGapRow) {
  const nextStepPriority: Readonly<Record<CompetitorKeywordGapGscEvidence["nextStep"], number>> = {
    optimize_existing: 0,
    review_existing_query: 1,
    review_content_gap: 2,
    verify_own_coverage: 3,
  };
  const queryPriority: Readonly<Record<CompetitorKeywordGapGscEvidence["queryStatus"], number>> = {
    observed_weak: 0,
    observed_strong: 1,
    not_observed_in_gsc_query_sample: 2,
    gsc_query_sample_not_read: 3,
  };
  if (nextStepPriority[a.gsc.nextStep] !== nextStepPriority[b.gsc.nextStep]) {
    return nextStepPriority[a.gsc.nextStep] - nextStepPriority[b.gsc.nextStep];
  }
  if (queryPriority[a.gsc.queryStatus] !== queryPriority[b.gsc.queryStatus]) {
    return queryPriority[a.gsc.queryStatus] - queryPriority[b.gsc.queryStatus];
  }
  const aImpressions = a.gsc.queryImpressions ?? a.gsc.pageImpressions;
  const bImpressions = b.gsc.queryImpressions ?? b.gsc.pageImpressions;
  if (aImpressions !== bImpressions) {
    if (aImpressions === null) return 1;
    if (bImpressions === null) return -1;
    return bImpressions - aImpressions;
  }
  if (a.preScreen.band !== b.preScreen.band) {
    return bandPriority(a.preScreen.band) - bandPriority(b.preScreen.band);
  }
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

    // The envelope echoes `sampleRule` as a promise about these rows, so the
    // rule is enforced here as well as requested upstream: a provider that
    // ignores the rank filter or the cap must not put out-of-rule rows under
    // an in-rule label.
    const rowsInRule = provider.rows.slice(
      0,
      input.sampleRule.perCompetitorLimit,
    );
    rowsInRule.forEach((row, rowIndex) => {
      const key = competitorKeywordGapKey(row.keyword);
      const displayed = displayKeyword(row.keyword);
      if (
        key === "" ||
        displayed === "" ||
        !Number.isFinite(row.firstDomainRank) ||
        row.firstDomainRank <= 0 ||
        row.firstDomainRank > input.sampleRule.maxCompetitorRank ||
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
  const pages = pageAggregates(input.gsc);
  const rows = [...aggregates.values()]
    .map((aggregate) => gapRow(aggregate, input, queries, pages))
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
      sampleRule: Object.freeze({ ...input.sampleRule }),
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
      gscQueryRowCount:
        input.gsc?.status === "available" ? input.gsc.queryRows.length : null,
      gscQueryPageRowCount:
        input.gsc?.status === "available"
          ? input.gsc.queryPageRows.length
          : null,
    }),
  });
}
