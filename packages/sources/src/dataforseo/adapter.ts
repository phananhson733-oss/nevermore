import { isBcp47LanguageTag } from "@sf/contracts";
import {
  SourceError,
  type Availability,
  type Capability,
  type CollectionContext,
  type CollectionResult,
  type NormalizeContext,
  type NormalizedObservation,
  type SourceAdapter,
} from "../adapter.ts";
import { clusterKey } from "../csv/cluster-key.ts";
import {
  buildObservation,
  METRIC_CSV_KEYWORD_GAP,
  type CsvKeywordProjection,
} from "../observations.ts";
import {
  DEFAULT_DATAFORSEO_LIMIT,
  MAX_DATAFORSEO_LIMIT,
  type DataForSeoClient,
  type DataForSeoRankedKeywordRow,
  type DataForSeoRankedKeywordsRequest,
} from "./client.ts";

/**
 * Provider-specific immutable Snapshot dataset identity. The normalized rows
 * still use the shared `csv.keyword_gap.v1` Observation metric so the rule
 * engine can consume one canonical keyword-gap projection while provenance is
 * preserved by `provider`, `origin`, and this Snapshot dataset key.
 */
export const DATAFORSEO_DATASET_KEY =
  "dataforseo.ranked_keywords.v1" as const;
export const DATAFORSEO_METHOD_VERSION =
  "dataforseo.ranked_keywords.v1" as const;
export const DATAFORSEO_ROW_CAP_STOP_REASON =
  "DATAFORSEO_ROW_CAP_REACHED" as const;
export const DATAFORSEO_COLLECTION_SCOPE_VERSION =
  "dataforseo.collection-scope.v1" as const;
export const DATAFORSEO_QUERY_KIND = "ranked_keywords" as const;

const US_LOCATION_CODE = 2_840;
const MARKET_CODE_RE = /^[A-Za-z]{2}$/;
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const BASE_LIMITATION =
  "DataForSEO Labs is a vendor observation requested from the live Google organic ranked-keywords endpoint and filtered to search volume above 0 and rank group 4–20. The provider does not return a dataset timestamp for this response, so freshness is unknown.";

export type DataForSeoCollectionLocation =
  | {
      readonly kind: "code";
      readonly code: number;
    }
  | {
      readonly kind: "name";
      readonly name: string;
    };

/**
 * Credential-free command-time scope. This object is safe to freeze in an
 * AsyncRun payload and to copy into the public metadata of the resulting
 * immutable Snapshot. It is deliberately not the provider's raw request.
 */
export type DataForSeoCollectionScope = Readonly<{
  readonly schemaVersion: typeof DATAFORSEO_COLLECTION_SCOPE_VERSION;
  readonly queryKind: typeof DATAFORSEO_QUERY_KIND;
  readonly target: string;
  readonly marketCode: string;
  /** Full command-time BCP-47 scope, before provider primary-subtag narrowing. */
  readonly languageTag: string;
  readonly providerLanguageCode: string;
  readonly location: DataForSeoCollectionLocation;
  readonly limit: number;
}>;

export interface DataForSeoCollectionScopeInput {
  readonly target: unknown;
  readonly marketCode: unknown;
  readonly languageTag: unknown;
  readonly locationCode?: unknown;
  readonly locationName?: unknown;
  readonly limit?: unknown;
}

export type DataForSeoSnapshotSummary = Readonly<{
  readonly collectionScope: DataForSeoCollectionScope;
  readonly timing: {
    /** Time our collection completed; never presented as provider data time. */
    readonly collectedAt: string;
    /** DataForSEO ranked-keywords does not return either timestamp today. */
    readonly dataAsOf: null;
    readonly observedAt: null;
    /** No product freshness policy has been frozen for this provider. */
    readonly freshness: "unknown";
  };
}>;

export interface DataForSeoParams {
  readonly target: string;
  readonly marketCode: string;
  readonly locationCode?: number;
  readonly locationName?: string;
  readonly languageCode: string;
  readonly limit?: number;
  /** Test-only clock injection; never sent to DataForSEO or persisted. */
  readonly now?: Date;
}

/** Fully validated adapter config; exactly one location selector is present. */
export interface DataForSeoConfig {
  readonly target: string;
  readonly marketCode: string;
  readonly locationCode?: number;
  readonly locationName?: string;
  readonly languageCode: string;
  readonly limit: number;
  readonly usedUsLocationFallback: boolean;
}

