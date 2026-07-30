import {
  SourceError,
  type Availability,
  type CollectionContext,
  type CollectionResult,
  type NormalizeContext,
  type NormalizedObservation,
} from "../adapter.ts";
import { buildObservation } from "../observations.ts";
import {
  createDataForSeoCollectionScope,
  dataforseoAdapter,
  DATAFORSEO_METHOD_VERSION,
  DATAFORSEO_ROW_CAP_STOP_REASON,
  type DataForSeoCollectionLocation,
  type DataForSeoRaw,
  type DataForSeoRawRequest,
} from "./adapter.ts";
import {
  DEFAULT_DATAFORSEO_COMPETITORS_DOMAIN_LIMIT,
  DEFAULT_DATAFORSEO_LIMIT,
  MAX_DATAFORSEO_LIMIT,
  type DataForSeoCompetitorDomainRow,
  type DataForSeoCompetitorsDomainRequest,
  type DataForSeoCompetitorsDomainResponse,
  type DataForSeoRankedKeywordRow,
  type DataForSeoRankedKeywordsRequest,
  type DataForSeoRankedKeywordsResponse,
  type DataForSeoSearchLandscapeClient,
} from "./client.ts";

export const DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY =
  "dataforseo.search_landscape.v1" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION =
  "dataforseo.search_landscape.v1" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_SCOPE_VERSION =
  "dataforseo.search-landscape-scope.v1" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_QUERY_KIND =
  "search_landscape" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_OPERATION =
  "search_landscape" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_ROW_CAP_STOP_REASON =
  "DATAFORSEO_SEARCH_LANDSCAPE_ROW_CAP_REACHED" as const;
export const METRIC_DATAFORSEO_COMPETITOR_DOMAIN =
  "dataforseo.competitor_domain.v1" as const;

const RANKED_KEYWORD_ORDER_BY = Object.freeze([
  "keyword_data.keyword_info.search_volume,desc",
  "ranked_serp_element.serp_item.rank_group,asc",
] as const);
const COMPETITOR_DOMAIN_ORDER_BY = Object.freeze([
  "intersections,desc",
  "competitor_metrics.organic.etv,desc",
  "domain,asc",
] as const);
const ORGANIC_ITEM_TYPES = Object.freeze(["organic"] as const);
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const BASE_LIMITATION =
  "DataForSEO Labs vendor observations combine the live Google organic ranked-keywords endpoint with the organic competitors-domain endpoint. DataForSEO documents the competitors-domain data as updated weekly. Neither response supplies an exact dataset timestamp, so capturedAt records collection time only. Every intersections value is an integer keyword-intersection count, not a similarity percentage; no competitor name or business relationship is inferred.";

export type DataForSeoSearchLandscapeRankedKeywordsPolicy = Readonly<{
  readonly limit: number;
  readonly historicalSerpMode: "live";
  readonly itemTypes: readonly ["organic"];
  readonly minimumSearchVolumeExclusive: 0;
  readonly rankGroup: Readonly<{
    readonly minimum: 4;
    readonly maximum: 20;
  }>;
  readonly orderBy: readonly [
    "keyword_data.keyword_info.search_volume,desc",
    "ranked_serp_element.serp_item.rank_group,asc",
  ];
}>;

export type DataForSeoSearchLandscapeCompetitorsDomainPolicy = Readonly<{
  readonly limit: number;
  readonly itemTypes: readonly ["organic"];
  readonly includeClickstreamData: false;
  readonly minimumIntersectionsExclusive: 0;
  readonly orderBy: readonly [
    "intersections,desc",
    "competitor_metrics.organic.etv,desc",
    "domain,asc",
  ];
  readonly offset: 0;
  readonly maxRankGroup: 20;
  readonly excludeTopDomains: true;
  readonly excludeDomains: readonly [string];
  readonly ignoreSynonyms: false;
}>;

/**
 * Exact, credential-free scope frozen before collection. Fixed endpoint policy
 * is explicit here so a Snapshot records the two queries it actually represents.
 */
export type DataForSeoSearchLandscapeScope = Readonly<{
  readonly schemaVersion: typeof DATAFORSEO_SEARCH_LANDSCAPE_SCOPE_VERSION;
  readonly queryKind: typeof DATAFORSEO_SEARCH_LANDSCAPE_QUERY_KIND;
  readonly target: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly providerLanguageCode: string;
  readonly location: DataForSeoCollectionLocation;
  readonly rankedKeywords: DataForSeoSearchLandscapeRankedKeywordsPolicy;
  readonly competitorsDomain: DataForSeoSearchLandscapeCompetitorsDomainPolicy;
}>;

