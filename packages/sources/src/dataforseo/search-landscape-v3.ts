import { createHash } from "node:crypto";
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
import type {
  DataForSeoAiCitationRequest,
  DataForSeoAiCitationResponse,
  DataForSeoSearchLandscapeV3Client,
} from "./client.ts";
import {
  METRIC_DATAFORSEO_COMPETITOR_DOMAIN,
  type DataForSeoCompetitorDomainProjection,
} from "./search-landscape.ts";
import {
  createDataForSeoSearchLandscapeV2Adapter,
  createDataForSeoSearchLandscapeV2Scope,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_ROW_CAP_STOP_REASON,
  METRIC_DATAFORSEO_SERP_COMPETITOR,
  type DataForSeoSearchLandscapeSerpCompetitorsRaw,
  type DataForSeoSearchLandscapeV2Raw,
  type DataForSeoSearchLandscapeV2Scope,
  type DataForSeoSearchLandscapeV2ScopeInput,
} from "./search-landscape-v2.ts";

export const DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY =
  "dataforseo.search_landscape.v3" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION =
  "dataforseo.search_landscape.v3" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_V3_SCOPE_VERSION =
  "dataforseo.search-landscape-scope.v3" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_V3_QUERY_KIND =
  "search_landscape" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_V3_OPERATION =
  "search_landscape" as const;
export const DATAFORSEO_SEARCH_LANDSCAPE_V3_PARTIAL_STOP_REASON =
  "DATAFORSEO_SEARCH_LANDSCAPE_V3_PARTIAL" as const;
export const METRIC_DATAFORSEO_COMPETITOR_DOMAIN_V2 =
  "dataforseo.competitor_domain.v2" as const;
export const METRIC_DATAFORSEO_COMPETITOR_AI_CITATION =
  "dataforseo.competitor_ai_citation.v1" as const;
export const DATAFORSEO_AI_CITATION_COHORT_SIZE = 20 as const;
export const DATAFORSEO_AI_CITATION_MAX_OUTPUT_TOKENS = 1_024 as const;
export const DATAFORSEO_AI_CITATION_MAX_CONCURRENCY = 1 as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH_RE = /^[0-9a-f]{64}$/u;
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

type JsonRecord = Record<string, unknown>;

export type DataForSeoGenerativeQuery = Readonly<{
  readonly entityId: string;
  readonly revision: number;
  readonly query: string;
  readonly normalizedQuery: string;
  readonly marketCode: string;
  readonly languageTag: string;
}>;

export interface DataForSeoAiCitationQuerySetHashInput {
  readonly model: string;
  readonly marketCode: string;
  readonly languageTag: string;
  readonly queries: readonly DataForSeoGenerativeQuery[];
}

export type DataForSeoAiCitationsScope =
  | Readonly<{
      readonly state: "disabled";
      readonly attemptedQueries: 0;
    }>
  | Readonly<{
      readonly state: "skipped_insufficient_query_cohort";
      readonly eligibleQueryCount: number;
      readonly attemptedQueries: 0;
    }>
  | Readonly<{
      readonly state: "enabled";
      readonly platform: "chat_gpt";
      readonly requestedModel: string;
      readonly attemptedQueries: typeof DATAFORSEO_AI_CITATION_COHORT_SIZE;
      readonly querySetHash: string;
      readonly maxOutputTokens: typeof DATAFORSEO_AI_CITATION_MAX_OUTPUT_TOKENS;
      readonly webSearch: true;
      readonly queries: readonly DataForSeoGenerativeQuery[];
      readonly trackedCompetitorDomains: readonly string[];
    }>;

export interface DataForSeoSearchLandscapeV3ScopeInput
  extends DataForSeoSearchLandscapeV2ScopeInput {
  readonly aiCitations?: unknown;
}

export type DataForSeoSearchLandscapeV3Scope = Readonly<
  Omit<DataForSeoSearchLandscapeV2Scope, "schemaVersion"> & {
    readonly schemaVersion: typeof DATAFORSEO_SEARCH_LANDSCAPE_V3_SCOPE_VERSION;
    readonly aiCitations: DataForSeoAiCitationsScope;
  }
>;

export type DataForSeoAiCitationRaw =
  | Readonly<{
      readonly state: "disabled";
      readonly attemptedQueries: 0;
      readonly observedQueries: 0;
      readonly unavailableQueries: 0;
      readonly outcomes: readonly [];
    }>
  | Readonly<{
      readonly state: "skipped_insufficient_query_cohort";
      readonly eligibleQueryCount: number;
      readonly attemptedQueries: 0;
      readonly observedQueries: 0;
      readonly unavailableQueries: 0;
      readonly outcomes: readonly [];
    }>
  | Readonly<{
      readonly state: "collected";
      readonly platform: "chat_gpt";
      readonly model: string;
      readonly querySetHash: string;
      readonly attemptedQueries: typeof DATAFORSEO_AI_CITATION_COHORT_SIZE;
      readonly observedQueries: number;
      readonly unavailableQueries: number;
      readonly outcomes: readonly DataForSeoAiCitationRawOutcome[];
    }>;

