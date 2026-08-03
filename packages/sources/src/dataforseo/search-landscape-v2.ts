import {
  SourceError,
  type Availability,
  type CollectionContext,
  type CollectionResult,
  type NormalizeContext,
  type NormalizedObservation,
} from "../adapter.ts";
import { buildObservation } from "../observations.ts";
import type { DataForSeoCollectionLocation } from "./adapter.ts";
import {
  DEFAULT_DATAFORSEO_COMPETITORS_DOMAIN_LIMIT,
  DEFAULT_DATAFORSEO_LIMIT,
  MAX_DATAFORSEO_LIMIT,
  type DataForSeoCompetitorsDomainRequest,
  type DataForSeoRankedKeywordsRequest,
  type DataForSeoSearchLandscapeV2Client,
  type DataForSeoSerpCompetitorRow,
  type DataForSeoSerpCompetitorsRequest,
  type DataForSeoSerpCompetitorsResponse,
} from "./client.ts";
import {
  createDataForSeoSearchLandscapeAdapter,
  createDataForSeoSearchLandscapeScope,
  type DataForSeoSearchLandscapeCompetitorsDomainRaw,
  type DataForSeoSearchLandscapeRankedKeywordsRaw,
  type DataForSeoSearchLandscapeRaw,
} from "./search-landscape.ts";

export const DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY =
  "dataforseo.search_landscape.v2" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION =
  "dataforseo.search_landscape.v2" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_V2_SCOPE_VERSION =
  "dataforseo.search-landscape-scope.v2" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_V2_QUERY_KIND =
  "search_landscape" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_V2_OPERATION =
  "search_landscape" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_V2_ROW_CAP_STOP_REASON =
  "DATAFORSEO_SEARCH_LANDSCAPE_V2_ROW_CAP_REACHED" as const;
export const METRIC_DATAFORSEO_SERP_COMPETITOR =
  "dataforseo.serp_competitor.v1" as const;
export const MAX_DATAFORSEO_SERP_COMPETITOR_SEEDS = 200;

const SEED_KINDS = new Set<DataForSeoSearchLandscapeSeedKind>([
  "gsc_top_query",
  "crawler_page_text",
  "product_profile",
]);
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export type DataForSeoSearchLandscapeSeedKind =
  | "gsc_top_query"
  | "crawler_page_text"
  | "product_profile";

export interface DataForSeoSearchLandscapeSeed {
  readonly keyword: string;
  readonly sourceKind: DataForSeoSearchLandscapeSeedKind;
  /** Opaque canonical record identity; never provider credentials or raw prose. */
  readonly sourceRef: string;
}

export interface DataForSeoSearchLandscapeV2ScopeInput {
  readonly target: unknown;
  readonly marketCode: unknown;
  readonly languageTag: unknown;
  readonly locationCode?: unknown;
  readonly locationName?: unknown;
  readonly rankedKeywordsLimit?: unknown;
  readonly competitorsDomainLimit?: unknown;
  readonly serpCompetitorsLimit?: unknown;
  readonly seeds?: unknown;
}

export type DataForSeoSearchLandscapeV2Scope = Readonly<{
  readonly schemaVersion: typeof DATAFORSEO_SEARCH_LANDSCAPE_V2_SCOPE_VERSION;
  readonly queryKind: typeof DATAFORSEO_SEARCH_LANDSCAPE_V2_QUERY_KIND;
  readonly target: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly providerLanguageCode: string;
  readonly location: DataForSeoCollectionLocation;
  readonly rankedKeywords: Readonly<{
    readonly limit: number;
    readonly historicalSerpMode: "live";
    readonly itemTypes: readonly ["organic"];
    readonly minimumSearchVolumeExclusive: 0;
    readonly rankGroup: Readonly<{ readonly minimum: 1; readonly maximum: 100 }>;
  }>;
  readonly competitorsDomain: Readonly<{
    readonly limit: number;
    readonly itemTypes: readonly ["organic"];
    readonly minimumIntersectionsExclusive: 0;
    readonly maxRankGroup: 100;
    readonly excludeDomains: readonly [string];
  }>;
  readonly serpCompetitors: Readonly<{
    readonly limit: number;
    readonly itemTypes: readonly ["organic"];
    readonly fallbackWhenDomainOverlapEmpty: true;
    readonly maximumSeeds: typeof MAX_DATAFORSEO_SERP_COMPETITOR_SEEDS;
    readonly seeds: readonly DataForSeoSearchLandscapeSeed[];
  }>;
}>;