/** Credential-free request metadata retained with the source snapshot. */
export interface DataForSeoRawRequest extends DataForSeoRankedKeywordsRequest {
  readonly marketCode: string;
  readonly methodVersion: typeof DATAFORSEO_METHOD_VERSION;
}

/** Snapshot raw payload. It is safe to persist and contains no authentication. */
export interface DataForSeoRaw {
  readonly schemaVersion: typeof DATAFORSEO_METHOD_VERSION;
  readonly request: DataForSeoRawRequest;
  readonly rows: readonly DataForSeoRankedKeywordRow[];
  readonly totalCount: number;
  readonly itemsCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
  readonly capturedAt: string;
  readonly availability: Availability;
  readonly stopReason: string | null;
  readonly limitation: string;
}

export interface DataForSeoAdapterOptions {
  readonly now?: () => Date;
}

function normalizeTarget(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO target must be a non-empty public hostname.",
    );
  }
  const input = value.trim();
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`,
    );
  } catch {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO target must be a valid public hostname.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO target must use HTTP or HTTPS.",
    );
  }
  const target = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  if (!HOSTNAME_RE.test(target)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO target must be a valid public hostname.",
    );
  }
  return target;
}

function normalizeMarketCode(value: unknown): string {
  if (typeof value !== "string" || !MARKET_CODE_RE.test(value.trim())) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO marketCode must be an ISO 3166-1 alpha-2 code.",
    );
  }
  return value.trim().toUpperCase();
}

function normalizeLanguageCode(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    !isBcp47LanguageTag(value.trim())
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO languageCode must be a valid BCP-47 language tag.",
    );
  }
  const primary = value.trim().split("-")[0];
  if (!primary) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO languageCode must contain a primary language subtag.",
    );
  }
  return primary.toLowerCase();
}

function normalizeLanguageTag(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    !isBcp47LanguageTag(value.trim())
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO collection scope requires an explicit BCP-47 language tag.",
    );
  }
  try {
    const canonical = Intl.getCanonicalLocales(value.trim())[0];
    if (!canonical) throw new RangeError("missing canonical locale");
    return canonical;
  } catch {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO collection scope requires an explicit BCP-47 language tag.",
    );
  }
}

function normalizeLocationCode(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO locationCode must be a positive integer.",
    );
  }
  return value as number;
}

function normalizeLocationName(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO locationName must be a non-empty string.",
    );
  }
  return value.trim();
}

function normalizeLimit(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_DATAFORSEO_LIMIT;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_DATAFORSEO_LIMIT
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `DataForSEO limit must be an integer from 1 to ${MAX_DATAFORSEO_LIMIT}.`,
    );
  }
  return value as number;
}

function asStrictRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} must be an object.`,
    );
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
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

/** Build the one canonical, secret-free scope accepted by Web and Worker. */
export function createDataForSeoCollectionScope(
  input: DataForSeoCollectionScopeInput,
): DataForSeoCollectionScope {
  const languageTag = normalizeLanguageTag(input.languageTag);
  const config = resolveConfig({
    target: input.target,
    marketCode: input.marketCode,
    languageCode: languageTag,
    ...(input.locationCode === undefined
      ? {}
      : { locationCode: input.locationCode }),
    ...(input.locationName === undefined
      ? {}
      : { locationName: input.locationName }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  const common = {
    schemaVersion: DATAFORSEO_COLLECTION_SCOPE_VERSION,
    queryKind: DATAFORSEO_QUERY_KIND,
    target: config.target,
    marketCode: config.marketCode,
    languageTag,
    providerLanguageCode: config.languageCode,
    limit: config.limit,
  };
  return config.locationCode !== undefined
    ? {
        ...common,
        location: { kind: "code", code: config.locationCode },
      }
    : {
        ...common,
        location: { kind: "name", name: config.locationName as string },
      };
}

/**
 * Strictly validate a previously frozen scope. Unlike adapter params, this
 * rejects all unknown fields so credentials or raw request payloads cannot be
 * smuggled into customer-readable Snapshot metadata.
 */
export function parseDataForSeoCollectionScope(
  value: unknown,
): DataForSeoCollectionScope {
  const input = asStrictRecord(value, "DataForSEO collection scope");
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
      "limit",
    ],
    "DataForSEO collection scope",
  );
  if (
    input.schemaVersion !== DATAFORSEO_COLLECTION_SCOPE_VERSION ||
    input.queryKind !== DATAFORSEO_QUERY_KIND
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO collection scope version or query kind is unsupported.",
    );
  }

  const location = asStrictRecord(
    input.location,
    "DataForSEO collection scope location",
  );
  let locationInput:
    | { readonly locationCode: unknown }
    | { readonly locationName: unknown };
  if (location.kind === "code") {
    assertExactKeys(
      location,
      ["kind", "code"],
      "DataForSEO collection scope location",
    );
    locationInput = { locationCode: location.code };
  } else if (location.kind === "name") {
    assertExactKeys(
      location,
      ["kind", "name"],
      "DataForSEO collection scope location",
    );
    locationInput = { locationName: location.name };
  } else {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO collection scope location kind is unsupported.",
    );
  }

  const canonical = createDataForSeoCollectionScope({
    target: input.target,
    marketCode: input.marketCode,
    languageTag: input.languageTag,
    limit: input.limit,
    ...locationInput,
  });
  if (
    input.target !== canonical.target ||
    input.marketCode !== canonical.marketCode ||
    input.languageTag !== canonical.languageTag ||
    input.providerLanguageCode !== canonical.providerLanguageCode ||
    input.limit !== canonical.limit ||
    location.kind !== canonical.location.kind ||
    (location.kind === "code" &&
      (canonical.location.kind !== "code" ||
        location.code !== canonical.location.code)) ||
    (location.kind === "name" &&
      (canonical.location.kind !== "name" ||
        location.name !== canonical.location.name))
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO collection scope is not canonical.",
    );
  }
  return canonical;
}