export type DataForSeoAiCitationRawOutcome = Readonly<{
  readonly queryEntityId: string;
  readonly queryRevision: number;
  readonly queryHash: string;
  readonly request: DataForSeoAiCitationRequest;
  readonly response: DataForSeoAiCitationResponse;
}>;

export interface DataForSeoSearchLandscapeV3Raw {
  readonly schemaVersion: typeof DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION;
  readonly collectionScope: DataForSeoSearchLandscapeV3Scope;
  readonly rankedKeywords: DataForSeoSearchLandscapeV2Raw["rankedKeywords"];
  readonly competitorsDomain: DataForSeoSearchLandscapeV2Raw["competitorsDomain"];
  readonly serpCompetitors: DataForSeoSearchLandscapeSerpCompetitorsRaw;
  readonly aiCitations: DataForSeoAiCitationRaw;
  readonly capturedAt: string;
  readonly availability: Availability;
  readonly stopReason:
    | typeof DATAFORSEO_SEARCH_LANDSCAPE_V3_PARTIAL_STOP_REASON
    | null;
  readonly limitation: string;
}

export interface DataForSeoSearchLandscapeV3Capability {
  readonly datasetKey: typeof DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY;
  readonly operation: typeof DATAFORSEO_SEARCH_LANDSCAPE_V3_OPERATION;
  readonly available: boolean;
  readonly limitation: string;
}

export interface DataForSeoSearchLandscapeV3Adapter {
  readonly provider: "dataforseo";
  validateConfig(config: unknown): Promise<DataForSeoSearchLandscapeV3Scope>;
  capabilities(
    config: DataForSeoSearchLandscapeV3Scope,
  ): Promise<DataForSeoSearchLandscapeV3Capability[]>;
  collect(
    params: DataForSeoSearchLandscapeV3Scope,
    ctx: CollectionContext,
  ): Promise<CollectionResult<DataForSeoSearchLandscapeV3Raw>>;
  normalize(
    raw: DataForSeoSearchLandscapeV3Raw,
    ctx: NormalizeContext,
  ): AsyncIterable<NormalizedObservation>;
}

export interface DataForSeoSearchLandscapeV3AdapterOptions {
  readonly now?: () => Date;
}

function strictRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourceError("INVALID_CONFIGURATION", `${label} must be an object.`);
  }
  return value as JsonRecord;
}

function exactKeys(
  value: JsonRecord,
  expected: readonly string[],
  label: string,
): void {
  const allowed = new Set(expected);
  const keys = Object.keys(value);
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
      left.every((value, index) => canonicalEquivalent(value, right[index]))
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

function canonicalText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new SourceError("INVALID_CONFIGURATION", `${label} must be a string.`);
  }
  const canonical = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (canonical.length < 1 || canonical.length > maximum) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} must contain 1 to ${maximum} characters.`,
    );
  }
  return canonical;
}

function canonicalQuerySet(
  value: unknown,
  expectedMarketCode?: string,
  expectedLanguageTag?: string,
): readonly DataForSeoGenerativeQuery[] {
  if (!Array.isArray(value) || value.length !== DATAFORSEO_AI_CITATION_COHORT_SIZE) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `DataForSEO AI citations require exactly ${DATAFORSEO_AI_CITATION_COHORT_SIZE} frozen queries.`,
    );
  }
  const entityIds = new Set<string>();
  const queryIdentities = new Set<string>();
  const queries = value.map((item, index): DataForSeoGenerativeQuery => {
    const record = strictRecord(item, `DataForSEO AI query ${index}`);
    exactKeys(
      record,
      [
        "entityId",
        "revision",
        "query",
        "normalizedQuery",
        "marketCode",
        "languageTag",
      ],
      `DataForSEO AI query ${index}`,
    );
    if (typeof record.entityId !== "string" || !UUID_RE.test(record.entityId)) {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        `DataForSEO AI query ${index} entityId must be a UUID.`,
      );
    }
    if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        `DataForSEO AI query ${index} revision must be a positive integer.`,
      );
    }
    const query = canonicalText(record.query, `DataForSEO AI query ${index}`, 500);
    const normalizedQuery = canonicalText(
      record.normalizedQuery,
      `DataForSEO AI normalized query ${index}`,
      500,
    );
    const marketCode = canonicalText(
      record.marketCode,
      `DataForSEO AI query ${index} marketCode`,
      16,
    ).toUpperCase();
    const languageTag = canonicalText(
      record.languageTag,
      `DataForSEO AI query ${index} languageTag`,
      64,
    );
    const entityId = record.entityId.toLowerCase();
    const identity = `${marketCode}\n${languageTag}\n${normalizedQuery}`;
    if (entityIds.has(entityId) || queryIdentities.has(identity)) {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        "DataForSEO AI citation queries must have unique entities and normalized queries.",
      );
    }
    if (
      (expectedMarketCode !== undefined && marketCode !== expectedMarketCode) ||
      (expectedLanguageTag !== undefined && languageTag !== expectedLanguageTag)
    ) {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        "Every DataForSEO AI citation query must match the frozen site market and language.",
      );
    }
    entityIds.add(entityId);
    queryIdentities.add(identity);
    return Object.freeze({
      entityId,
      revision: record.revision as number,
      query,
      normalizedQuery,
      marketCode,
      languageTag,
    });
  });
  queries.sort(
    (left, right) =>
      left.normalizedQuery.localeCompare(right.normalizedQuery, "en") ||
      left.entityId.localeCompare(right.entityId, "en") ||
      left.revision - right.revision,
  );
  return Object.freeze(queries);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object" || value === null) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO AI citation query-set identity is not canonical JSON.",
    );
  }
  const record = value as JsonRecord;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** Hash the exact JCS cohort identity shared by admission and collection. */
export function dataForSeoAiCitationQuerySetHash(
  input: DataForSeoAiCitationQuerySetHashInput,
): string {
  const model = canonicalText(
    input.model,
    "DataForSEO AI-citation hash model",
    100,
  );
  const marketCode = canonicalText(
    input.marketCode,
    "DataForSEO AI-citation hash marketCode",
    16,
  ).toUpperCase();
  const languageTag = canonicalText(
    input.languageTag,
    "DataForSEO AI-citation hash languageTag",
    64,
  );
  const queries = canonicalQuerySet(input.queries, marketCode, languageTag);
  const payload = {
    schemaVersion: "dataforseo.ai-citation-query-set.v1",
    platform: "chat_gpt",
    model,
    marketCode,
    languageTag,
    queries: queries.map(({ entityId, revision, query, normalizedQuery }) => ({
      entityId,
      revision,
      query,
      normalizedQuery,
    })),
  };
  return createHash("sha256")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

function canonicalDomain(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SourceError("INVALID_CONFIGURATION", `${label} must be a domain.`);
  }
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//iu.test(value) ? value : `https://${value}`,
    );
  } catch {
    throw new SourceError("INVALID_CONFIGURATION", `${label} must be a domain.`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    throw new SourceError("INVALID_CONFIGURATION", `${label} must be a domain.`);
  }
  const domain = url.hostname
    .toLowerCase()
    .replace(/\.$/u, "")
    .replace(/^www\./u, "");
  if (!HOSTNAME_RE.test(domain)) {
    throw new SourceError("INVALID_CONFIGURATION", `${label} must be a domain.`);
  }
  return domain;
}