export interface DataForSeoSearchLandscapeSerpCompetitorsRaw {
  readonly status: "not_needed" | "skipped_no_seeds" | "collected";
  readonly request: DataForSeoSerpCompetitorsRequest | null;
  readonly rows: readonly DataForSeoSerpCompetitorRow[];
  readonly totalCount: number;
  readonly itemsCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number | null;
  readonly taskStatusCode: number | null;
  readonly providerRowsCount: number;
  readonly retainedRowsCount: number;
  readonly excludedSelfCount: number;
  readonly duplicateRowsRemovedCount: number;
}

export interface DataForSeoSearchLandscapeV2Raw {
  readonly schemaVersion: typeof DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION;
  readonly collectionScope: DataForSeoSearchLandscapeV2Scope;
  readonly rankedKeywords: DataForSeoSearchLandscapeRankedKeywordsRaw;
  readonly competitorsDomain: DataForSeoSearchLandscapeCompetitorsDomainRaw;
  readonly serpCompetitors: DataForSeoSearchLandscapeSerpCompetitorsRaw;
  readonly capturedAt: string;
  readonly availability: Availability;
  readonly stopReason:
    | typeof DATAFORSEO_SEARCH_LANDSCAPE_V2_ROW_CAP_STOP_REASON
    | null;
  readonly limitation: string;
}

export interface DataForSeoSearchLandscapeV2Capability {
  readonly datasetKey: typeof DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY;
  readonly operation: typeof DATAFORSEO_SEARCH_LANDSCAPE_V2_OPERATION;
  readonly available: boolean;
  readonly limitation: string;
}

export interface DataForSeoSearchLandscapeV2Adapter {
  readonly provider: "dataforseo";
  validateConfig(config: unknown): Promise<DataForSeoSearchLandscapeV2Scope>;
  capabilities(
    config: DataForSeoSearchLandscapeV2Scope,
  ): Promise<DataForSeoSearchLandscapeV2Capability[]>;
  collect(
    params: DataForSeoSearchLandscapeV2Scope,
    ctx: CollectionContext,
  ): Promise<CollectionResult<DataForSeoSearchLandscapeV2Raw>>;
  normalize(
    raw: DataForSeoSearchLandscapeV2Raw,
    ctx: NormalizeContext,
  ): AsyncIterable<NormalizedObservation>;
}

export interface DataForSeoSearchLandscapeV2AdapterOptions {
  readonly now?: () => Date;
}

type JsonRecord = Record<string, unknown>;

function strictRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourceError("INVALID_CONFIGURATION", `${label} must be an object.`);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, expected: readonly string[], label: string): void {
  const keys = Object.keys(value);
  const allowed = new Set(expected);
  if (keys.length !== expected.length || keys.some((key) => !allowed.has(key))) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} contains an unknown or missing field.`,
    );
  }
}

function canonicalEquivalent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) =>
        canonicalEquivalent(value, right[index]),
      )
    );
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }
  const leftRecord = left as JsonRecord;
  const rightRecord = right as JsonRecord;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        canonicalEquivalent(leftRecord[key], rightRecord[key]),
    )
  );
}

function limit(value: unknown, fallback: number, label: string): number {
  const selected = value === undefined || value === null ? fallback : value;
  if (
    !Number.isSafeInteger(selected) ||
    (selected as number) < 1 ||
    (selected as number) > MAX_DATAFORSEO_LIMIT
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} must be an integer from 1 to ${MAX_DATAFORSEO_LIMIT}.`,
    );
  }
  return selected as number;
}

