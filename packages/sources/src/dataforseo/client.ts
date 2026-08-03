import { SourceError, type SourceErrorCode } from "../adapter.ts";
import {
  cancelResponseBody,
  createRequestAbortScope,
  DEFAULT_PROVIDER_MAX_RESPONSE_BYTES,
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  isAbortLike,
  readBoundedJson,
} from "../provider-http.ts";

/** Official DataForSEO Labs endpoint used by the keyword-opportunity source. */
export const DATAFORSEO_RANKED_KEYWORDS_LIVE_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live";
/** Official Google Labs endpoint for domain-level organic SERP competitors. */
export const DATAFORSEO_COMPETITORS_DOMAIN_LIVE_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/competitors_domain/live";
/** Official Google Labs endpoint for seed-keyword SERP competitor discovery. */
export const DATAFORSEO_SERP_COMPETITORS_LIVE_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/serp_competitors/live";

export const DEFAULT_DATAFORSEO_LIMIT = 200;
export const DEFAULT_DATAFORSEO_COMPETITORS_DOMAIN_LIMIT = 100;
export const MAX_DATAFORSEO_LIMIT = 1_000;

/** A safe, credential-free request. Authentication is owned by the HTTP client. */
export interface DataForSeoRankedKeywordsRequest {
  readonly target: string;
  readonly locationCode?: number;
  readonly locationName?: string;
  readonly languageCode: string;
  readonly limit: number;
  /** Defaults to the legacy v1 policy (4) when omitted. */
  readonly minimumRankGroup?: number;
  /** Defaults to the legacy v1 policy (20) when omitted. */
  readonly maximumRankGroup?: number;
}

/** Provider fields retained for persistence and later canonical normalization. */
export interface DataForSeoRankedKeywordRow {
  readonly keyword: string;
  readonly searchVolume: number | null;
  readonly currentUrl: string | null;
  readonly currentRank: number | null;
}

/**
 * Sanitized provider result. It deliberately contains neither Authorization nor
 * credentials, so an adapter may persist it as snapshot raw data.
 */
export interface DataForSeoRankedKeywordsResponse {
  readonly rows: readonly DataForSeoRankedKeywordRow[];
  readonly totalCount: number;
  readonly itemsCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
}