export interface DataForSeoSearchLandscapeScopeInput {
  readonly target: unknown;
  readonly marketCode: unknown;
  readonly languageTag: unknown;
  readonly locationCode?: unknown;
  readonly locationName?: unknown;
  readonly rankedKeywordsLimit?: unknown;
  readonly competitorsDomainLimit?: unknown;
}

export interface DataForSeoSearchLandscapeRankedKeywordsRaw {
  readonly request: DataForSeoRankedKeywordsRequest;
  readonly rows: readonly DataForSeoRankedKeywordRow[];
  readonly totalCount: number;
  readonly itemsCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
}

export interface DataForSeoSearchLandscapeCompetitorsDomainRaw {
  readonly request: DataForSeoCompetitorsDomainRequest;
  /** Canonical, self-excluded, de-duplicated rows in deterministic order. */
  readonly rows: readonly DataForSeoCompetitorDomainRow[];
  readonly totalCount: number;
  readonly itemsCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
  readonly providerRowsCount: number;
  readonly retainedRowsCount: number;
  readonly excludedSelfCount: number;
  readonly duplicateRowsRemovedCount: number;
}

export interface DataForSeoSearchLandscapeRaw {
  readonly schemaVersion: typeof DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION;
  readonly collectionScope: DataForSeoSearchLandscapeScope;
  readonly rankedKeywords: DataForSeoSearchLandscapeRankedKeywordsRaw;
  readonly competitorsDomain: DataForSeoSearchLandscapeCompetitorsDomainRaw;
  readonly capturedAt: string;
  readonly availability: Availability;
  readonly stopReason:
    | typeof DATAFORSEO_SEARCH_LANDSCAPE_ROW_CAP_STOP_REASON
    | null;
  readonly limitation: string;
}

export type DataForSeoSearchLandscapeSnapshotSummary = Readonly<{
  readonly collectionScope: DataForSeoSearchLandscapeScope;
  readonly timing: Readonly<{
    readonly collectedAt: string;
    readonly dataAsOf: null;
    readonly observedAt: null;
    readonly freshness: "unknown";
  }>;
}>;

export interface DataForSeoCompetitorDomainProjection {
  readonly targetDomain: string;
  readonly competitorDomain: string;
  /** Integer keyword-intersection count; deliberately not a percentage. */
  readonly intersections: number;
  readonly averagePosition: number;
  readonly summedPosition: number;
  readonly organicEstimatedTrafficVolume: number;
  readonly marketCode: string;
  readonly languageCode: string;
}

export interface DataForSeoSearchLandscapeCapability {
  readonly datasetKey: typeof DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY;
  readonly operation: typeof DATAFORSEO_SEARCH_LANDSCAPE_OPERATION;
  readonly available: boolean;
  readonly limitation: string;
}

export interface DataForSeoSearchLandscapeAdapter {
  readonly provider: "dataforseo";
  validateConfig(config: unknown): Promise<DataForSeoSearchLandscapeScope>;
  capabilities(
    config: DataForSeoSearchLandscapeScope,
  ): Promise<DataForSeoSearchLandscapeCapability[]>;
  collect(
    params: DataForSeoSearchLandscapeScope,
    ctx: CollectionContext,
  ): Promise<CollectionResult<DataForSeoSearchLandscapeRaw>>;
  normalize(
    raw: DataForSeoSearchLandscapeRaw,
    ctx: NormalizeContext,
  ): AsyncIterable<NormalizedObservation>;
}

export interface DataForSeoSearchLandscapeAdapterOptions {
  readonly now?: () => Date;
}

type JsonRecord = Record<string, unknown>;

function asStrictRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} must be an object.`,
    );
  }
  return value as JsonRecord;
}

/** Public, credential-free Snapshot metadata for one composite collection. */
export function dataForSeoSearchLandscapeSnapshotSummary(
  value: DataForSeoSearchLandscapeScope,
  collectedAt: string,
): DataForSeoSearchLandscapeSnapshotSummary {
  const collectionScope = parseDataForSeoSearchLandscapeScope(value);
  const date = new Date(collectedAt);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== collectedAt) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO search-landscape collection time must be a canonical UTC instant.",
    );
  }
  return {
    collectionScope,
    timing: {
      collectedAt,
      dataAsOf: null,
      observedAt: null,
      freshness: "unknown",
    },
  };
}

function assertExactKeys(
  value: JsonRecord,
  expected: readonly string[],
  label: string,
): void {
  const allowed = new Set(expected);
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => !allowed.has(key))
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} contains an unknown or missing field.`,
    );
  }
}