function canonicalSeeds(value: unknown): readonly DataForSeoSearchLandscapeSeed[] {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_DATAFORSEO_SERP_COMPETITOR_SEEDS) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `DataForSEO seeds must be an array with at most ${MAX_DATAFORSEO_SERP_COMPETITOR_SEEDS} items.`,
    );
  }
  const seen = new Set<string>();
  const seeds: DataForSeoSearchLandscapeSeed[] = [];
  for (const [index, item] of value.entries()) {
    const record = strictRecord(item, `DataForSEO seed ${index}`);
    exactKeys(record, ["keyword", "sourceKind", "sourceRef"], `DataForSEO seed ${index}`);
    if (
      typeof record.keyword !== "string" ||
      record.keyword.trim() === "" ||
      record.keyword.trim().length > 200 ||
      typeof record.sourceKind !== "string" ||
      !SEED_KINDS.has(record.sourceKind as DataForSeoSearchLandscapeSeedKind) ||
      typeof record.sourceRef !== "string" ||
      record.sourceRef.trim() === "" ||
      record.sourceRef.trim().length > 200
    ) {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        `DataForSEO seed ${index} is invalid.`,
      );
    }
    const keyword = record.keyword.normalize("NFKC").trim().replace(/\s+/g, " ");
    const identity = keyword.toLocaleLowerCase("en-US");
    if (seen.has(identity)) continue;
    seen.add(identity);
    seeds.push(
      Object.freeze({
        keyword,
        sourceKind: record.sourceKind as DataForSeoSearchLandscapeSeedKind,
        sourceRef: record.sourceRef.trim(),
      }),
    );
  }
  return Object.freeze(seeds);
}

function locationFields(location: DataForSeoCollectionLocation):
  | { readonly locationCode: number }
  | { readonly locationName: string } {
  return location.kind === "code"
    ? { locationCode: location.code }
    : { locationName: location.name };
}

export function createDataForSeoSearchLandscapeV2Scope(
  input: DataForSeoSearchLandscapeV2ScopeInput,
): DataForSeoSearchLandscapeV2Scope {
  const record = strictRecord(input, "DataForSEO search-landscape v2 scope input");
  const allowed = new Set([
    "target",
    "marketCode",
    "languageTag",
    "locationCode",
    "locationName",
    "rankedKeywordsLimit",
    "competitorsDomainLimit",
    "serpCompetitorsLimit",
    "seeds",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO search-landscape v2 scope input contains an unknown field.",
    );
  }
  const rankedLimit = limit(
    input.rankedKeywordsLimit,
    DEFAULT_DATAFORSEO_LIMIT,
    "DataForSEO rankedKeywordsLimit",
  );
  const competitorLimit = limit(
    input.competitorsDomainLimit,
    DEFAULT_DATAFORSEO_COMPETITORS_DOMAIN_LIMIT,
    "DataForSEO competitorsDomainLimit",
  );
  const serpLimit = limit(
    input.serpCompetitorsLimit,
    DEFAULT_DATAFORSEO_COMPETITORS_DOMAIN_LIMIT,
    "DataForSEO serpCompetitorsLimit",
  );
  const legacy = createDataForSeoSearchLandscapeScope({
    target: input.target,
    marketCode: input.marketCode,
    languageTag: input.languageTag,
    ...(input.locationCode === undefined
      ? {}
      : { locationCode: input.locationCode }),
    ...(input.locationName === undefined
      ? {}
      : { locationName: input.locationName }),
    rankedKeywordsLimit: rankedLimit,
    competitorsDomainLimit: competitorLimit,
  });
  return Object.freeze({
    schemaVersion: DATAFORSEO_SEARCH_LANDSCAPE_V2_SCOPE_VERSION,
    queryKind: DATAFORSEO_SEARCH_LANDSCAPE_V2_QUERY_KIND,
    target: legacy.target,
    marketCode: legacy.marketCode,
    languageTag: legacy.languageTag,
    providerLanguageCode: legacy.providerLanguageCode,
    location: legacy.location,
    rankedKeywords: Object.freeze({
      limit: rankedLimit,
      historicalSerpMode: "live" as const,
      itemTypes: Object.freeze(["organic"] as const),
      minimumSearchVolumeExclusive: 0 as const,
      rankGroup: Object.freeze({ minimum: 1 as const, maximum: 100 as const }),
    }),
    competitorsDomain: Object.freeze({
      limit: competitorLimit,
      itemTypes: Object.freeze(["organic"] as const),
      minimumIntersectionsExclusive: 0 as const,
      maxRankGroup: 100 as const,
      excludeDomains: Object.freeze([legacy.target] as const),
    }),
    serpCompetitors: Object.freeze({
      limit: serpLimit,
      itemTypes: Object.freeze(["organic"] as const),
      fallbackWhenDomainOverlapEmpty: true as const,
      maximumSeeds: MAX_DATAFORSEO_SERP_COMPETITOR_SEEDS,
      seeds: canonicalSeeds(input.seeds),
    }),
  });
}