export interface DataForSeoRankedKeywordsClient {
  rankedKeywords(
    request: DataForSeoRankedKeywordsRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoRankedKeywordsResponse>;
}

/**
 * Backward-compatible name for the original ranked-keywords-only seam. Keeping
 * this interface narrow means every existing fake client remains valid.
 */
export type DataForSeoClient = DataForSeoRankedKeywordsClient;

/** Credential-free input; fixed competitor-discovery policy is client-owned. */
export interface DataForSeoCompetitorsDomainRequest {
  readonly target: string;
  readonly locationCode?: number;
  readonly locationName?: string;
  readonly languageCode: string;
  readonly limit: number;
  /** Defaults to the legacy v1 policy (20) when omitted. */
  readonly maximumRankGroup?: number;
}

/**
 * Factual fields retained from one competitors-domain item. `intersections` is
 * an integer keyword-intersection count, never a ratio or similarity score.
 */
export interface DataForSeoCompetitorDomainRow {
  readonly domain: string;
  readonly averagePosition: number;
  readonly summedPosition: number;
  readonly intersections: number;
  readonly organicEstimatedTrafficVolume: number;
}

/** Sanitized competitor result with no provider prose or authentication. */
export interface DataForSeoCompetitorsDomainResponse {
  readonly rows: readonly DataForSeoCompetitorDomainRow[];
  readonly totalCount: number;
  readonly itemsCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
}

export interface DataForSeoCompetitorsDomainClient {
  competitorsDomain(
    request: DataForSeoCompetitorsDomainRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoCompetitorsDomainResponse>;
}

export interface DataForSeoSerpCompetitorsRequest {
  readonly keywords: readonly string[];
  readonly locationCode?: number;
  readonly locationName?: string;
  readonly languageCode: string;
  readonly limit: number;
}

export interface DataForSeoSerpCompetitorRow {
  readonly domain: string;
  readonly averagePosition: number;
  readonly medianPosition: number;
  readonly rating: number;
  readonly organicEstimatedTrafficVolume: number;
  readonly keywordsCount: number;
  readonly visibility: number;
  readonly relevantSerpItems: number;
}

export interface DataForSeoSerpCompetitorsResponse {
  readonly rows: readonly DataForSeoSerpCompetitorRow[];
  readonly totalCount: number;
  readonly itemsCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
}

export interface DataForSeoSerpCompetitorsClient {
  serpCompetitors(
    request: DataForSeoSerpCompetitorsRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoSerpCompetitorsResponse>;
}

/** The two narrow operations required by the composite landscape adapter. */
export type DataForSeoSearchLandscapeClient = DataForSeoRankedKeywordsClient &
  DataForSeoCompetitorsDomainClient;

export type DataForSeoSearchLandscapeV2Client =
  DataForSeoSearchLandscapeClient & DataForSeoSerpCompetitorsClient;

/** Minimal injectable fetch seam; production still uses the fixed official URL. */
export type DataForSeoFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpDataForSeoClientOptions {
  readonly login: string;
  readonly password: string;
  readonly fetchImpl?: DataForSeoFetch;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly signal?: AbortSignal;
}

type JsonRecord = Record<string, unknown>;

const SUCCESS_STATUS = 20_000;
const EMPTY_RESULT_STATUS = 40_102;

const RETRYABLE_UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([
  40_101, // internal search-engine server error
  40_103, // task execution failed; provider explicitly recommends resubmission
]);

const RETRYABLE_RATE_LIMIT_STATUSES: ReadonlySet<number> = new Set([
  40_202, // per-minute request limit
  40_209, // simultaneous-query limit
]);

const AUTH_STATUSES: ReadonlySet<number> = new Set([
  40_100, // invalid credentials / unauthorized
  40_104, // account verification required
]);

const QUOTA_STATUSES: ReadonlySet<number> = new Set([
  40_200, // payment required
  40_203, // account cost limit exceeded
  40_205, // duplicate-task hourly limit; worker retries cannot change the account policy
  40_206, // duplicate-task daily limit; worker retries cannot change the account policy
  40_210, // insufficient account balance
]);

const PERMISSION_STATUSES: ReadonlySet<number> = new Set([
  40_201, // account access paused
  40_204, // endpoint subscription/access denied
  40_207, // request IP is not whitelisted
  40_208, // account access blocked
]);

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function asRecord(value: unknown, context: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourceError("INVALID_RESPONSE", `${context} was not an object.`);
  }
  return value as JsonRecord;
}

function asStatusCode(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a valid status code.`,
    );
  }
  return value as number;
}

function asNonNegativeNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a non-negative number.`,
    );
  }
  return value;
}

function asNonNegativeInteger(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a non-negative integer.`,
    );
  }
  return value as number;
}

function asPositiveInteger(value: unknown, context: string): number {
  const parsed = asNonNegativeInteger(value, context);
  if (parsed === 0) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a positive integer.`,
    );
  }
  return parsed;
}

function nullableNonNegativeNumber(
  value: unknown,
  context: string,
): number | null {
  if (value === undefined || value === null) return null;
  return asNonNegativeNumber(value, context);
}

function nullableString(value: unknown, context: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a string.`,
    );
  }
  return value;
}

function providerStatusErrorCode(status: number): SourceErrorCode {
  if (AUTH_STATUSES.has(status)) return "AUTH_REQUIRED";
  if (QUOTA_STATUSES.has(status)) return "QUOTA_EXCEEDED";
  if (PERMISSION_STATUSES.has(status)) return "PERMISSION_DENIED";
  if (RETRYABLE_RATE_LIMIT_STATUSES.has(status)) return "RATE_LIMITED";
  if (RETRYABLE_UNAVAILABLE_STATUSES.has(status) || status >= 50_000) {
    return "UNAVAILABLE";
  }
  // DataForSEO's 40xxx/41xxx/404xx families otherwise describe invalid task,
  // endpoint, path, or parameter configurations and are not safe to retry.
  if (status >= 40_000 && status < 50_000) return "INVALID_CONFIGURATION";
  return "INVALID_RESPONSE";
}

function throwProviderStatus(status: number, scope: "request" | "task"): never {
  throw new SourceError(
    providerStatusErrorCode(status),
    `DataForSEO ${scope} failed with provider status ${status}.`,
  );
}

function httpErrorCode(status: number): SourceErrorCode {
  switch (status) {
    case 401:
      return "AUTH_REQUIRED";
    case 402:
      return "QUOTA_EXCEEDED";
    case 403:
      return "PERMISSION_DENIED";
    case 408:
      return "TIMEOUT";
    case 429:
      return "RATE_LIMITED";
    case 404:
      return "INVALID_CONFIGURATION";
    default:
      return status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE";
  }
}

function transportError(
  error: unknown,
  operation: "ranked-keywords" | "competitors-domain" | "serp-competitors",
): SourceError {
  if (error instanceof SourceError) return error;
  if (isAbortLike(error)) {
    return new SourceError(
      "TIMEOUT",
      `DataForSEO ${operation} request was aborted or timed out.`,
    );
  }
  return new SourceError(
    "NETWORK_ERROR",
    `DataForSEO ${operation} request failed to reach the API.`,
  );
}

/**
 * Canonicalize a provider domain defensively. The documented response is a
 * hostname, but accepting an HTTP(S) URL variant makes local self-exclusion
 * robust without accepting userinfo, ports, or non-web schemes.
 */
function canonicalProviderDomain(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a domain.`,
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
      "INVALID_RESPONSE",
      `${context} did not contain a valid domain.`,
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a valid public web domain.`,
    );
  }
  const domain = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  if (!HOSTNAME_RE.test(domain)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a valid public web domain.`,
    );
  }
  return domain;
}