/** Convert only a validated frozen scope into the provider adapter params. */
export function dataForSeoParamsFromCollectionScope(
  value: DataForSeoCollectionScope,
): DataForSeoParams {
  const scope = parseDataForSeoCollectionScope(value);
  return scope.location.kind === "code"
    ? {
        target: scope.target,
        marketCode: scope.marketCode,
        locationCode: scope.location.code,
        languageCode: scope.providerLanguageCode,
        limit: scope.limit,
      }
    : {
        target: scope.target,
        marketCode: scope.marketCode,
        locationName: scope.location.name,
        languageCode: scope.providerLanguageCode,
        limit: scope.limit,
      };
}

/** Public, sanitized Snapshot metadata; provider timing stays explicitly null. */
export function dataForSeoSnapshotSummary(
  value: DataForSeoCollectionScope,
  collectedAt: string,
): DataForSeoSnapshotSummary {
  const scope = parseDataForSeoCollectionScope(value);
  const date = new Date(collectedAt);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== collectedAt) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO collection time must be a canonical UTC instant.",
    );
  }
  return {
    collectionScope: scope,
    timing: {
      collectedAt,
      dataAsOf: null,
      observedAt: null,
      freshness: "unknown",
    },
  };
}

function resolveConfig(value: unknown): DataForSeoConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO config must be an object.",
    );
  }
  const input = value as Record<string, unknown>;
  const marketCode = normalizeMarketCode(input.marketCode);
  let locationCode = normalizeLocationCode(input.locationCode);
  const locationName = normalizeLocationName(input.locationName);
  if (locationCode !== undefined && locationName !== undefined) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO config must specify locationCode or locationName, not both.",
    );
  }

  let usedUsLocationFallback =
    input.usedUsLocationFallback === true &&
    marketCode === "US" &&
    locationCode === US_LOCATION_CODE &&
    locationName === undefined;
  if (locationCode === undefined && locationName === undefined) {
    if (marketCode !== "US") {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        "DataForSEO config requires locationCode or locationName for non-US markets.",
      );
    }
    locationCode = US_LOCATION_CODE;
    usedUsLocationFallback = true;
  }

  const common = {
    target: normalizeTarget(input.target),
    marketCode,
    languageCode: normalizeLanguageCode(input.languageCode),
    limit: normalizeLimit(input.limit),
    usedUsLocationFallback,
  };
  return locationCode !== undefined
    ? { ...common, locationCode }
    : { ...common, locationName: locationName as string };
}

function limitationFor(
  config: DataForSeoConfig,
  rowsReturned?: number,
  totalCount?: number,
): string {
  const details: string[] = [BASE_LIMITATION];
  if (config.usedUsLocationFallback) {
    details.push(
      "The US compatibility location code 2840 was used because no explicit location selector was configured.",
    );
  }
  if (
    rowsReturned !== undefined &&
    totalCount !== undefined &&
    totalCount > rowsReturned
  ) {
    details.push(
      `Only the first ${rowsReturned} of ${totalCount} matching keywords were persisted.`,
    );
  } else if (rowsReturned === 0 && totalCount === 0) {
    details.push(
      "The provider returned an observed empty result set; no zero-valued keyword facts were fabricated.",
    );
  }
  return details.join(" ");
}