function assertAllowedKeys(
  value: JsonRecord,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} contains an unknown field.`,
    );
  }
}

function assertExactStringArray(
  value: unknown,
  expected: readonly string[],
  label: string,
): void {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((item, index) => item !== expected[index])
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} is not the frozen policy value.`,
    );
  }
}

function normalizeLimit(
  value: unknown,
  fallback: number,
  label: string,
): number {
  if (value === undefined || value === null) return fallback;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_DATAFORSEO_LIMIT
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} must be an integer from 1 to ${MAX_DATAFORSEO_LIMIT}.`,
    );
  }
  return value as number;
}

function freezeLocation(
  location: DataForSeoCollectionLocation,
): DataForSeoCollectionLocation {
  return location.kind === "code"
    ? Object.freeze({ kind: "code" as const, code: location.code })
    : Object.freeze({ kind: "name" as const, name: location.name });
}

/** Build the only accepted two-query search-landscape scope. */
export function createDataForSeoSearchLandscapeScope(
  input: DataForSeoSearchLandscapeScopeInput,
): DataForSeoSearchLandscapeScope {
  const inputRecord = asStrictRecord(
    input,
    "DataForSEO search-landscape scope input",
  );
  assertAllowedKeys(
    inputRecord,
    [
      "target",
      "marketCode",
      "languageTag",
      "locationCode",
      "locationName",
      "rankedKeywordsLimit",
      "competitorsDomainLimit",
    ],
    "DataForSEO search-landscape scope input",
  );
  const rankedKeywordsLimit = normalizeLimit(
    input.rankedKeywordsLimit,
    DEFAULT_DATAFORSEO_LIMIT,
    "DataForSEO rankedKeywordsLimit",
  );
  const competitorsDomainLimit = normalizeLimit(
    input.competitorsDomainLimit,
    DEFAULT_DATAFORSEO_COMPETITORS_DOMAIN_LIMIT,
    "DataForSEO competitorsDomainLimit",
  );
  const legacyScope = createDataForSeoCollectionScope({
    target: input.target,
    marketCode: input.marketCode,
    languageTag: input.languageTag,
    ...(input.locationCode === undefined
      ? {}
      : { locationCode: input.locationCode }),
    ...(input.locationName === undefined
      ? {}
      : { locationName: input.locationName }),
    limit: rankedKeywordsLimit,
  });
  const rankedKeywords = Object.freeze({
    limit: rankedKeywordsLimit,
    historicalSerpMode: "live" as const,
    itemTypes: ORGANIC_ITEM_TYPES,
    minimumSearchVolumeExclusive: 0 as const,
    rankGroup: Object.freeze({
      minimum: 4 as const,
      maximum: 20 as const,
    }),
    orderBy: RANKED_KEYWORD_ORDER_BY,
  });
  const competitorsDomain = Object.freeze({
    limit: competitorsDomainLimit,
    itemTypes: ORGANIC_ITEM_TYPES,
    includeClickstreamData: false as const,
    minimumIntersectionsExclusive: 0 as const,
    orderBy: COMPETITOR_DOMAIN_ORDER_BY,
    offset: 0 as const,
    maxRankGroup: 20 as const,
    excludeTopDomains: true as const,
    excludeDomains: Object.freeze([legacyScope.target] as const),
    ignoreSynonyms: false as const,
  });
  return Object.freeze({
    schemaVersion: DATAFORSEO_SEARCH_LANDSCAPE_SCOPE_VERSION,
    queryKind: DATAFORSEO_SEARCH_LANDSCAPE_QUERY_KIND,
    target: legacyScope.target,
    marketCode: legacyScope.marketCode,
    languageTag: legacyScope.languageTag,
    providerLanguageCode: legacyScope.providerLanguageCode,
    location: freezeLocation(legacyScope.location),
    rankedKeywords,
    competitorsDomain,
  });
}

function locationInputFromFrozenScope(
  value: unknown,
): { locationCode: unknown } | { locationName: unknown } {
  const location = asStrictRecord(
    value,
    "DataForSEO search-landscape scope location",
  );
  if (location.kind === "code") {
    assertExactKeys(
      location,
      ["kind", "code"],
      "DataForSEO search-landscape scope location",
    );
    return { locationCode: location.code };
  }
  if (location.kind === "name") {
    assertExactKeys(
      location,
      ["kind", "name"],
      "DataForSEO search-landscape scope location",
    );
    return { locationName: location.name };
  }
  throw new SourceError(
    "INVALID_CONFIGURATION",
    "DataForSEO search-landscape scope location kind is unsupported.",
  );
}

function assertCanonicalLocation(
  value: unknown,
  canonical: DataForSeoCollectionLocation,
): void {
  const location = asStrictRecord(
    value,
    "DataForSEO search-landscape scope location",
  );
  const matches =
    canonical.kind === "code"
      ? location.kind === "code" && location.code === canonical.code
      : location.kind === "name" && location.name === canonical.name;
  if (!matches) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO search-landscape scope location is not canonical.",
    );
  }
}

function assertFrozenRankedPolicy(
  value: JsonRecord,
  canonical: DataForSeoSearchLandscapeRankedKeywordsPolicy,
): void {
  assertExactKeys(
    value,
    [
      "limit",
      "historicalSerpMode",
      "itemTypes",
      "minimumSearchVolumeExclusive",
      "rankGroup",
      "orderBy",
    ],
    "DataForSEO search-landscape rankedKeywords policy",
  );
  const rankGroup = asStrictRecord(
    value.rankGroup,
    "DataForSEO search-landscape rankGroup policy",
  );
  assertExactKeys(
    rankGroup,
    ["minimum", "maximum"],
    "DataForSEO search-landscape rankGroup policy",
  );
  assertExactStringArray(
    value.itemTypes,
    canonical.itemTypes,
    "DataForSEO search-landscape ranked itemTypes",
  );
  assertExactStringArray(
    value.orderBy,
    canonical.orderBy,
    "DataForSEO search-landscape ranked orderBy",
  );
  if (
    value.limit !== canonical.limit ||
    value.historicalSerpMode !== canonical.historicalSerpMode ||
    value.minimumSearchVolumeExclusive !==
      canonical.minimumSearchVolumeExclusive ||
    rankGroup.minimum !== canonical.rankGroup.minimum ||
    rankGroup.maximum !== canonical.rankGroup.maximum
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO search-landscape rankedKeywords policy is not canonical.",
    );
  }
}

function assertFrozenCompetitorsPolicy(
  value: JsonRecord,
  canonical: DataForSeoSearchLandscapeCompetitorsDomainPolicy,
): void {
  assertExactKeys(
    value,
    [
      "limit",
      "itemTypes",
      "includeClickstreamData",
      "minimumIntersectionsExclusive",
      "orderBy",
      "offset",
      "maxRankGroup",
      "excludeTopDomains",
      "excludeDomains",
      "ignoreSynonyms",
    ],
    "DataForSEO search-landscape competitorsDomain policy",
  );
  assertExactStringArray(
    value.itemTypes,
    canonical.itemTypes,
    "DataForSEO search-landscape competitor itemTypes",
  );
  assertExactStringArray(
    value.orderBy,
    canonical.orderBy,
    "DataForSEO search-landscape competitor orderBy",
  );
  assertExactStringArray(
    value.excludeDomains,
    canonical.excludeDomains,
    "DataForSEO search-landscape competitor excludeDomains",
  );
  if (
    value.limit !== canonical.limit ||
    value.includeClickstreamData !== canonical.includeClickstreamData ||
    value.minimumIntersectionsExclusive !==
      canonical.minimumIntersectionsExclusive ||
    value.offset !== canonical.offset ||
    value.maxRankGroup !== canonical.maxRankGroup ||
    value.excludeTopDomains !== canonical.excludeTopDomains ||
    value.ignoreSynonyms !== canonical.ignoreSynonyms
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO search-landscape competitorsDomain policy is not canonical.",
    );
  }
}

/**
 * Parse a previously frozen scope. Every unknown key is rejected, including
 * nested keys, so secrets and unfrozen provider options cannot be smuggled into
 * customer-readable Snapshot metadata.
 */
export function parseDataForSeoSearchLandscapeScope(
  value: unknown,
): DataForSeoSearchLandscapeScope {
  const input = asStrictRecord(value, "DataForSEO search-landscape scope");
  assertExactKeys(
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
    ],
    "DataForSEO search-landscape scope",
  );
  if (
    input.schemaVersion !== DATAFORSEO_SEARCH_LANDSCAPE_SCOPE_VERSION ||
    input.queryKind !== DATAFORSEO_SEARCH_LANDSCAPE_QUERY_KIND
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO search-landscape scope version or query kind is unsupported.",
    );
  }
  const rankedKeywords = asStrictRecord(
    input.rankedKeywords,
    "DataForSEO search-landscape rankedKeywords policy",
  );
  const competitorsDomain = asStrictRecord(
    input.competitorsDomain,
    "DataForSEO search-landscape competitorsDomain policy",
  );
  const canonical = createDataForSeoSearchLandscapeScope({
    target: input.target,
    marketCode: input.marketCode,
    languageTag: input.languageTag,
    ...locationInputFromFrozenScope(input.location),
    rankedKeywordsLimit: rankedKeywords.limit,
    competitorsDomainLimit: competitorsDomain.limit,
  });
  if (
    input.target !== canonical.target ||
    input.marketCode !== canonical.marketCode ||
    input.languageTag !== canonical.languageTag ||
    input.providerLanguageCode !== canonical.providerLanguageCode
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO search-landscape scope is not canonical.",
    );
  }
  assertCanonicalLocation(input.location, canonical.location);
  assertFrozenRankedPolicy(rankedKeywords, canonical.rankedKeywords);
  assertFrozenCompetitorsPolicy(
    competitorsDomain,
    canonical.competitorsDomain,
  );
  return canonical;
}

function requestForScope(
  scope: DataForSeoSearchLandscapeScope,
  limit: number,
): DataForSeoRankedKeywordsRequest {
  return scope.location.kind === "code"
    ? {
        target: scope.target,
        locationCode: scope.location.code,
        languageCode: scope.providerLanguageCode,
        limit,
      }
    : {
        target: scope.target,
        locationName: scope.location.name,
        languageCode: scope.providerLanguageCode,
        limit,
      };
}

function competitorRequestForScope(
  scope: DataForSeoSearchLandscapeScope,
): DataForSeoCompetitorsDomainRequest {
  return requestForScope(
    scope,
    scope.competitorsDomain.limit,
  ) satisfies DataForSeoCompetitorsDomainRequest;
}

function assertNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${label} must be a non-negative number.`,
    );
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${label} must be a non-negative integer.`,
    );
  }
  return value as number;
}

function assertPositiveInteger(value: unknown, label: string): number {
  const parsed = assertNonNegativeInteger(value, label);
  if (parsed === 0) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${label} must be a positive integer.`,
    );
  }
  return parsed;
}