export function parseDataForSeoSearchLandscapeV2Scope(
  value: unknown,
): DataForSeoSearchLandscapeV2Scope {
  const input = strictRecord(value, "DataForSEO search-landscape v2 scope");
  exactKeys(
    input,
    [
      "schemaVersion",
      "queryKind",
      "target",
      "marketCode",
      "languageTag",
      "providerLanguageCode",
      "location",
      "rankedKeywords",
      "competitorsDomain",
      "serpCompetitors",
    ],
    "DataForSEO search-landscape v2 scope",
  );
  if (
    input.schemaVersion !== DATAFORSEO_SEARCH_LANDSCAPE_V2_SCOPE_VERSION ||
    input.queryKind !== DATAFORSEO_SEARCH_LANDSCAPE_V2_QUERY_KIND
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO search-landscape v2 scope version or query kind is unsupported.",
    );
  }
  const location = strictRecord(input.location, "DataForSEO v2 location");
  const locationInput =
    location.kind === "code"
      ? { locationCode: location.code }
      : location.kind === "name"
        ? { locationName: location.name }
        : (() => {
            throw new SourceError(
              "INVALID_CONFIGURATION",
              "DataForSEO v2 location kind is unsupported.",
            );
          })();
  const ranked = strictRecord(input.rankedKeywords, "DataForSEO v2 ranked policy");
  const competitors = strictRecord(
    input.competitorsDomain,
    "DataForSEO v2 competitor policy",
  );
  const serp = strictRecord(input.serpCompetitors, "DataForSEO v2 SERP policy");
  const canonical = createDataForSeoSearchLandscapeV2Scope({
    target: input.target,
    marketCode: input.marketCode,
    languageTag: input.languageTag,
    ...locationInput,
    rankedKeywordsLimit: ranked.limit,
    competitorsDomainLimit: competitors.limit,
    serpCompetitorsLimit: serp.limit,
    seeds: serp.seeds,
  });
  if (!canonicalEquivalent(input, canonical)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO search-landscape v2 scope is not canonical.",
    );
  }
  return canonical;
}

function rankedRequest(scope: DataForSeoSearchLandscapeV2Scope): DataForSeoRankedKeywordsRequest {
  return {
    target: scope.target,
    ...locationFields(scope.location),
    languageCode: scope.providerLanguageCode,
    limit: scope.rankedKeywords.limit,
    minimumRankGroup: 1,
    maximumRankGroup: 100,
  };
}

function competitorRequest(
  scope: DataForSeoSearchLandscapeV2Scope,
): DataForSeoCompetitorsDomainRequest {
  return {
    target: scope.target,
    ...locationFields(scope.location),
    languageCode: scope.providerLanguageCode,
    limit: scope.competitorsDomain.limit,
    maximumRankGroup: 100,
  };
}

function serpRequest(scope: DataForSeoSearchLandscapeV2Scope): DataForSeoSerpCompetitorsRequest {
  return {
    keywords: scope.serpCompetitors.seeds.map((seed) => seed.keyword),
    ...locationFields(scope.location),
    languageCode: scope.providerLanguageCode,
    limit: scope.serpCompetitors.limit,
  };
}

function canonicalDomain(value: string): string {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new SourceError("INVALID_RESPONSE", "DataForSEO SERP competitor domain is invalid.");
  }
  const domain = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!HOSTNAME_RE.test(domain)) {
    throw new SourceError("INVALID_RESPONSE", "DataForSEO SERP competitor domain is invalid.");
  }
  return domain;
}

function nonNegative(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new SourceError("INVALID_RESPONSE", `${label} must be non-negative.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${label} must be a non-negative integer.`,
    );
  }
  return value as number;
}