function canonicalTrackedDomains(
  value: unknown,
  target: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO tracked competitor domains must be an array of at most 500 domains.",
    );
  }
  return Object.freeze(
    [...new Set(value.map((item) => canonicalDomain(item, "Tracked competitor")))]
      .filter((domain) => domain !== target)
      .sort((left, right) => left.localeCompare(right, "en")),
  );
}

function canonicalAiCitations(
  value: unknown,
  base: DataForSeoSearchLandscapeV2Scope,
): DataForSeoAiCitationsScope {
  if (value === undefined || value === null) {
    return Object.freeze({ state: "disabled" as const, attemptedQueries: 0 as const });
  }
  const record = strictRecord(value, "DataForSEO AI-citation policy");
  if (record.state === "disabled") {
    exactKeys(record, ["state"], "DataForSEO disabled AI-citation policy");
    return Object.freeze({ state: "disabled" as const, attemptedQueries: 0 as const });
  }
  if (record.state === "skipped_insufficient_query_cohort") {
    exactKeys(
      record,
      ["state", "eligibleQueryCount"],
      "DataForSEO skipped AI-citation policy",
    );
    if (
      !Number.isSafeInteger(record.eligibleQueryCount) ||
      (record.eligibleQueryCount as number) < 0 ||
      ((record.eligibleQueryCount as number) >=
        DATAFORSEO_AI_CITATION_COHORT_SIZE &&
        record.eligibleQueryCount !== 21)
    ) {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        "A skipped AI-citation cohort must record an eligible count from 0 to 19 or the bounded overflow sentinel 21.",
      );
    }
    return Object.freeze({
      state: "skipped_insufficient_query_cohort" as const,
      eligibleQueryCount: record.eligibleQueryCount as number,
      attemptedQueries: 0 as const,
    });
  }
  if (record.state !== "enabled") {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO AI-citation policy state is unsupported.",
    );
  }
  exactKeys(
    record,
    [
      "state",
      "requestedModel",
      "queries",
      "trackedCompetitorDomains",
      ...(record.querySetHash === undefined ? [] : ["querySetHash"]),
    ],
    "DataForSEO enabled AI-citation policy",
  );
  const requestedModel = canonicalText(
    record.requestedModel,
    "DataForSEO AI-citation requestedModel",
    100,
  );
  const queries = canonicalQuerySet(
    record.queries,
    base.marketCode,
    base.languageTag,
  );
  const querySetHash = dataForSeoAiCitationQuerySetHash({
    model: requestedModel,
    marketCode: base.marketCode,
    languageTag: base.languageTag,
    queries,
  });
  if (
    record.querySetHash !== undefined &&
    (typeof record.querySetHash !== "string" ||
      !HASH_RE.test(record.querySetHash) ||
      record.querySetHash !== querySetHash)
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO AI-citation querySetHash does not match the canonical cohort.",
    );
  }
  return Object.freeze({
    state: "enabled" as const,
    platform: "chat_gpt" as const,
    requestedModel,
    attemptedQueries: DATAFORSEO_AI_CITATION_COHORT_SIZE,
    querySetHash,
    maxOutputTokens: DATAFORSEO_AI_CITATION_MAX_OUTPUT_TOKENS,
    webSearch: true as const,
    queries,
    trackedCompetitorDomains: canonicalTrackedDomains(
      record.trackedCompetitorDomains,
      base.target,
    ),
  });
}