function normalizeCompetitorsDomainRequest(
  value: DataForSeoCompetitorsDomainRequest,
): DataForSeoCompetitorsDomainRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO competitors-domain request must be an object.",
    );
  }
  let target: string;
  try {
    target = canonicalProviderDomain(
      value.target,
      "DataForSEO competitors-domain target",
    );
  } catch {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO competitors-domain target must be a valid public hostname.",
    );
  }
  const locationCode = value.locationCode;
  const locationName = value.locationName;
  if (
    (locationCode === undefined && locationName === undefined) ||
    (locationCode !== undefined && locationName !== undefined)
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO competitors-domain request must contain exactly one location selector.",
    );
  }
  if (
    locationCode !== undefined &&
    (!Number.isSafeInteger(locationCode) || locationCode <= 0)
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO competitors-domain locationCode must be a positive integer.",
    );
  }
  if (
    locationName !== undefined &&
    (typeof locationName !== "string" || locationName.trim() === "")
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO competitors-domain locationName must be a non-empty string.",
    );
  }
  if (
    typeof value.languageCode !== "string" ||
    !/^[A-Za-z]{2,3}$/.test(value.languageCode.trim())
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO competitors-domain languageCode must be a primary language code.",
    );
  }
  if (
    !Number.isSafeInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > MAX_DATAFORSEO_LIMIT
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `DataForSEO competitors-domain limit must be an integer from 1 to ${MAX_DATAFORSEO_LIMIT}.`,
    );
  }
  if (
    value.maximumRankGroup !== undefined &&
    (!Number.isSafeInteger(value.maximumRankGroup) ||
      value.maximumRankGroup < 1 ||
      value.maximumRankGroup > 100)
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO competitors-domain maximumRankGroup must be an integer from 1 to 100.",
    );
  }
  const common = {
    target,
    languageCode: value.languageCode.trim().toLowerCase(),
    limit: value.limit,
    ...(value.maximumRankGroup === undefined
      ? {}
      : { maximumRankGroup: value.maximumRankGroup }),
  };
  return locationCode !== undefined
    ? { ...common, locationCode }
    : { ...common, locationName: (locationName as string).trim() };
}

function parseRow(value: unknown, index: number): DataForSeoRankedKeywordRow {
  const item = asRecord(value, `DataForSEO item ${index}`);
  const keywordData = asRecord(
    item.keyword_data,
    `DataForSEO item ${index}.keyword_data`,
  );
  const keyword = keywordData.keyword;
  if (typeof keyword !== "string" || keyword.trim() === "") {
    throw new SourceError(
      "INVALID_RESPONSE",
      `DataForSEO item ${index} did not contain a keyword.`,
    );
  }

  const keywordInfo =
    keywordData.keyword_info === undefined || keywordData.keyword_info === null
      ? null
      : asRecord(
          keywordData.keyword_info,
          `DataForSEO item ${index}.keyword_info`,
        );
  const rankedElement =
    item.ranked_serp_element === undefined ||
    item.ranked_serp_element === null
      ? null
      : asRecord(
          item.ranked_serp_element,
          `DataForSEO item ${index}.ranked_serp_element`,
        );
  const serpItem =
    rankedElement?.serp_item === undefined ||
    rankedElement.serp_item === null
      ? null
      : asRecord(
          rankedElement.serp_item,
          `DataForSEO item ${index}.serp_item`,
        );

  return {
    keyword: keyword.trim(),
    searchVolume: nullableNonNegativeNumber(
      keywordInfo?.search_volume,
      `DataForSEO item ${index}.search_volume`,
    ),
    currentUrl: nullableString(
      serpItem?.url,
      `DataForSEO item ${index}.url`,
    ),
    currentRank: nullableNonNegativeNumber(
      serpItem?.rank_group,
      `DataForSEO item ${index}.rank_group`,
    ),
  };
}