function sanitizeSerp(
  response: DataForSeoSerpCompetitorsResponse,
  target: string,
): Omit<DataForSeoSearchLandscapeSerpCompetitorsRaw, "status" | "request"> {
  if (!Array.isArray(response.rows)) {
    throw new SourceError("INVALID_RESPONSE", "DataForSEO SERP competitor rows must be an array.");
  }
  if (
    !Number.isSafeInteger(response.itemsCount) ||
    response.itemsCount !== response.rows.length ||
    !Number.isSafeInteger(response.totalCount) ||
    response.totalCount < response.itemsCount
  ) {
    throw new SourceError("INVALID_RESPONSE", "DataForSEO SERP competitor counts are contradictory.");
  }
  const byDomain = new Map<string, DataForSeoSerpCompetitorRow>();
  let excludedSelfCount = 0;
  let duplicateRowsRemovedCount = 0;
  for (const row of response.rows) {
    const canonical: DataForSeoSerpCompetitorRow = {
      domain: canonicalDomain(row.domain),
      averagePosition: nonNegative(row.averagePosition, "averagePosition"),
      medianPosition: nonNegative(row.medianPosition, "medianPosition"),
      rating: nonNegative(row.rating, "rating"),
      organicEstimatedTrafficVolume: nonNegative(
        row.organicEstimatedTrafficVolume,
        "organicEstimatedTrafficVolume",
      ),
      keywordsCount: nonNegativeInteger(row.keywordsCount, "keywordsCount"),
      visibility: nonNegative(row.visibility, "visibility"),
      relevantSerpItems: nonNegativeInteger(
        row.relevantSerpItems,
        "relevantSerpItems",
      ),
    };
    if (canonical.domain === target) {
      excludedSelfCount += 1;
      continue;
    }
    const existing = byDomain.get(canonical.domain);
    if (existing !== undefined) {
      duplicateRowsRemovedCount += 1;
      if (existing.rating >= canonical.rating) continue;
    }
    byDomain.set(canonical.domain, canonical);
  }
  const rows = [...byDomain.values()].sort(
    (left, right) =>
      right.rating - left.rating ||
      right.keywordsCount - left.keywordsCount ||
      left.domain.localeCompare(right.domain, "en"),
  );
  return {
    rows,
    totalCount: response.totalCount,
    itemsCount: response.itemsCount,
    costUsd: nonNegative(response.costUsd, "costUsd"),
    providerStatusCode: response.providerStatusCode,
    taskStatusCode: response.taskStatusCode,
    providerRowsCount: response.rows.length,
    retainedRowsCount: rows.length,
    excludedSelfCount,
    duplicateRowsRemovedCount,
  };
}

function noSerp(
  status: "not_needed" | "skipped_no_seeds",
): DataForSeoSearchLandscapeSerpCompetitorsRaw {
  return {
    status,
    request: null,
    rows: [],
    totalCount: 0,
    itemsCount: 0,
    costUsd: 0,
    providerStatusCode: null,
    taskStatusCode: null,
    providerRowsCount: 0,
    retainedRowsCount: 0,
    excludedSelfCount: 0,
    duplicateRowsRemovedCount: 0,
  };
}

function roundedCost(...values: readonly number[]): number {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(12));
}

function limitationFor(
  scope: DataForSeoSearchLandscapeV2Scope,
  serp: DataForSeoSearchLandscapeSerpCompetitorsRaw,
): string {
  const details = [
    "DataForSEO search-landscape v2 observes Google organic ranked keywords at positions 1–100 and domain overlap at max rank group 100.",
    "GSC, Crawler, and Product Profile seeds retain their declared source and are used only to query the DataForSEO SERP Competitors endpoint; they are not relabelled as DataForSEO observations.",
  ];
  if (serp.status === "collected") {
    details.push(
      `Domain overlap was empty, so SERP Competitors used ${scope.serpCompetitors.seeds.length} frozen seed(s).`,
    );
  } else if (serp.status === "skipped_no_seeds") {
    details.push("Domain overlap was empty and no eligible frozen seeds were available, so no paid fallback call was made.");
  } else {
    details.push("Domain overlap returned retained rows, so the paid SERP Competitors fallback was not called.");
  }
  return details.join(" ");
}