function locationInput(
  location: DataForSeoCollectionLocation,
): { readonly locationCode: number } | { readonly locationName: string } {
  return location.kind === "code"
    ? { locationCode: location.code }
    : { locationName: location.name };
}

function v2InputFromScope(
  scope: DataForSeoSearchLandscapeV3Scope,
): DataForSeoSearchLandscapeV2ScopeInput {
  return {
    target: scope.target,
    marketCode: scope.marketCode,
    languageTag: scope.languageTag,
    ...locationInput(scope.location),
    rankedKeywordsLimit: scope.rankedKeywords.limit,
    competitorsDomainLimit: scope.competitorsDomain.limit,
    serpCompetitorsLimit: scope.serpCompetitors.limit,
    seeds: scope.serpCompetitors.seeds,
  };
}

export function createDataForSeoSearchLandscapeV3Scope(
  input: DataForSeoSearchLandscapeV3ScopeInput,
): DataForSeoSearchLandscapeV3Scope {
  const record = strictRecord(input, "DataForSEO search-landscape v3 scope input");
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
    "aiCitations",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO search-landscape v3 scope input contains an unknown field.",
    );
  }
  const base = createDataForSeoSearchLandscapeV2Scope({
    target: input.target,
    marketCode: input.marketCode,
    languageTag: input.languageTag,
    ...(input.locationCode === undefined ? {} : { locationCode: input.locationCode }),
    ...(input.locationName === undefined ? {} : { locationName: input.locationName }),
    ...(input.rankedKeywordsLimit === undefined
      ? {}
      : { rankedKeywordsLimit: input.rankedKeywordsLimit }),
    ...(input.competitorsDomainLimit === undefined
      ? {}
      : { competitorsDomainLimit: input.competitorsDomainLimit }),
    ...(input.serpCompetitorsLimit === undefined
      ? {}
      : { serpCompetitorsLimit: input.serpCompetitorsLimit }),
    ...(input.seeds === undefined ? {} : { seeds: input.seeds }),
  });
  const { schemaVersion: _schemaVersion, ...baseWithoutVersion } = base;
  return Object.freeze({
    schemaVersion: DATAFORSEO_SEARCH_LANDSCAPE_V3_SCOPE_VERSION,
    ...baseWithoutVersion,
    aiCitations: canonicalAiCitations(input.aiCitations, base),
  });
}

function aiInputFromCanonical(value: unknown): unknown {
  const record = strictRecord(value, "DataForSEO v3 AI-citation policy");
  if (record.state === "disabled") return { state: "disabled" };
  if (record.state === "skipped_insufficient_query_cohort") {
    return {
      state: "skipped_insufficient_query_cohort",
      eligibleQueryCount: record.eligibleQueryCount,
    };
  }
  if (record.state === "enabled") {
    return {
      state: "enabled",
      requestedModel: record.requestedModel,
      querySetHash: record.querySetHash,
      queries: record.queries,
      trackedCompetitorDomains: record.trackedCompetitorDomains,
    };
  }
  throw new SourceError(
    "INVALID_CONFIGURATION",
    "DataForSEO v3 AI-citation policy state is unsupported.",
  );
}

export function parseDataForSeoSearchLandscapeV3Scope(
  value: unknown,
): DataForSeoSearchLandscapeV3Scope {
  const record = strictRecord(value, "DataForSEO search-landscape v3 scope");
  exactKeys(
    record,
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
      "aiCitations",
    ],
    "DataForSEO search-landscape v3 scope",
  );
  if (
    record.schemaVersion !== DATAFORSEO_SEARCH_LANDSCAPE_V3_SCOPE_VERSION ||
    record.queryKind !== DATAFORSEO_SEARCH_LANDSCAPE_V3_QUERY_KIND
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO search-landscape v3 scope identity is unsupported.",
    );
  }
  const location = strictRecord(record.location, "DataForSEO v3 location");
  const ranked = strictRecord(record.rankedKeywords, "DataForSEO v3 ranked policy");
  const competitors = strictRecord(
    record.competitorsDomain,
    "DataForSEO v3 competitor policy",
  );
  const serp = strictRecord(record.serpCompetitors, "DataForSEO v3 SERP policy");
  const canonical = createDataForSeoSearchLandscapeV3Scope({
    target: record.target,
    marketCode: record.marketCode,
    languageTag: record.languageTag,
    ...(location.kind === "code"
      ? { locationCode: location.code }
      : location.kind === "name"
        ? { locationName: location.name }
        : {}),
    rankedKeywordsLimit: ranked.limit,
    competitorsDomainLimit: competitors.limit,
    serpCompetitorsLimit: serp.limit,
    seeds: serp.seeds,
    aiCitations: aiInputFromCanonical(record.aiCitations),
  });
  if (!canonicalEquivalent(record, canonical)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO search-landscape v3 scope is not canonical.",
    );
  }
  return canonical;
}