function emptyResponse(
  providerStatusCode: number,
  taskStatusCode: number,
  costUsd: number,
): DataForSeoRankedKeywordsResponse {
  return {
    rows: [],
    totalCount: 0,
    itemsCount: 0,
    costUsd,
    providerStatusCode,
    taskStatusCode,
  };
}

function parseResponse(payload: unknown): DataForSeoRankedKeywordsResponse {
  const envelope = asRecord(payload, "DataForSEO response");
  const providerStatusCode = asStatusCode(
    envelope.status_code,
    "DataForSEO response",
  );
  if (
    providerStatusCode !== SUCCESS_STATUS &&
    providerStatusCode !== EMPTY_RESULT_STATUS
  ) {
    throwProviderStatus(providerStatusCode, "request");
  }
  const envelopeCost = asNonNegativeNumber(
    envelope.cost,
    "DataForSEO response cost",
  );
  if (providerStatusCode === EMPTY_RESULT_STATUS) {
    return emptyResponse(
      providerStatusCode,
      EMPTY_RESULT_STATUS,
      envelopeCost,
    );
  }

  if (!Array.isArray(envelope.tasks) || envelope.tasks.length !== 1) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO response did not contain exactly one task.",
    );
  }
  const task = asRecord(envelope.tasks[0], "DataForSEO task");
  const taskStatusCode = asStatusCode(task.status_code, "DataForSEO task");
  if (
    taskStatusCode !== SUCCESS_STATUS &&
    taskStatusCode !== EMPTY_RESULT_STATUS
  ) {
    throwProviderStatus(taskStatusCode, "task");
  }
  const taskCost = asNonNegativeNumber(task.cost, "DataForSEO task cost");
  if (taskStatusCode === EMPTY_RESULT_STATUS) {
    return emptyResponse(providerStatusCode, taskStatusCode, taskCost);
  }

  if (task.result === null || task.result === undefined) {
    const resultCount = task.result_count;
    if (resultCount === 0) {
      return emptyResponse(providerStatusCode, taskStatusCode, taskCost);
    }
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO task omitted its ranked-keywords result.",
    );
  }
  if (!Array.isArray(task.result)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO task result was not an array.",
    );
  }
  if (task.result.length === 0) {
    return emptyResponse(providerStatusCode, taskStatusCode, taskCost);
  }

  const result = asRecord(task.result[0], "DataForSEO ranked-keywords result");
  const rawItems = result.items;
  if (rawItems !== null && rawItems !== undefined && !Array.isArray(rawItems)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO result items was not an array.",
    );
  }
  const rows = (rawItems ?? []).map(parseRow);
  const itemsCount =
    result.items_count === null || result.items_count === undefined
      ? rows.length
      : asNonNegativeInteger(
          result.items_count,
          "DataForSEO result items_count",
        );
  if (itemsCount !== rows.length) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO result items_count did not match the returned items.",
    );
  }
  // A successful Labs response with no matching rows uses the observed shape
  // `total_count: null`, `items_count: 0`, `items: null` rather than the
  // documented no-results task status. Treat only that internally consistent
  // shape as an honest empty result; populated or contradictory responses must
  // still provide an integer total.
  const totalCount =
    result.total_count === null || result.total_count === undefined
      ? itemsCount === 0 && rows.length === 0
        ? 0
        : asNonNegativeInteger(
            result.total_count,
            "DataForSEO result total_count",
          )
      : asNonNegativeInteger(
          result.total_count,
          "DataForSEO result total_count",
        );
  if (totalCount < rows.length) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO result total_count was smaller than the returned items.",
    );
  }

  return {
    rows,
    totalCount,
    itemsCount,
    costUsd: taskCost,
    providerStatusCode,
    taskStatusCode,
  };
}