function canonicalDomain(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SourceError("INVALID_RESPONSE", `${label} is missing.`);
  }
  const input = value.trim();
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`,
    );
  } catch {
    throw new SourceError("INVALID_RESPONSE", `${label} is invalid.`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    throw new SourceError("INVALID_RESPONSE", `${label} is invalid.`);
  }
  const domain = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  if (!HOSTNAME_RE.test(domain)) {
    throw new SourceError("INVALID_RESPONSE", `${label} is invalid.`);
  }
  return domain;
}

function sanitizeRankedRows(
  response: DataForSeoRankedKeywordsResponse,
): readonly DataForSeoRankedKeywordRow[] {
  if (!Array.isArray(response.rows)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO ranked-keywords rows must be an array.",
    );
  }
  const rows = response.rows.map((row, index) => {
    if (
      typeof row !== "object" ||
      row === null ||
      typeof row.keyword !== "string" ||
      row.keyword.trim() === ""
    ) {
      throw new SourceError(
        "INVALID_RESPONSE",
        `DataForSEO ranked-keywords row ${index} is invalid.`,
      );
    }
    const searchVolume =
      row.searchVolume === null
        ? null
        : assertNonNegativeNumber(
            row.searchVolume,
            `DataForSEO ranked-keywords row ${index} searchVolume`,
          );
    const currentUrl =
      row.currentUrl === null
        ? null
        : typeof row.currentUrl === "string"
          ? row.currentUrl
          : (() => {
              throw new SourceError(
                "INVALID_RESPONSE",
                `DataForSEO ranked-keywords row ${index} currentUrl is invalid.`,
              );
            })();
    const currentRank =
      row.currentRank === null
        ? null
        : assertNonNegativeNumber(
            row.currentRank,
            `DataForSEO ranked-keywords row ${index} currentRank`,
          );
    return {
      keyword: row.keyword.trim(),
      searchVolume,
      currentUrl,
      currentRank,
    };
  });
  assertEndpointSummary(
    response,
    rows.length,
    "DataForSEO ranked-keywords response",
  );
  return rows;
}

interface EndpointSummary {
  readonly totalCount: unknown;
  readonly itemsCount: unknown;
  readonly costUsd: unknown;
  readonly providerStatusCode: unknown;
  readonly taskStatusCode: unknown;
}

function assertEndpointSummary(
  response: EndpointSummary,
  rowsLength: number,
  label: string,
): void {
  const totalCount = assertNonNegativeInteger(
    response.totalCount,
    `${label} totalCount`,
  );
  const itemsCount = assertNonNegativeInteger(
    response.itemsCount,
    `${label} itemsCount`,
  );
  assertNonNegativeNumber(response.costUsd, `${label} costUsd`);
  assertNonNegativeInteger(
    response.providerStatusCode,
    `${label} providerStatusCode`,
  );
  assertNonNegativeInteger(
    response.taskStatusCode,
    `${label} taskStatusCode`,
  );
  if (itemsCount !== rowsLength || totalCount < itemsCount) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${label} contains contradictory row counts.`,
    );
  }
}