export function dataForSeoSearchLandscapeV3SnapshotSummary(
  value: DataForSeoSearchLandscapeV3Scope,
  collectedAt: string,
) {
  const collectionScope = parseDataForSeoSearchLandscapeV3Scope(value);
  const date = new Date(collectedAt);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== collectedAt) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO search-landscape v3 collection time must be canonical UTC.",
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

function queryHash(query: DataForSeoGenerativeQuery): string {
  return createHash("sha256").update(query.normalizedQuery).digest("hex");
}

async function collectAiCitations(
  scope: DataForSeoAiCitationsScope,
  client: DataForSeoSearchLandscapeV3Client,
  signal?: AbortSignal,
): Promise<DataForSeoAiCitationRaw> {
  if (scope.state === "disabled") {
    return {
      state: "disabled",
      attemptedQueries: 0,
      observedQueries: 0,
      unavailableQueries: 0,
      outcomes: [],
    };
  }
  if (scope.state === "skipped_insufficient_query_cohort") {
    return {
      state: scope.state,
      eligibleQueryCount: scope.eligibleQueryCount,
      attemptedQueries: 0,
      observedQueries: 0,
      unavailableQueries: 0,
      outcomes: [],
    };
  }
  const outcomes: DataForSeoAiCitationRawOutcome[] = [];
  // Paid live queries are deliberately sequential. This fixed concurrency of
  // one prevents a single provider limit response from amplifying into a
  // simultaneous 20-request burst and an expensive whole-batch retry.
  for (const query of scope.queries) {
    const request: DataForSeoAiCitationRequest = {
      userPrompt: query.query,
      modelName: scope.requestedModel,
      maxOutputTokens: scope.maxOutputTokens,
      webSearch: true,
      webSearchCountryIsoCode: query.marketCode,
    };
    outcomes.push({
      queryEntityId: query.entityId,
      queryRevision: query.revision,
      queryHash: queryHash(query),
      request,
      response: await client.aiCitation(request, signal),
    });
  }
  const observedQueries = outcomes.filter(
    (outcome) => outcome.response.availability === "available",
  ).length;
  return {
    state: "collected",
    platform: "chat_gpt",
    model: scope.requestedModel,
    querySetHash: scope.querySetHash,
    attemptedQueries: DATAFORSEO_AI_CITATION_COHORT_SIZE,
    observedQueries,
    unavailableQueries: DATAFORSEO_AI_CITATION_COHORT_SIZE - observedQueries,
    outcomes,
  };
}

function aiLimitation(
  scope: DataForSeoAiCitationsScope,
  raw: DataForSeoAiCitationRaw,
): string {
  if (scope.state === "disabled") {
    return "AI citation collection was disabled, so no paid ChatGPT request was made.";
  }
  if (scope.state === "skipped_insufficient_query_cohort") {
    return `Only ${scope.eligibleQueryCount} eligible GenerativeQueries were frozen; exactly 20 are required, so no paid ChatGPT request was made.`;
  }
  if (raw.state !== "collected") {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO AI-citation raw state contradicted its frozen scope.",
    );
  }
  return raw.unavailableQueries === 0
    ? "All 20 frozen GenerativeQueries returned observable ChatGPT answers; citations count only URL annotation hosts."
    : `${raw.observedQueries} of 20 frozen GenerativeQueries returned observable ChatGPT answers; ${raw.unavailableQueries} were unavailable. Citations count only URL annotation hosts.`;
}

function roundedCost(...values: readonly number[]): number {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(12));
}

function v2RawFromV3(
  raw: DataForSeoSearchLandscapeV3Raw,
): DataForSeoSearchLandscapeV2Raw {
  const scope = parseDataForSeoSearchLandscapeV3Scope(raw.collectionScope);
  const baseAvailability: Availability =
    raw.rankedKeywords.totalCount > raw.rankedKeywords.itemsCount ||
    raw.competitorsDomain.totalCount > raw.competitorsDomain.itemsCount ||
    raw.serpCompetitors.totalCount > raw.serpCompetitors.itemsCount
      ? "partial"
      : "available";
  return {
    schemaVersion: DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
    collectionScope: createDataForSeoSearchLandscapeV2Scope(v2InputFromScope(scope)),
    rankedKeywords: raw.rankedKeywords,
    competitorsDomain: raw.competitorsDomain,
    serpCompetitors: raw.serpCompetitors,
    capturedAt: raw.capturedAt,
    availability: baseAvailability,
    stopReason:
      baseAvailability === "partial"
        ? DATAFORSEO_SEARCH_LANDSCAPE_V2_ROW_CAP_STOP_REASON
        : null,
    limitation: raw.limitation,
  };
}