function parseCompetitorDomainRow(
  value: unknown,
  index: number,
): DataForSeoCompetitorDomainRow {
  const item = asRecord(value, `DataForSEO competitor item ${index}`);
  const competitorMetrics = asRecord(
    item.competitor_metrics,
    `DataForSEO competitor item ${index}.competitor_metrics`,
  );
  const organicMetrics = asRecord(
    competitorMetrics.organic,
    `DataForSEO competitor item ${index}.competitor_metrics.organic`,
  );
  return {
    domain: canonicalProviderDomain(
      item.domain,
      `DataForSEO competitor item ${index}`,
    ),
    averagePosition: asNonNegativeNumber(
      item.avg_position,
      `DataForSEO competitor item ${index}.avg_position`,
    ),
    summedPosition: asNonNegativeNumber(
      item.sum_position,
      `DataForSEO competitor item ${index}.sum_position`,
    ),
    intersections: asPositiveInteger(
      item.intersections,
      `DataForSEO competitor item ${index}.intersections`,
    ),
    organicEstimatedTrafficVolume: asNonNegativeNumber(
      organicMetrics.etv,
      `DataForSEO competitor item ${index}.competitor_metrics.organic.etv`,
    ),
  };
}

function emptyCompetitorsDomainResponse(
  providerStatusCode: number,
  taskStatusCode: number,
  costUsd: number,
): DataForSeoCompetitorsDomainResponse {
  return {
    rows: [],
    totalCount: 0,
    itemsCount: 0,
    costUsd,
    providerStatusCode,
    taskStatusCode,
  };
}

function parseCompetitorsDomainResponse(
  payload: unknown,
): DataForSeoCompetitorsDomainResponse {
  const envelope = asRecord(payload, "DataForSEO response");
  const providerStatusCode = asStatusCode(
    envelope.status_code,
    "DataForSEO response",
  );
  if (
    providerStatusCode !== SUCCESS_STATUS &&
    providerStatusCode !== EMPTY_RESULT_STATUS
  ) {
    throwProviderStatus(providerStatusCode, "request");
  }
  const envelopeCost = asNonNegativeNumber(
    envelope.cost,
    "DataForSEO response cost",
  );
  if (providerStatusCode === EMPTY_RESULT_STATUS) {
    return emptyCompetitorsDomainResponse(
      providerStatusCode,
      EMPTY_RESULT_STATUS,
      envelopeCost,
    );
  }

  if (!Array.isArray(envelope.tasks) || envelope.tasks.length !== 1) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO response did not contain exactly one task.",
    );
  }
  const task = asRecord(envelope.tasks[0], "DataForSEO task");
  const taskStatusCode = asStatusCode(task.status_code, "DataForSEO task");
  if (
    taskStatusCode !== SUCCESS_STATUS &&
    taskStatusCode !== EMPTY_RESULT_STATUS
  ) {
    throwProviderStatus(taskStatusCode, "task");
  }
  const taskCost = asNonNegativeNumber(task.cost, "DataForSEO task cost");
  if (taskStatusCode === EMPTY_RESULT_STATUS) {
    return emptyCompetitorsDomainResponse(
      providerStatusCode,
      taskStatusCode,
      taskCost,
    );
  }

  if (task.result === null || task.result === undefined) {
    if (task.result_count === 0) {
      return emptyCompetitorsDomainResponse(
        providerStatusCode,
        taskStatusCode,
        taskCost,
      );
    }
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO task omitted its competitors-domain result.",
    );
  }
  if (!Array.isArray(task.result)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO task result was not an array.",
    );
  }
  const resultCount =
    task.result_count === null || task.result_count === undefined
      ? undefined
      : asNonNegativeInteger(
          task.result_count,
          "DataForSEO competitors-domain task result_count",
        );
  if (
    resultCount !== undefined &&
    resultCount !== task.result.length
  ) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO competitors-domain task result_count did not match the returned results.",
    );
  }
  if (task.result.length === 0) {
    return emptyCompetitorsDomainResponse(
      providerStatusCode,
      taskStatusCode,
      taskCost,
    );
  }
  if (task.result.length !== 1) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO competitors-domain task did not contain exactly one result.",
    );
  }

  const result = asRecord(task.result[0], "DataForSEO competitors-domain result");
  const rawItems = result.items;
  if (rawItems !== null && rawItems !== undefined && !Array.isArray(rawItems)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO competitors-domain result items was not an array.",
    );
  }
  const rows = (rawItems ?? []).map(parseCompetitorDomainRow);
  const itemsCount =
    result.items_count === null || result.items_count === undefined
      ? rows.length
      : asNonNegativeInteger(
          result.items_count,
          "DataForSEO competitors-domain result items_count",
        );
  if (itemsCount !== rows.length) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO competitors-domain result items_count did not match the returned items.",
    );
  }
  const totalCount =
    result.total_count === null || result.total_count === undefined
      ? itemsCount === 0
        ? 0
        : asNonNegativeInteger(
            result.total_count,
            "DataForSEO competitors-domain result total_count",
          )
      : asNonNegativeInteger(
          result.total_count,
          "DataForSEO competitors-domain result total_count",
        );
  if (totalCount < rows.length) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO competitors-domain result total_count was smaller than the returned items.",
    );
  }

  return {
    rows,
    totalCount,
    itemsCount,
    costUsd: taskCost,
    providerStatusCode,
    taskStatusCode,
  };
}