function legacyRaw(raw: DataForSeoSearchLandscapeV2Raw): DataForSeoSearchLandscapeRaw {
  const scope = createDataForSeoSearchLandscapeScope({
    target: raw.collectionScope.target,
    marketCode: raw.collectionScope.marketCode,
    languageTag: raw.collectionScope.languageTag,
    ...locationFields(raw.collectionScope.location),
    rankedKeywordsLimit: raw.collectionScope.rankedKeywords.limit,
    competitorsDomainLimit: raw.collectionScope.competitorsDomain.limit,
  });
  const stripRanked = ({
    minimumRankGroup: _minimumRankGroup,
    maximumRankGroup: _maximumRankGroup,
    ...request
  }: DataForSeoRankedKeywordsRequest): DataForSeoRankedKeywordsRequest => request;
  const stripCompetitor = ({
    maximumRankGroup: _maximumRankGroup,
    ...request
  }: DataForSeoCompetitorsDomainRequest): DataForSeoCompetitorsDomainRequest => request;
  return {
    schemaVersion: "dataforseo.search_landscape.v1",
    collectionScope: scope,
    rankedKeywords: {
      ...raw.rankedKeywords,
      request: stripRanked(raw.rankedKeywords.request),
    },
    competitorsDomain: {
      ...raw.competitorsDomain,
      request: stripCompetitor(raw.competitorsDomain.request),
    },
    capturedAt: raw.capturedAt,
    availability: raw.availability,
    stopReason:
      raw.availability === "partial"
        ? "DATAFORSEO_SEARCH_LANDSCAPE_ROW_CAP_REACHED"
        : null,
    limitation: raw.limitation,
  };
}

export function dataForSeoSearchLandscapeV2SnapshotSummary(
  value: DataForSeoSearchLandscapeV2Scope,
  collectedAt: string,
) {
  const collectionScope = parseDataForSeoSearchLandscapeV2Scope(value);
  const date = new Date(collectedAt);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== collectedAt) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO search-landscape v2 collection time must be canonical UTC.",
    );
  }
  return {
    collectionScope,
    timing: {
      collectedAt,
      dataAsOf: null,
      observedAt: null,
      freshness: "unknown" as const,
    },
  };
}