function domainFromProviderValue(value: string): string | null {
  try {
    return canonicalDomain(value, "DataForSEO competitor domain");
  } catch {
    return null;
  }
}

function annotationMatchesDomain(urlValue: string, domain: string): boolean {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    return hostname === domain || hostname.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function competitorDomains(raw: DataForSeoSearchLandscapeV3Raw): readonly string[] {
  const domains = new Set<string>();
  if (raw.collectionScope.aiCitations.state === "enabled") {
    for (const domain of raw.collectionScope.aiCitations.trackedCompetitorDomains) {
      domains.add(domain);
    }
  }
  for (const row of raw.competitorsDomain.rows) {
    const domain = domainFromProviderValue(row.domain);
    if (domain !== null) domains.add(domain);
  }
  for (const row of raw.serpCompetitors.rows) {
    const domain = domainFromProviderValue(row.domain);
    if (domain !== null) domains.add(domain);
  }
  domains.delete(raw.collectionScope.target);
  return [...domains].sort((left, right) => left.localeCompare(right, "en"));
}

function validateAiRaw(
  raw: DataForSeoAiCitationRaw,
  scope: DataForSeoAiCitationsScope,
): void {
  if (scope.state === "disabled") {
    if (
      raw.state !== "disabled" ||
      raw.attemptedQueries !== 0 ||
      raw.observedQueries !== 0 ||
      raw.unavailableQueries !== 0 ||
      raw.outcomes.length !== 0
    ) {
      throw new SourceError("INVALID_RESPONSE", "Disabled AI scope collected data.");
    }
    return;
  }
  if (scope.state === "skipped_insufficient_query_cohort") {
    if (
      raw.state !== "skipped_insufficient_query_cohort" ||
      raw.eligibleQueryCount !== scope.eligibleQueryCount ||
      raw.attemptedQueries !== 0 ||
      raw.observedQueries !== 0 ||
      raw.unavailableQueries !== 0 ||
      raw.outcomes.length !== 0
    ) {
      throw new SourceError("INVALID_RESPONSE", "Skipped AI scope is inconsistent.");
    }
    return;
  }
  if (
    raw.state !== "collected" ||
    raw.platform !== "chat_gpt" ||
    raw.model !== scope.requestedModel ||
    raw.querySetHash !== scope.querySetHash ||
    !HASH_RE.test(raw.querySetHash) ||
    raw.attemptedQueries !== DATAFORSEO_AI_CITATION_COHORT_SIZE ||
    raw.outcomes.length !== DATAFORSEO_AI_CITATION_COHORT_SIZE ||
    !Number.isSafeInteger(raw.observedQueries) ||
    raw.observedQueries < 0 ||
    !Number.isSafeInteger(raw.unavailableQueries) ||
    raw.unavailableQueries < 0 ||
    raw.observedQueries + raw.unavailableQueries !==
      DATAFORSEO_AI_CITATION_COHORT_SIZE
  ) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "Collected AI-citation raw data contradicted its frozen cohort.",
    );
  }
  for (const [index, outcome] of raw.outcomes.entries()) {
    const query = scope.queries[index];
    const expectedRequest: DataForSeoAiCitationRequest | undefined =
      query === undefined
        ? undefined
        : {
            userPrompt: query.query,
            modelName: scope.requestedModel,
            maxOutputTokens: scope.maxOutputTokens,
            webSearch: true,
            webSearchCountryIsoCode: query.marketCode,
          };
    if (
      query === undefined ||
      expectedRequest === undefined ||
      outcome.queryEntityId !== query.entityId ||
      outcome.queryRevision !== query.revision ||
      outcome.queryHash !== queryHash(query) ||
      !HASH_RE.test(outcome.queryHash) ||
      !canonicalEquivalent(outcome.request, expectedRequest) ||
      outcome.response.requestedModel !== scope.requestedModel ||
      typeof outcome.response.costUsd !== "number" ||
      !Number.isFinite(outcome.response.costUsd) ||
      outcome.response.costUsd < 0 ||
      !Number.isSafeInteger(outcome.response.providerStatusCode) ||
      !Number.isSafeInteger(outcome.response.taskStatusCode) ||
      !Array.isArray(outcome.response.sourceUrls) ||
      outcome.response.sourceUrls.some((url) => typeof url !== "string")
    ) {
      throw new SourceError(
        "INVALID_RESPONSE",
        "Collected AI-citation outcome lineage was contradictory.",
      );
    }
    if (outcome.response.availability === "available") {
      const observedAt = outcome.response.observedAt;
      const observedDate = observedAt === null ? null : new Date(observedAt);
      if (
        typeof outcome.response.resolvedModel !== "string" ||
        outcome.response.resolvedModel.trim() === "" ||
        observedAt === null ||
        observedDate === null ||
        Number.isNaN(observedDate.getTime()) ||
        observedDate.toISOString() !== observedAt ||
        outcome.response.limitation !== null
      ) {
        throw new SourceError(
          "INVALID_RESPONSE",
          "An available AI-citation outcome was incomplete.",
        );
      }
    } else if (
      outcome.response.availability !== "unavailable" ||
      outcome.response.resolvedModel !== null ||
      outcome.response.observedAt !== null ||
      outcome.response.sourceUrls.length !== 0 ||
      typeof outcome.response.limitation !== "string" ||
      outcome.response.limitation.trim() === ""
    ) {
      throw new SourceError(
        "INVALID_RESPONSE",
        "An unavailable AI-citation outcome was contradictory.",
      );
    }
  }
  const observed = raw.outcomes.filter(
    (outcome) => outcome.response.availability === "available",
  ).length;
  if (observed !== raw.observedQueries) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "Collected AI-citation outcome counts were contradictory.",
    );
  }
}