function assertWithinRequestedLimit(
  itemsCount: number,
  limit: number,
  label: string,
): void {
  if (itemsCount > limit) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${label} returned more rows than the frozen request limit.`,
    );
  }
}

function compareDomains(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareCompetitorRows(
  a: DataForSeoCompetitorDomainRow,
  b: DataForSeoCompetitorDomainRow,
): number {
  return (
    b.intersections - a.intersections ||
    b.organicEstimatedTrafficVolume -
      a.organicEstimatedTrafficVolume ||
    compareDomains(a.domain, b.domain)
  );
}

function compareDuplicateCandidates(
  a: DataForSeoCompetitorDomainRow,
  b: DataForSeoCompetitorDomainRow,
): number {
  return (
    compareCompetitorRows(a, b) ||
    a.averagePosition - b.averagePosition ||
    a.summedPosition - b.summedPosition
  );
}

function sanitizeCompetitorRows(
  response: DataForSeoCompetitorsDomainResponse,
  target: string,
): {
  readonly rows: readonly DataForSeoCompetitorDomainRow[];
  readonly providerRowsCount: number;
  readonly excludedSelfCount: number;
  readonly duplicateRowsRemovedCount: number;
} {
  if (!Array.isArray(response.rows)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO competitors-domain rows must be an array.",
    );
  }
  const byDomain = new Map<string, DataForSeoCompetitorDomainRow>();
  let excludedSelfCount = 0;
  let duplicateRowsRemovedCount = 0;
  for (const [index, row] of response.rows.entries()) {
    if (typeof row !== "object" || row === null) {
      throw new SourceError(
        "INVALID_RESPONSE",
        `DataForSEO competitors-domain row ${index} is invalid.`,
      );
    }
    const canonical: DataForSeoCompetitorDomainRow = {
      domain: canonicalDomain(
        row.domain,
        `DataForSEO competitors-domain row ${index} domain`,
      ),
      averagePosition: assertNonNegativeNumber(
        row.averagePosition,
        `DataForSEO competitors-domain row ${index} averagePosition`,
      ),
      summedPosition: assertNonNegativeNumber(
        row.summedPosition,
        `DataForSEO competitors-domain row ${index} summedPosition`,
      ),
      intersections: assertPositiveInteger(
        row.intersections,
        `DataForSEO competitors-domain row ${index} intersections`,
      ),
      organicEstimatedTrafficVolume: assertNonNegativeNumber(
        row.organicEstimatedTrafficVolume,
        `DataForSEO competitors-domain row ${index} organicEstimatedTrafficVolume`,
      ),
    };
    if (canonical.domain === target) {
      excludedSelfCount += 1;
      continue;
    }
    const existing = byDomain.get(canonical.domain);
    if (existing === undefined) {
      byDomain.set(canonical.domain, canonical);
      continue;
    }
    duplicateRowsRemovedCount += 1;
    if (compareDuplicateCandidates(canonical, existing) < 0) {
      byDomain.set(canonical.domain, canonical);
    }
  }
  assertEndpointSummary(
    response,
    response.rows.length,
    "DataForSEO competitors-domain response",
  );
  return {
    rows: [...byDomain.values()].sort(compareCompetitorRows),
    providerRowsCount: response.rows.length,
    excludedSelfCount,
    duplicateRowsRemovedCount,
  };
}

function roundedCost(left: number, right: number): number {
  return Number((left + right).toFixed(12));
}

function limitationFor(
  ranked: DataForSeoSearchLandscapeRankedKeywordsRaw | undefined,
  competitors:
    | DataForSeoSearchLandscapeCompetitorsDomainRaw
    | undefined,
): string {
  const details = [BASE_LIMITATION];
  if (
    ranked !== undefined &&
    ranked.totalCount > ranked.itemsCount
  ) {
    details.push(
      `Only the first ${ranked.itemsCount} of ${ranked.totalCount} matching ranked keywords were returned.`,
    );
  }
  if (
    competitors !== undefined &&
    competitors.totalCount > competitors.itemsCount
  ) {
    details.push(
      `Only the first ${competitors.itemsCount} of ${competitors.totalCount} matching competitor-domain rows were returned.`,
    );
  }
  if (
    ranked?.itemsCount === 0 &&
    ranked.totalCount === 0 &&
    competitors?.itemsCount === 0 &&
    competitors.totalCount === 0
  ) {
    details.push(
      "The provider returned observed empty result sets for both calls; no zero-valued keyword or competitor facts were fabricated.",
    );
  }
  if (
    competitors !== undefined &&
    (competitors.excludedSelfCount > 0 ||
      competitors.duplicateRowsRemovedCount > 0)
  ) {
    details.push(
      `${competitors.excludedSelfCount} self-domain row(s) and ${competitors.duplicateRowsRemovedCount} duplicate competitor row(s) were removed locally.`,
    );
  }
  return details.join(" ");
}

function nestedLegacyRaw(
  raw: DataForSeoSearchLandscapeRaw,
): DataForSeoRaw {
  const request: DataForSeoRawRequest = {
    ...raw.rankedKeywords.request,
    marketCode: raw.collectionScope.marketCode,
    methodVersion: DATAFORSEO_METHOD_VERSION,
  };
  const availability: Availability =
    raw.rankedKeywords.totalCount > raw.rankedKeywords.itemsCount
      ? "partial"
      : "available";
  return {
    schemaVersion: DATAFORSEO_METHOD_VERSION,
    request,
    rows: raw.rankedKeywords.rows,
    totalCount: raw.rankedKeywords.totalCount,
    itemsCount: raw.rankedKeywords.itemsCount,
    costUsd: raw.rankedKeywords.costUsd,
    providerStatusCode: raw.rankedKeywords.providerStatusCode,
    taskStatusCode: raw.rankedKeywords.taskStatusCode,
    capturedAt: raw.capturedAt,
    availability,
    stopReason:
      availability === "partial" ? DATAFORSEO_ROW_CAP_STOP_REASON : null,
    limitation: raw.limitation,
  };
}

/**
 * Build the atomic two-call adapter. Neither endpoint result is exposed if the
 * other rejects; successful responses are sanitized before raw persistence.
 */
export function createDataForSeoSearchLandscapeAdapter(
  client: DataForSeoSearchLandscapeClient,
  options: DataForSeoSearchLandscapeAdapterOptions = {},
): DataForSeoSearchLandscapeAdapter {
  return {
    provider: "dataforseo",

    async validateConfig(
      config: unknown,
    ): Promise<DataForSeoSearchLandscapeScope> {
      return parseDataForSeoSearchLandscapeScope(config);
    },

    async capabilities(
      config: DataForSeoSearchLandscapeScope,
    ): Promise<DataForSeoSearchLandscapeCapability[]> {
      parseDataForSeoSearchLandscapeScope(config);
      return [
        {
          datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
          operation: DATAFORSEO_SEARCH_LANDSCAPE_OPERATION,
          available: true,
          limitation: limitationFor(undefined, undefined),
        },
      ];
    },

    async collect(
      params: DataForSeoSearchLandscapeScope,
      ctx: CollectionContext,
    ): Promise<CollectionResult<DataForSeoSearchLandscapeRaw>> {
      const collectionScope = parseDataForSeoSearchLandscapeScope(params);
      const rankedRequest = requestForScope(
        collectionScope,
        collectionScope.rankedKeywords.limit,
      );
      const competitorRequest =
        competitorRequestForScope(collectionScope);
      // Schedule both calls before awaiting either. Promise.all gives the
      // collection one all-or-nothing result surface.
      const rankedPromise = Promise.resolve().then(() =>
        client.rankedKeywords(rankedRequest, ctx.signal),
      );
      const competitorPromise = Promise.resolve().then(() =>
        client.competitorsDomain(competitorRequest, ctx.signal),
      );
      const [rankedResponse, competitorResponse] = await Promise.all([
        rankedPromise,
        competitorPromise,
      ]);

      assertWithinRequestedLimit(
        rankedResponse.itemsCount,
        rankedRequest.limit,
        "DataForSEO ranked-keywords response",
      );
      assertWithinRequestedLimit(
        competitorResponse.itemsCount,
        competitorRequest.limit,
        "DataForSEO competitors-domain response",
      );
      const rankedRows = sanitizeRankedRows(rankedResponse);
      const competitorSelection = sanitizeCompetitorRows(
        competitorResponse,
        collectionScope.target,
      );
      const rankedKeywords: DataForSeoSearchLandscapeRankedKeywordsRaw = {
        request: rankedRequest,
        rows: rankedRows,
        totalCount: rankedResponse.totalCount,
        itemsCount: rankedResponse.itemsCount,
        costUsd: rankedResponse.costUsd,
        providerStatusCode: rankedResponse.providerStatusCode,
        taskStatusCode: rankedResponse.taskStatusCode,
      };
      const competitorsDomain: DataForSeoSearchLandscapeCompetitorsDomainRaw = {
        request: competitorRequest,
        rows: competitorSelection.rows,
        totalCount: competitorResponse.totalCount,
        itemsCount: competitorResponse.itemsCount,
        costUsd: competitorResponse.costUsd,
        providerStatusCode: competitorResponse.providerStatusCode,
        taskStatusCode: competitorResponse.taskStatusCode,
        providerRowsCount: competitorSelection.providerRowsCount,
        retainedRowsCount: competitorSelection.rows.length,
        excludedSelfCount: competitorSelection.excludedSelfCount,
        duplicateRowsRemovedCount:
          competitorSelection.duplicateRowsRemovedCount,
      };
      const availability: Availability =
        rankedKeywords.totalCount > rankedKeywords.itemsCount ||
        competitorsDomain.totalCount > competitorsDomain.itemsCount
          ? "partial"
          : "available";
      const stopReason =
        availability === "partial"
          ? DATAFORSEO_SEARCH_LANDSCAPE_ROW_CAP_STOP_REASON
          : null;
      const limitation = limitationFor(rankedKeywords, competitorsDomain);
      const capturedAt = (options.now?.() ?? new Date()).toISOString();
      const raw: DataForSeoSearchLandscapeRaw = {
        schemaVersion: DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
        collectionScope,
        rankedKeywords,
        competitorsDomain,
        capturedAt,
        availability,
        stopReason,
        limitation,
      };
      const retainedRows =
        rankedRows.length + competitorSelection.rows.length;
      return {
        availability,
        raw,
        capturedAt,
        sourceWindow: { start: null, end: null },
        rowCount: retainedRows,
        stopReason,
        providerUsage: {
          apiCalls: 2,
          rowsReturned:
            rankedResponse.itemsCount + competitorResponse.itemsCount,
          rowsRetained: retainedRows,
          costUsd: roundedCost(
            rankedResponse.costUsd,
            competitorResponse.costUsd,
          ),
        },
        limitation,
      };
    },

    async *normalize(
      raw: DataForSeoSearchLandscapeRaw,
      ctx: NormalizeContext,
    ): AsyncIterable<NormalizedObservation> {
      // Delegate the ranked-keywords half to the legacy normalizer so its
      // existing metric key, cluster logic, and projection remain unchanged.
      for await (const observation of dataforseoAdapter.normalize(
        nestedLegacyRaw(raw),
        ctx,
      )) {
        yield observation;
      }
      for (const row of raw.competitorsDomain.rows) {
        const projection: DataForSeoCompetitorDomainProjection = {
          targetDomain: raw.collectionScope.target,
          competitorDomain: row.domain,
          intersections: row.intersections,
          averagePosition: row.averagePosition,
          summedPosition: row.summedPosition,
          organicEstimatedTrafficVolume:
            row.organicEstimatedTrafficVolume,
          marketCode: raw.collectionScope.marketCode,
          languageCode: raw.collectionScope.providerLanguageCode,
        };
        yield buildObservation({
          provider: "dataforseo",
          metricKey: METRIC_DATAFORSEO_COMPETITOR_DOMAIN,
          subjectType: "site",
          subjectRef: row.domain,
          observedAt: ctx.capturedAt,
          availability: "available",
          value: { json: projection },
          limitation: raw.limitation,
        });
      }
    },
  };
}

const unboundSearchLandscapeClient: DataForSeoSearchLandscapeClient = {
  rankedKeywords(): Promise<never> {
    return Promise.reject(
      new SourceError(
        "AUTH_REQUIRED",
        "DataForSEO collection requires a credential-bound HTTP client.",
      ),
    );
  },
  competitorsDomain(): Promise<never> {
    return Promise.reject(
      new SourceError(
        "AUTH_REQUIRED",
        "DataForSEO collection requires a credential-bound HTTP client.",
      ),
    );
  },
};

/** Default composite instance supports validation/normalization but not live I/O. */
export const dataforseoSearchLandscapeAdapter =
  createDataForSeoSearchLandscapeAdapter(unboundSearchLandscapeClient);