export function createDataForSeoSearchLandscapeV2Adapter(
  client: DataForSeoSearchLandscapeV2Client,
  options: DataForSeoSearchLandscapeV2AdapterOptions = {},
): DataForSeoSearchLandscapeV2Adapter {
  return {
    provider: "dataforseo",
    async validateConfig(config) {
      return parseDataForSeoSearchLandscapeV2Scope(config);
    },
    async capabilities(config) {
      parseDataForSeoSearchLandscapeV2Scope(config);
      return [
        {
          datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
          operation: DATAFORSEO_SEARCH_LANDSCAPE_V2_OPERATION,
          available: true,
          limitation: "DataForSEO v2 uses two base calls and at most one paid SERP-competitor fallback.",
        },
      ];
    },
    async collect(params, ctx) {
      const collectionScope = parseDataForSeoSearchLandscapeV2Scope(params);
      const v1Scope = createDataForSeoSearchLandscapeScope({
        target: collectionScope.target,
        marketCode: collectionScope.marketCode,
        languageTag: collectionScope.languageTag,
        ...locationFields(collectionScope.location),
        rankedKeywordsLimit: collectionScope.rankedKeywords.limit,
        competitorsDomainLimit: collectionScope.competitorsDomain.limit,
      });
      const baseAdapter = createDataForSeoSearchLandscapeAdapter({
        rankedKeywords(request, signal) {
          return client.rankedKeywords(
            { ...request, minimumRankGroup: 1, maximumRankGroup: 100 },
            signal,
          );
        },
        competitorsDomain(request, signal) {
          return client.competitorsDomain(
            { ...request, maximumRankGroup: 100 },
            signal,
          );
        },
      });
      const base = await baseAdapter.collect(v1Scope, ctx);
      const rankedKeywords = {
        ...base.raw.rankedKeywords,
        request: rankedRequest(collectionScope),
      };
      const competitorsDomain = {
        ...base.raw.competitorsDomain,
        request: competitorRequest(collectionScope),
      };
      let serpCompetitors: DataForSeoSearchLandscapeSerpCompetitorsRaw;
      if (competitorsDomain.rows.length > 0) {
        serpCompetitors = noSerp("not_needed");
      } else if (collectionScope.serpCompetitors.seeds.length === 0) {
        serpCompetitors = noSerp("skipped_no_seeds");
      } else {
        const request = serpRequest(collectionScope);
        const response = await client.serpCompetitors(request, ctx.signal);
        if (response.itemsCount > request.limit) {
          throw new SourceError(
            "INVALID_RESPONSE",
            "DataForSEO SERP Competitors returned more rows than requested.",
          );
        }
        serpCompetitors = {
          status: "collected",
          request,
          ...sanitizeSerp(response, collectionScope.target),
        };
      }
      const availability: Availability =
        base.availability === "partial" ||
        serpCompetitors.totalCount > serpCompetitors.itemsCount
          ? "partial"
          : "available";
      const stopReason =
        availability === "partial"
          ? DATAFORSEO_SEARCH_LANDSCAPE_V2_ROW_CAP_STOP_REASON
          : null;
      const limitation = limitationFor(collectionScope, serpCompetitors);
      const capturedAt = (options.now?.() ?? new Date()).toISOString();
      const retainedRows =
        rankedKeywords.rows.length +
        competitorsDomain.rows.length +
        serpCompetitors.rows.length;
      return {
        availability,
        raw: {
          schemaVersion: DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
          collectionScope,
          rankedKeywords,
          competitorsDomain,
          serpCompetitors,
          capturedAt,
          availability,
          stopReason,
          limitation,
        },
        capturedAt,
        sourceWindow: { start: null, end: null },
        rowCount: retainedRows,
        stopReason,
        providerUsage: {
          apiCalls: serpCompetitors.status === "collected" ? 3 : 2,
          rowsReturned:
            (base.providerUsage.rowsReturned ?? 0) + serpCompetitors.itemsCount,
          rowsRetained: retainedRows,
          costUsd: roundedCost(
            base.providerUsage.costUsd ?? 0,
            serpCompetitors.costUsd,
          ),
        },
        limitation,
      };
    },
    async *normalize(raw, ctx) {
      const parsedScope = parseDataForSeoSearchLandscapeV2Scope(raw.collectionScope);
      const baseAdapter = createDataForSeoSearchLandscapeAdapter({
        rankedKeywords: () => Promise.reject(new SourceError("AUTH_REQUIRED", "not bound")),
        competitorsDomain: () => Promise.reject(new SourceError("AUTH_REQUIRED", "not bound")),
      });
      for await (const observation of baseAdapter.normalize(legacyRaw(raw), ctx)) {
        yield observation;
      }
      for (const row of raw.serpCompetitors.rows) {
        yield buildObservation({
          provider: "dataforseo",
          metricKey: METRIC_DATAFORSEO_SERP_COMPETITOR,
          subjectType: "site",
          subjectRef: row.domain,
          observedAt: ctx.capturedAt,
          availability: "available",
          value: {
            json: {
              targetDomain: parsedScope.target,
              competitorDomain: row.domain,
              averagePosition: row.averagePosition,
              medianPosition: row.medianPosition,
              rating: row.rating,
              organicEstimatedTrafficVolume: row.organicEstimatedTrafficVolume,
              keywordsCount: row.keywordsCount,
              visibility: row.visibility,
              relevantSerpItems: row.relevantSerpItems,
              seedCount: parsedScope.serpCompetitors.seeds.length,
              marketCode: parsedScope.marketCode,
              languageCode: parsedScope.providerLanguageCode,
            },
          },
          limitation: raw.limitation,
        });
      }
    },
  };
}

const unboundClient: DataForSeoSearchLandscapeV2Client = {
  rankedKeywords: () => Promise.reject(new SourceError("AUTH_REQUIRED", "DataForSEO credentials are required.")),
  competitorsDomain: () => Promise.reject(new SourceError("AUTH_REQUIRED", "DataForSEO credentials are required.")),
  serpCompetitors: () => Promise.reject(new SourceError("AUTH_REQUIRED", "DataForSEO credentials are required.")),
};

export const dataforseoSearchLandscapeV2Adapter =
  createDataForSeoSearchLandscapeV2Adapter(unboundClient);