function parseSerpCompetitorRow(
  value: unknown,
  index: number,
): DataForSeoSerpCompetitorRow {
  const item = asRecord(value, `DataForSEO SERP competitor item ${index}`);
  return {
    domain: canonicalProviderDomain(
      item.domain,
      `DataForSEO SERP competitor item ${index}`,
    ),
    averagePosition: asNonNegativeNumber(
      item.avg_position,
      `DataForSEO SERP competitor item ${index}.avg_position`,
    ),
    medianPosition: asNonNegativeNumber(
      item.median_position,
      `DataForSEO SERP competitor item ${index}.median_position`,
    ),
    rating: asNonNegativeNumber(
      item.rating,
      `DataForSEO SERP competitor item ${index}.rating`,
    ),
    organicEstimatedTrafficVolume: asNonNegativeNumber(
      item.etv,
      `DataForSEO SERP competitor item ${index}.etv`,
    ),
    keywordsCount: asNonNegativeInteger(
      item.keywords_count,
      `DataForSEO SERP competitor item ${index}.keywords_count`,
    ),
    visibility: asNonNegativeNumber(
      item.visibility,
      `DataForSEO SERP competitor item ${index}.visibility`,
    ),
    relevantSerpItems: asNonNegativeInteger(
      item.relevant_serp_items,
      `DataForSEO SERP competitor item ${index}.relevant_serp_items`,
    ),
  };
}

function emptySerpCompetitorsResponse(
  providerStatusCode: number,
  taskStatusCode: number,
  costUsd: number,
): DataForSeoSerpCompetitorsResponse {
  return {
    rows: [],
    totalCount: 0,
    itemsCount: 0,
    costUsd,
    providerStatusCode,
    taskStatusCode,
  };
}

function parseSerpCompetitorsResponse(
  payload: unknown,
): DataForSeoSerpCompetitorsResponse {
  const envelope = asRecord(payload, "DataForSEO response");
  const providerStatusCode = asStatusCode(
    envelope.status_code,
    "DataForSEO response",
  );
  if (
    providerStatusCode !== SUCCESS_STATUS &&
    providerStatusCode !== EMPTY_RESULT_STATUS
  ) {
    throwProviderStatus(providerStatusCode, "request");
  }
  const envelopeCost = asNonNegativeNumber(
    envelope.cost,
    "DataForSEO response cost",
  );
  if (providerStatusCode === EMPTY_RESULT_STATUS) {
    return emptySerpCompetitorsResponse(
      providerStatusCode,
      EMPTY_RESULT_STATUS,
      envelopeCost,
    );
  }
  if (!Array.isArray(envelope.tasks) || envelope.tasks.length !== 1) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO response did not contain exactly one task.",
    );
  }
  const task = asRecord(envelope.tasks[0], "DataForSEO task");
  const taskStatusCode = asStatusCode(task.status_code, "DataForSEO task");
  if (
    taskStatusCode !== SUCCESS_STATUS &&
    taskStatusCode !== EMPTY_RESULT_STATUS
  ) {
    throwProviderStatus(taskStatusCode, "task");
  }
  const taskCost = asNonNegativeNumber(task.cost, "DataForSEO task cost");
  if (taskStatusCode === EMPTY_RESULT_STATUS) {
    return emptySerpCompetitorsResponse(
      providerStatusCode,
      taskStatusCode,
      taskCost,
    );
  }
  if (task.result === null || task.result === undefined) {
    if (task.result_count === 0) {
      return emptySerpCompetitorsResponse(
        providerStatusCode,
        taskStatusCode,
        taskCost,
      );
    }
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO task omitted its SERP-competitors result.",
    );
  }
  if (!Array.isArray(task.result) || task.result.length !== 1) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO SERP-competitors task did not contain exactly one result.",
    );
  }
  const result = asRecord(task.result[0], "DataForSEO SERP-competitors result");
  const rawItems = result.items;
  if (rawItems !== null && rawItems !== undefined && !Array.isArray(rawItems)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO SERP-competitors result items was not an array.",
    );
  }
  const rows = (rawItems ?? []).map(parseSerpCompetitorRow);
  const itemsCount =
    result.items_count === null || result.items_count === undefined
      ? rows.length
      : asNonNegativeInteger(
          result.items_count,
          "DataForSEO SERP-competitors result items_count",
        );
  const totalCount =
    result.total_count === null || result.total_count === undefined
      ? rows.length === 0
        ? 0
        : asNonNegativeInteger(
            result.total_count,
            "DataForSEO SERP-competitors result total_count",
          )
      : asNonNegativeInteger(
          result.total_count,
          "DataForSEO SERP-competitors result total_count",
        );
  if (itemsCount !== rows.length || totalCount < rows.length) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO SERP-competitors result contained contradictory row counts.",
    );
  }
  return {
    rows,
    totalCount,
    itemsCount,
    costUsd: taskCost,
    providerStatusCode,
    taskStatusCode,
  };
}