function capability(config: DataForSeoConfig): Capability {
  return {
    datasetKey: DATAFORSEO_DATASET_KEY,
    operation: "keyword_gap_import",
    available: true,
    limitation: limitationFor(config),
  };
}

function safeAbsoluteUrl(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function createDataForSeoAdapter(
  client: DataForSeoClient,
  options: DataForSeoAdapterOptions = {},
): SourceAdapter<DataForSeoConfig, DataForSeoParams, DataForSeoRaw> {
  return {
    provider: "dataforseo",

    async validateConfig(config: unknown): Promise<DataForSeoConfig> {
      return resolveConfig(config);
    },

    async capabilities(config: DataForSeoConfig): Promise<Capability[]> {
      return [capability(config)];
    },

    async collect(
      params: DataForSeoParams,
      ctx: CollectionContext,
    ): Promise<CollectionResult<DataForSeoRaw>> {
      const config = resolveConfig(params);
      const request: DataForSeoRankedKeywordsRequest =
        config.locationCode !== undefined
          ? {
              target: config.target,
              locationCode: config.locationCode,
              languageCode: config.languageCode,
              limit: config.limit,
            }
          : {
              target: config.target,
              locationName: config.locationName as string,
              languageCode: config.languageCode,
              limit: config.limit,
            };
      const response = await client.rankedKeywords(request, ctx.signal);
      const capturedAt = (
        params.now ??
        options.now?.() ??
        new Date()
      ).toISOString();
      const availability: Availability =
        response.totalCount > response.rows.length ? "partial" : "available";
      const stopReason =
        availability === "partial" ? DATAFORSEO_ROW_CAP_STOP_REASON : null;
      const limitation = limitationFor(
        config,
        response.rows.length,
        response.totalCount,
      );
      const rawRequest: DataForSeoRawRequest = {
        ...request,
        marketCode: config.marketCode,
        methodVersion: DATAFORSEO_METHOD_VERSION,
      };
      const raw: DataForSeoRaw = {
        schemaVersion: DATAFORSEO_METHOD_VERSION,
        request: rawRequest,
        rows: response.rows,
        totalCount: response.totalCount,
        itemsCount: response.itemsCount,
        costUsd: response.costUsd,
        providerStatusCode: response.providerStatusCode,
        taskStatusCode: response.taskStatusCode,
        capturedAt,
        availability,
        stopReason,
        limitation,
      };
      return {
        availability,
        raw,
        capturedAt,
        sourceWindow: { start: null, end: null },
        rowCount: response.rows.length,
        stopReason,
        providerUsage: {
          apiCalls: 1,
          rowsReturned: response.rows.length,
          costUsd: response.costUsd,
        },
        limitation,
      };
    },

    async *normalize(
      raw: DataForSeoRaw,
      ctx: NormalizeContext,
    ): AsyncIterable<NormalizedObservation> {
      for (const row of raw.rows) {
        const cluster = clusterKey(row.keyword);
        if (cluster === null) {
          throw new SourceError(
            "INVALID_RESPONSE",
            "DataForSEO returned a keyword that cannot produce a canonical cluster key.",
          );
        }
        const projection: CsvKeywordProjection = {
          keyword: row.keyword,
          clusterKey: cluster,
          searchVolume: row.searchVolume,
          currentUrl: safeAbsoluteUrl(row.currentUrl),
          currentRank: row.currentRank,
          competitorDomain: null,
          competitorRank: null,
          marketCode: raw.request.marketCode,
          languageCode: raw.request.languageCode,
        };
        yield buildObservation({
          provider: "dataforseo",
          metricKey: METRIC_CSV_KEYWORD_GAP,
          subjectType: "keyword_cluster",
          subjectRef: cluster,
          observedAt: ctx.capturedAt,
          availability: "available",
          value: { json: projection },
          limitation: raw.limitation,
        });
      }
    },
  };
}

const unboundClient: DataForSeoClient = {
  rankedKeywords(): Promise<never> {
    return Promise.reject(
      new SourceError(
        "AUTH_REQUIRED",
        "DataForSEO collection requires a credential-bound HTTP client.",
      ),
    );
  },
};

/** Default instance supports config/capability/normalization but not live I/O. */
export const dataforseoAdapter = createDataForSeoAdapter(unboundClient);