/** Positive half-up ratio aligned with PostgreSQL numeric round(..., 12). */
export function dataForSeoOrganicOverlapRatio(
  intersections: number,
  targetOrganicKeywordCount: number,
): number {
  if (
    !Number.isSafeInteger(intersections) ||
    !Number.isSafeInteger(targetOrganicKeywordCount) ||
    intersections < 1 ||
    targetOrganicKeywordCount < 1 ||
    intersections > targetOrganicKeywordCount
  ) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO organic-overlap operands are contradictory.",
    );
  }
  const scale = 1_000_000_000_000n;
  const denominator = BigInt(targetOrganicKeywordCount);
  const scaledNumerator = BigInt(intersections) * scale;
  const quotient = scaledNumerator / denominator;
  const remainder = scaledNumerator % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  return Number(rounded) / Number(scale);
}

export function createDataForSeoSearchLandscapeV3Adapter(
  client: DataForSeoSearchLandscapeV3Client,
  options: DataForSeoSearchLandscapeV3AdapterOptions = {},
): DataForSeoSearchLandscapeV3Adapter {
  return {
    provider: "dataforseo",
    async validateConfig(config) {
      return parseDataForSeoSearchLandscapeV3Scope(config);
    },
    async capabilities(config) {
      const scope = parseDataForSeoSearchLandscapeV3Scope(config);
      return [
        {
          datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY,
          operation: DATAFORSEO_SEARCH_LANDSCAPE_V3_OPERATION,
          available: true,
          limitation:
            scope.aiCitations.state === "enabled"
              ? "DataForSEO v3 uses the v2 organic landscape plus exactly 20 frozen ChatGPT live queries."
              : "DataForSEO v3 uses the v2 organic landscape without paid AI citation calls for this frozen scope.",
        },
      ];
    },
    async collect(params, ctx) {
      const collectionScope = parseDataForSeoSearchLandscapeV3Scope(params);
      const baseAdapter = createDataForSeoSearchLandscapeV2Adapter(client, options);
      const base = await baseAdapter.collect(
        createDataForSeoSearchLandscapeV2Scope(v2InputFromScope(collectionScope)),
        ctx,
      );
      const aiCitations = await collectAiCitations(
        collectionScope.aiCitations,
        client,
        ctx.signal,
      );
      // Snapshot availability and top-level limitation describe the organic
      // landscape only. AI cohort coverage remains independently visible in
      // raw.aiCitations and the normalized AI aggregate.
      const availability = base.availability;
      const stopReason =
        base.availability === "partial"
          ? DATAFORSEO_SEARCH_LANDSCAPE_V3_PARTIAL_STOP_REASON
          : null;
      const limitation = base.limitation;
      const observedAiQueries =
        aiCitations.state === "collected" ? aiCitations.observedQueries : 0;
      const aiCost =
        aiCitations.state === "collected"
          ? aiCitations.outcomes.reduce(
              (sum, outcome) => sum + outcome.response.costUsd,
              0,
            )
          : 0;
      return {
        availability,
        raw: {
          schemaVersion: DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION,
          collectionScope,
          rankedKeywords: base.raw.rankedKeywords,
          competitorsDomain: base.raw.competitorsDomain,
          serpCompetitors: base.raw.serpCompetitors,
          aiCitations,
          capturedAt: base.capturedAt,
          availability,
          stopReason,
          limitation,
        },
        capturedAt: base.capturedAt,
        sourceWindow: base.sourceWindow,
        rowCount: base.rowCount + observedAiQueries,
        stopReason,
        providerUsage: {
          apiCalls:
            (base.providerUsage.apiCalls ?? 0) +
            (aiCitations.state === "collected" ? aiCitations.attemptedQueries : 0),
          rowsReturned:
            (base.providerUsage.rowsReturned ?? 0) + observedAiQueries,
          rowsRetained:
            (base.providerUsage.rowsRetained ?? 0) + observedAiQueries,
          costUsd: roundedCost(base.providerUsage.costUsd ?? 0, aiCost),
          aiQueriesAttempted:
            aiCitations.state === "collected" ? aiCitations.attemptedQueries : 0,
          aiQueriesObserved: observedAiQueries,
          aiQueriesUnavailable:
            aiCitations.state === "collected"
              ? aiCitations.unavailableQueries
              : 0,
        },
        limitation,
      };
    },
    async *normalize(raw, ctx) {
      if (raw.schemaVersion !== DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION) {
        throw new SourceError(
          "INVALID_RESPONSE",
          "DataForSEO search-landscape v3 raw identity is unsupported.",
        );
      }
      const scope = parseDataForSeoSearchLandscapeV3Scope(raw.collectionScope);
      validateAiRaw(raw.aiCitations, scope.aiCitations);
      const baseAdapter = createDataForSeoSearchLandscapeV2Adapter(client);
      for await (const observation of baseAdapter.normalize(v2RawFromV3(raw), ctx)) {
        if (observation.metricKey !== METRIC_DATAFORSEO_COMPETITOR_DOMAIN) {
          yield observation;
        }
      }

      const denominator = raw.rankedKeywords.totalCount;
      if (!Number.isSafeInteger(denominator) || denominator < 0) {
        throw new SourceError(
          "INVALID_RESPONSE",
          "DataForSEO ranked-keyword total_count is invalid.",
        );
      }
      for (const row of raw.competitorsDomain.rows) {
        if (
          denominator === 0 ||
          !Number.isSafeInteger(row.intersections) ||
          row.intersections < 1 ||
          row.intersections > denominator
        ) {
          throw new SourceError(
            "INVALID_RESPONSE",
            "DataForSEO organic-overlap operands are contradictory.",
          );
        }
        const projection: DataForSeoCompetitorDomainProjection & {
          readonly targetOrganicKeywordCount: number;
          readonly serpOverlap: number;
        } = {
          targetDomain: scope.target,
          competitorDomain: row.domain,
          intersections: row.intersections,
          targetOrganicKeywordCount: denominator,
          serpOverlap: dataForSeoOrganicOverlapRatio(
            row.intersections,
            denominator,
          ),
          averagePosition: row.averagePosition,
          summedPosition: row.summedPosition,
          organicEstimatedTrafficVolume: row.organicEstimatedTrafficVolume,
          marketCode: scope.marketCode,
          languageCode: scope.providerLanguageCode,
        };
        yield buildObservation({
          provider: "dataforseo",
          metricKey: METRIC_DATAFORSEO_COMPETITOR_DOMAIN_V2,
          subjectType: "site",
          subjectRef: row.domain,
          observedAt: ctx.capturedAt,
          availability: "available",
          value: { json: projection },
          limitation: raw.limitation,
        });
      }

      if (
        raw.aiCitations.state !== "collected" ||
        raw.aiCitations.observedQueries === 0
      ) {
        return;
      }
      const aiAggregateLimitation = aiLimitation(
        scope.aiCitations,
        raw.aiCitations,
      );
      for (const competitorDomain of competitorDomains(raw)) {
        const queryOutcomes = raw.aiCitations.outcomes.map((outcome) => {
          const available = outcome.response.availability === "available";
          const cited =
            available &&
            outcome.response.sourceUrls.some((url) =>
              annotationMatchesDomain(url, competitorDomain),
            );
          return {
            queryEntityId: outcome.queryEntityId,
            queryRevision: outcome.queryRevision,
            queryHash: outcome.queryHash,
            availability: available ? ("available" as const) : ("unavailable" as const),
            cited,
          };
        });
        const citedQueries = queryOutcomes.filter((outcome) => outcome.cited).length;
        yield buildObservation({
          provider: "dataforseo",
          metricKey: METRIC_DATAFORSEO_COMPETITOR_AI_CITATION,
          subjectType: "site",
          subjectRef: competitorDomain,
          observedAt: ctx.capturedAt,
          availability: "available",
          value: {
            json: {
              targetDomain: scope.target,
              competitorDomain,
              attemptedQueries: DATAFORSEO_AI_CITATION_COHORT_SIZE,
              observedQueries: raw.aiCitations.observedQueries,
              citedQueries,
              unavailableQueries: raw.aiCitations.unavailableQueries,
              cohortCoverage:
                raw.aiCitations.unavailableQueries === 0
                  ? ("complete" as const)
                  : ("partial" as const),
              querySetHash: raw.aiCitations.querySetHash,
              platform: "chat_gpt" as const,
              model: raw.aiCitations.model,
              marketCode: scope.marketCode,
              languageTag: scope.languageTag,
              queryOutcomes,
            },
          },
          limitation: aiAggregateLimitation,
        });
      }
    },
  };
}

const unboundClient: DataForSeoSearchLandscapeV3Client = {
  rankedKeywords: () =>
    Promise.reject(
      new SourceError("AUTH_REQUIRED", "DataForSEO credentials are required."),
    ),
  competitorsDomain: () =>
    Promise.reject(
      new SourceError("AUTH_REQUIRED", "DataForSEO credentials are required."),
    ),
  serpCompetitors: () =>
    Promise.reject(
      new SourceError("AUTH_REQUIRED", "DataForSEO credentials are required."),
    ),
  aiCitation: () =>
    Promise.reject(
      new SourceError("AUTH_REQUIRED", "DataForSEO credentials are required."),
    ),
};

export const dataforseoSearchLandscapeV3Adapter =
  createDataForSeoSearchLandscapeV3Adapter(unboundClient);

// Re-exported for workers that route v3's unchanged SERP fallback observation.
export { METRIC_DATAFORSEO_SERP_COMPETITOR };
