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

export const DEFAULT_DATAFORSEO_LIMIT = 200;
export const MAX_DATAFORSEO_LIMIT = 1_000;

/** A safe, credential-free request. Authentication is owned by the HTTP client. */
export interface DataForSeoRankedKeywordsRequest {
  readonly target: string;
  readonly locationCode?: number;
  readonly locationName?: string;
  readonly languageCode: string;
  readonly limit: number;
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

export interface DataForSeoClient {
  rankedKeywords(
    request: DataForSeoRankedKeywordsRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoRankedKeywordsResponse>;
}

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
  40_205, // duplicate-task hourly limit
  40_206, // duplicate-task daily limit
  40_209, // simultaneous-query limit
]);

const AUTH_STATUSES: ReadonlySet<number> = new Set([
  40_100, // invalid credentials / unauthorized
  40_104, // account verification required
]);

const QUOTA_STATUSES: ReadonlySet<number> = new Set([
  40_200, // payment required
  40_203, // account cost limit exceeded
  40_210, // insufficient account balance
]);

const PERMISSION_STATUSES: ReadonlySet<number> = new Set([
  40_201, // account access paused
  40_204, // endpoint subscription/access denied
  40_207, // request IP is not whitelisted
  40_208, // account access blocked
]);

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

function transportError(error: unknown): SourceError {
  if (error instanceof SourceError) return error;
  if (isAbortLike(error)) {
    return new SourceError(
      "TIMEOUT",
      "DataForSEO ranked-keywords request was aborted or timed out.",
    );
  }
  return new SourceError(
    "NETWORK_ERROR",
    "DataForSEO ranked-keywords request failed to reach the API.",
  );
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
  const totalCount = asNonNegativeInteger(
    result.total_count,
    "DataForSEO result total_count",
  );
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

function toProviderTask(request: DataForSeoRankedKeywordsRequest): JsonRecord {
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
      ["ranked_serp_element.serp_item.rank_group", ">=", 4],
      "and",
      ["ranked_serp_element.serp_item.rank_group", "<=", 20],
    ],
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
    limit: request.limit,
  };
}

/**
 * Fixed-endpoint DataForSEO HTTP client. Basic Auth is created and attached only
 * here; neither adapters nor returned raw data can observe the credentials.
 */
export class HttpDataForSeoClient implements DataForSeoClient {
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
      throw transportError(error);
    } finally {
      abortScope.cleanup();
    }
  }
}