function toProviderTask(request: DataForSeoRankedKeywordsRequest): JsonRecord {
  const minimumRankGroup = request.minimumRankGroup ?? 4;
  const maximumRankGroup = request.maximumRankGroup ?? 20;
  if (
    !Number.isSafeInteger(minimumRankGroup) ||
    !Number.isSafeInteger(maximumRankGroup) ||
    minimumRankGroup < 1 ||
    maximumRankGroup > 100 ||
    minimumRankGroup > maximumRankGroup
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO ranked-keywords rank-group policy must be an integer range from 1 to 100.",
    );
  }
  return {
    target: request.target,
    ...(request.locationCode !== undefined
      ? { location_code: request.locationCode }
      : {}),
    ...(request.locationName !== undefined
      ? { location_name: request.locationName }
      : {}),
    language_code: request.languageCode,
    historical_serp_mode: "live",
    item_types: ["organic"],
    filters: [
      ["keyword_data.keyword_info.search_volume", ">", 0],
      "and",
      ["ranked_serp_element.serp_item.rank_group", ">=", minimumRankGroup],
      "and",
      ["ranked_serp_element.serp_item.rank_group", "<=", maximumRankGroup],
    ],
    order_by: [
      "keyword_data.keyword_info.search_volume,desc",
      "ranked_serp_element.serp_item.rank_group,asc",
    ],
    limit: request.limit,
  };
}

function toCompetitorsDomainProviderTask(
  request: DataForSeoCompetitorsDomainRequest,
): JsonRecord {
  const normalized = normalizeCompetitorsDomainRequest(request);
  return {
    target: normalized.target,
    ...(normalized.locationCode !== undefined
      ? { location_code: normalized.locationCode }
      : {}),
    ...(normalized.locationName !== undefined
      ? { location_name: normalized.locationName }
      : {}),
    language_code: normalized.languageCode,
    item_types: ["organic"],
    include_clickstream_data: false,
    filters: [["intersections", ">", 0]],
    order_by: [
      "intersections,desc",
      "competitor_metrics.organic.etv,desc",
      "domain,asc",
    ],
    limit: normalized.limit,
    offset: 0,
    max_rank_group: normalized.maximumRankGroup ?? 20,
    exclude_top_domains: true,
    exclude_domains: [normalized.target],
    ignore_synonyms: false,
  };
}

function toSerpCompetitorsProviderTask(
  request: DataForSeoSerpCompetitorsRequest,
): JsonRecord {
  if (
    !Array.isArray(request.keywords) ||
    request.keywords.length < 1 ||
    request.keywords.length > 200 ||
    request.keywords.some(
      (keyword) => typeof keyword !== "string" || keyword.trim() === "",
    )
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO SERP-competitors keywords must contain 1 to 200 non-empty strings.",
    );
  }
  if (
    request.locationCode === undefined &&
    request.locationName === undefined
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO SERP-competitors request must contain one location selector.",
    );
  }
  const location =
    request.locationCode !== undefined
      ? { locationCode: request.locationCode }
      : { locationName: request.locationName! };
  const normalized = normalizeCompetitorsDomainRequest({
    target: "validation.example",
    ...location,
    languageCode: request.languageCode,
    limit: request.limit,
  });
  return {
    keywords: request.keywords.map((keyword) => keyword.trim()),
    ...(normalized.locationCode !== undefined
      ? { location_code: normalized.locationCode }
      : { location_name: normalized.locationName }),
    language_code: normalized.languageCode,
    item_types: ["organic"],
    limit: normalized.limit,
  };
}

/**
 * Fixed-endpoint DataForSEO HTTP client. Basic Auth is created and attached only
 * here; neither adapters nor returned raw data can observe the credentials.
 */
export class HttpDataForSeoClient
  implements
    DataForSeoClient,
    DataForSeoCompetitorsDomainClient,
    DataForSeoSerpCompetitorsClient
{
  private readonly authorization: string;
  private readonly fetchImpl: DataForSeoFetch;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly signal: AbortSignal | undefined;

  constructor(options: HttpDataForSeoClientOptions) {
    if (options.login.trim() === "" || options.password.trim() === "") {
      throw new SourceError(
        "AUTH_REQUIRED",
        "DataForSEO API credentials are required.",
      );
    }
    this.authorization = `Basic ${Buffer.from(
      `${options.login}:${options.password}`,
      "utf8",
    ).toString("base64")}`;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;
    this.maxResponseBytes =
      options.maxResponseBytes ?? DEFAULT_PROVIDER_MAX_RESPONSE_BYTES;
    this.signal = options.signal;
  }

  async rankedKeywords(
    request: DataForSeoRankedKeywordsRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoRankedKeywordsResponse> {
    const abortScope = createRequestAbortScope(this.requestTimeoutMs, [
      this.signal,
      signal,
    ]);
    try {
      const response = await this.fetchImpl(
        DATAFORSEO_RANKED_KEYWORDS_LIVE_URL,
        {
          method: "POST",
          headers: {
            Authorization: this.authorization,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([toProviderTask(request)]),
          redirect: "error",
          signal: abortScope.signal,
        },
      );
      if (!response.ok) {
        await cancelResponseBody(response);
        throw new SourceError(
          httpErrorCode(response.status),
          `DataForSEO ranked-keywords request failed with HTTP ${response.status}.`,
        );
      }
      const payload = await readBoundedJson(
        response,
        this.maxResponseBytes,
        "DataForSEO ranked-keywords response",
        abortScope.signal,
      );
      return parseResponse(payload);
    } catch (error) {
      throw transportError(error, "ranked-keywords");
    } finally {
      abortScope.cleanup();
    }
  }

  async competitorsDomain(
    request: DataForSeoCompetitorsDomainRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoCompetitorsDomainResponse> {
    const abortScope = createRequestAbortScope(this.requestTimeoutMs, [
      this.signal,
      signal,
    ]);
    try {
      const response = await this.fetchImpl(
        DATAFORSEO_COMPETITORS_DOMAIN_LIVE_URL,
        {
          method: "POST",
          headers: {
            Authorization: this.authorization,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([toCompetitorsDomainProviderTask(request)]),
          redirect: "error",
          signal: abortScope.signal,
        },
      );
      if (!response.ok) {
        await cancelResponseBody(response);
        throw new SourceError(
          httpErrorCode(response.status),
          `DataForSEO competitors-domain request failed with HTTP ${response.status}.`,
        );
      }
      const payload = await readBoundedJson(
        response,
        this.maxResponseBytes,
        "DataForSEO competitors-domain response",
        abortScope.signal,
      );
      return parseCompetitorsDomainResponse(payload);
    } catch (error) {
      throw transportError(error, "competitors-domain");
    } finally {
      abortScope.cleanup();
    }
  }

  async serpCompetitors(
    request: DataForSeoSerpCompetitorsRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoSerpCompetitorsResponse> {
    const abortScope = createRequestAbortScope(this.requestTimeoutMs, [
      this.signal,
      signal,
    ]);
    try {
      const response = await this.fetchImpl(
        DATAFORSEO_SERP_COMPETITORS_LIVE_URL,
        {
          method: "POST",
          headers: {
            Authorization: this.authorization,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([toSerpCompetitorsProviderTask(request)]),
          redirect: "error",
          signal: abortScope.signal,
        },
      );
      if (!response.ok) {
        await cancelResponseBody(response);
        throw new SourceError(
          httpErrorCode(response.status),
          `DataForSEO SERP-competitors request failed with HTTP ${response.status}.`,
        );
      }
      const payload = await readBoundedJson(
        response,
        this.maxResponseBytes,
        "DataForSEO SERP-competitors response",
        abortScope.signal,
      );
      return parseSerpCompetitorsResponse(payload);
    } catch (error) {
      throw transportError(error, "serp-competitors");
    } finally {
      abortScope.cleanup();
    }
  }
}
