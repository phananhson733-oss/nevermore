// @input  -- three DataForSEO live endpoints, reached through an injected fetch
// @output -- keyword metrics, typed page-one evidence, domain ranks, and what never came back
// @pos    -- the only place provider silence becomes a countable set and cost is summed
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { SourceError, type SourceErrorCode } from "../adapter.ts";
import {
  cancelResponseBody,
  createRequestAbortScope,
  DEFAULT_PROVIDER_MAX_RESPONSE_BYTES,
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  isAbortLike,
  readBoundedJson,
} from "../provider-http.ts";
import type { DataForSeoFetch } from "./client.ts";

/** Labs endpoint that answers volume/difficulty/intent for a list of terms. */
export const DATAFORSEO_KEYWORD_OVERVIEW_LIVE_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live";
/** Live SERP endpoint used to sample who actually holds page one. */
export const DATAFORSEO_SERP_ORGANIC_LIVE_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";
/** Backlinks endpoint that resolves sampled domains to a domain rank. */
export const DATAFORSEO_BULK_RANKS_LIVE_URL =
  "https://api.dataforseo.com/v3/backlinks/bulk_ranks/live";

/**
 * Keywords per keyword_overview call.
 *
 * 700 is measured, not documented: the 2026-08-10 spike sent 700 in one task
 * and the provider answered normally. Batching is done here rather than by the
 * caller because the set difference that makes provider silence visible is only
 * correct when every batch of one request is accounted for together.
 */
export const MAX_DATAFORSEO_KEYWORD_OVERVIEW_BATCH = 700;

/**
 * Total keywords one keyword_overview request may ask for.
 *
 * Every batch is billed, so an unbounded list is an unbounded invoice. The cap
 * makes a runaway caller fail loudly before the first request is sent instead
 * of quietly spending money.
 */
export const MAX_DATAFORSEO_KEYWORD_OVERVIEW_KEYWORDS = 5_000;

/** Targets per bulk_ranks call; 1000 is the provider's own documented ceiling. */
export const MAX_DATAFORSEO_BULK_RANKS_BATCH = 1_000;

/** Same cost guard as the keyword cap, applied to the second hop. */
export const MAX_DATAFORSEO_BULK_RANKS_TARGETS = 10_000;

/** Page one is ten organic results; sampling deeper buys no winnability signal. */
export const DEFAULT_DATAFORSEO_SERP_ORGANIC_DEPTH = 10;

/** One provider SERP page. Beyond this the request stops being a page-one sample. */
export const MAX_DATAFORSEO_SERP_ORGANIC_DEPTH = 100;

/** Highest value on DataForSEO's 0-1000 domain rank scale. */
export const MAX_DATAFORSEO_DOMAIN_RANK = 1_000;

/** Remote SERP text is untrusted and must not escape the provider boundary unbounded. */
const MAX_DATAFORSEO_SERP_TITLE_CHARS = 512;
const MAX_DATAFORSEO_SERP_URL_CHARS = 2_048;
const MAX_DATAFORSEO_SERP_AI_OVERVIEW_MARKDOWN_CHARS = 65_536;
const MAX_DATAFORSEO_SERP_ITEM_TYPES = 100;
const MAX_DATAFORSEO_SERP_ITEMS = 500;
const MAX_DATAFORSEO_SERP_REFERENCES = 100;
const MAX_DATAFORSEO_SERP_COMMUNITY_ITEMS = 100;

const DATAFORSEO_SERP_COMMUNITY_ITEM_TYPES = [
  "discussions_and_forums",
  "forum",
  "video",
  "twitter",
] as const;

export type DataForSeoSerpCommunityItemType =
  (typeof DATAFORSEO_SERP_COMMUNITY_ITEM_TYPES)[number];

const DATAFORSEO_KEYWORD_MAIN_INTENTS = [
  "informational",
  "navigational",
  "commercial",
  "transactional",
] as const;

/** The provider's own intent vocabulary, kept verbatim rather than remapped. */
export type DataForSeoKeywordMainIntent =
  (typeof DATAFORSEO_KEYWORD_MAIN_INTENTS)[number];

export interface DataForSeoKeywordOverviewRequest {
  /**
   * Terms exactly as the caller spells them. They are echoed back in
   * `missingKeywords` so the caller can join the answer to its own list.
   */
  readonly keywords: readonly string[];
  readonly locationCode: number;
  readonly languageCode: string;
}

export interface DataForSeoKeywordOverviewRow {
  /** The provider's spelling, which is usually lowercased from what was asked. */
  readonly keyword: string;
  /**
   * Monthly searches. `null` means the provider reported no volume for the
   * term; it is never 0. A numeric 0 is the provider explicitly measuring no
   * demand, which is a different fact and must stay distinguishable.
   */
  readonly searchVolume: number | null;
  /**
   * Provider keyword difficulty, 0-100. `null` means absent, never "easy".
   */
  readonly keywordDifficulty: number | null;
  /** Dominant intent, or `null` when the provider did not classify the term. */
  readonly mainIntent: DataForSeoKeywordMainIntent | null;
  /**
   * SERP feature types observed for the term. `null` means the provider
   * returned no SERP snapshot at all, which is not the same as an empty list
   * (a page one with no special features); a caller that collapses the two
   * reports "no AI overview" for a keyword nobody looked at.
   */
  readonly serpItemTypes: readonly string[] | null;
}

export interface DataForSeoKeywordOverviewResponse {
  readonly rows: readonly DataForSeoKeywordOverviewRow[];
  /**
   * Requested terms the provider never answered for, in the caller's own
   * spelling.
   *
   * keyword_overview drops terms it holds no data for instead of returning
   * them with a zero — 20 asked / 13 returned and 1522 asked / 382 returned in
   * the 2026-08-10 spike. Without this set the caller cannot tell provider
   * silence from measured zero demand, and the pipeline downstream is built on
   * exactly that distinction.
   */
  readonly missingKeywords: readonly string[];
  /** Summed provider cost across every batch; the only cost signal that exists. */
  readonly costUsd: number;
  readonly batchCount: number;
  /**
   * One status per batch, in request order. Plural because a batched request
   * has no single provider status, and reporting only the last one would hide
   * a batch that came back empty.
   */
  readonly providerStatusCodes: readonly number[];
  readonly taskStatusCodes: readonly number[];
}

export interface DataForSeoSerpOrganicRequest {
  readonly keyword: string;
  readonly locationCode: number;
  readonly languageCode: string;
  /** Defaults to page one (10). */
  readonly depth?: number;
  /** Ask the paid Live endpoint to load an asynchronous AI Overview. */
  readonly loadAsyncAiOverview?: boolean;
}

export interface DataForSeoSerpOrganicRow {
  /** The provider's rank_group, i.e. the position a reader sees. */
  readonly rankGroup: number;
  /** Hostname, lowercased with a leading `www.` removed so ranks can join. */
  readonly domain: string;
  /**
   * Sitelinks Google chose to show under this result.
   *
   * Zero for a result that has none *and* for one the provider did not describe
   * — those are the same shape on the wire, so a caller reading a low number as
   * "Google showed nothing extra" would be adding a claim this does not carry.
   */
  readonly sitelinkCount: number;
  /** The result title, or null when the provider omitted it. */
  readonly title: string | null;
  /** The result's own URL, or null when the provider did not give one. */
  readonly url: string | null;
}

export interface DataForSeoSerpAiOverviewReference {
  readonly source: string | null;
  readonly domain: string | null;
  readonly title: string | null;
  readonly url: string | null;
}

export interface DataForSeoSerpAiOverview {
  /** Provider markdown only; omitted content stays null rather than empty text. */
  readonly markdown: string | null;
  /** Provider `asynchronous_ai_overview`, or null when it was not reported. */
  readonly isAsync: boolean | null;
  readonly references: readonly DataForSeoSerpAiOverviewReference[];
}

export interface DataForSeoSerpCommunityItem {
  /** The provider's top-level community block type; never an inferred page type. */
  readonly type: DataForSeoSerpCommunityItemType;
  /** `rank_absolute` when present, otherwise `rank_group`. */
  readonly position: number;
  readonly title: string | null;
  readonly url: string | null;
  readonly domain: string | null;
}

export interface DataForSeoSerpOrganicResponse {
  readonly keyword: string;
  /** Organic results only, in provider order, truncated to the requested depth. */
  readonly rows: readonly DataForSeoSerpOrganicRow[];
  /**
   * Item types present on the sampled page, e.g. `ai_overview` or
   * `people_also_ask`. `null` means the provider did not report the list, so a
   * caller must not read the absence of `ai_overview` as "no AI overview shown".
   */
  readonly itemTypes: readonly string[] | null;
  /** Null means no AI Overview block was supplied, not an empty answer. */
  readonly aiOverview: DataForSeoSerpAiOverview | null;
  /** Null means community block availability was not reported; [] means none. */
  readonly communityItems: readonly DataForSeoSerpCommunityItem[] | null;
  /**
   * Organic items dropped because their rank or domain was unusable.
   *
   * Counted rather than silently skipped: a sample that lost half its page one
   * is a weaker sample, and the winnability verdict built on it should be able
   * to say so.
   */
  readonly unresolvedItemCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
}

export interface DataForSeoBulkRanksRequest {
  /** Hostnames; normalized the same way as sampled SERP domains so they join. */
  readonly targets: readonly string[];
}

export interface DataForSeoBulkRankRow {
  readonly target: string;
  /**
   * DataForSEO domain rank on its 0-1000 scale, passed through unchanged.
   *
   * A returned 0 is the provider's own conflation of "no backlink data" with
   * "rank zero" — it is deliberately NOT converted to null here, because doing
   * so would invent a distinction the provider does not make. Callers reading
   * this as a weakness signal must say the rank was 0, not that the site is
   * weak.
   */
  readonly rank: number;
}

export interface DataForSeoBulkRanksResponse {
  readonly rows: readonly DataForSeoBulkRankRow[];
  /**
   * Requested targets with no usable rank row, in the caller's own spelling.
   * An unresolved target is unknown authority, never rank 0.
   */
  readonly unresolvedTargets: readonly string[];
  readonly costUsd: number;
  readonly batchCount: number;
  readonly providerStatusCodes: readonly number[];
  readonly taskStatusCodes: readonly number[];
}

/** The three narrow operations the Keyword Opportunity Map needs from DataForSEO. */
export interface DataForSeoKeywordMetricsClient {
  keywordOverview(
    request: DataForSeoKeywordOverviewRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoKeywordOverviewResponse>;
  serpOrganic(
    request: DataForSeoSerpOrganicRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoSerpOrganicResponse>;
  bulkRanks(
    request: DataForSeoBulkRanksRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoBulkRanksResponse>;
}

export interface DataForSeoKeywordMetricsClientOptions {
  readonly login: string;
  readonly password: string;
  /** Offline test seam. */
  readonly fetchImpl?: DataForSeoFetch;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly signal?: AbortSignal;
}

type JsonRecord = Record<string, unknown>;

type KeywordMetricsOperation =
  | "keyword-overview"
  | "serp-organic"
  | "bulk-ranks";

const SUCCESS_STATUS = 20_000;
const EMPTY_RESULT_STATUS = 40_102;

// The status tables below intentionally repeat client.ts rather than importing
// private helpers from it: client.ts is a class with its own endpoint set, and
// widening its exports to share four Sets would couple two independent seams.
const RETRYABLE_UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([
  40_101, // internal search-engine server error
  40_103, // task execution failed; the provider recommends resubmission
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
  40_203, // account cost limit exceeded; retrying cannot change account policy
  40_205, // duplicate-task hourly limit
  40_206, // duplicate-task daily limit
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

const LANGUAGE_CODE_RE = /^[A-Za-z]{2,3}$/;

function invalidResponse(message: string): SourceError {
  return new SourceError("INVALID_RESPONSE", message);
}

function invalidConfiguration(message: string): SourceError {
  return new SourceError("INVALID_CONFIGURATION", message);
}

function asRecord(value: unknown, context: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse(`${context} was not an object.`);
  }
  return value as JsonRecord;
}

function optionalRecord(value: unknown, context: string): JsonRecord | null {
  if (value === undefined || value === null) return null;
  return asRecord(value, context);
}

function asStatusCode(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value)) {
    throw invalidResponse(`${context} did not contain a valid status code.`);
  }
  return value as number;
}

function asNonNegativeNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw invalidResponse(`${context} did not contain a non-negative number.`);
  }
  return value;
}

function nullableNonNegativeNumber(
  value: unknown,
  context: string,
): number | null {
  if (value === undefined || value === null) return null;
  return asNonNegativeNumber(value, context);
}

function nullableIntegerInRange(
  value: unknown,
  min: number,
  max: number,
  context: string,
): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value)) {
    throw invalidResponse(
      `${context} did not contain an integer from ${min} to ${max}.`,
    );
  }
  const parsed = value as number;
  if (parsed < min || parsed > max) {
    throw invalidResponse(
      `${context} did not contain an integer from ${min} to ${max}.`,
    );
  }
  return parsed;
}

function positiveIntegerOrNull(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 1
    ? (value as number)
    : null;
}

function nullableStringArray(
  value: unknown,
  context: string,
): readonly string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw invalidResponse(`${context} was not an array.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw invalidResponse(`${context}[${index}] was not a non-empty string.`);
    }
    return entry.trim();
  });
}

function nullableBoundedString(
  value: unknown,
  maximum: number,
  context: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw invalidResponse(`${context} did not contain a string.`);
  }
  if (value.trim() === "") return null;
  if (Array.from(value).length > maximum) {
    throw invalidResponse(
      `${context} exceeded the ${maximum} character limit.`,
    );
  }
  return value;
}

function nullableBoundedStringArray(
  value: unknown,
  maximumItems: number,
  maximumChars: number,
  context: string,
): readonly string[] | null {
  const values = optionalBoundedArray(value, maximumItems, context);
  if (values === null) return null;
  return values.map((entry, index) => {
    const parsed = nullableBoundedString(
      entry,
      maximumChars,
      `${context}[${index}]`,
    );
    if (parsed === null) {
      throw invalidResponse(`${context}[${index}] was not a non-empty string.`);
    }
    return parsed.trim();
  });
}

function optionalBoundedArray(
  value: unknown,
  maximumItems: number,
  context: string,
): readonly unknown[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw invalidResponse(`${context} was not an array.`);
  }
  if (value.length > maximumItems) {
    throw invalidResponse(
      `${context} exceeded the ${maximumItems} item limit.`,
    );
  }
  return value;
}

function nullableBoolean(value: unknown, context: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    throw invalidResponse(`${context} did not contain a boolean.`);
  }
  return value;
}

function nullablePositiveInteger(
  value: unknown,
  context: string,
): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalidResponse(`${context} did not contain a positive integer.`);
  }
  return value as number;
}

function nullableMainIntent(
  value: unknown,
  context: string,
): DataForSeoKeywordMainIntent | null {
  if (value === undefined || value === null) return null;
  // An unrecognized intent is a contract change, not a missing value. Failing
  // here surfaces it once; coercing it to null would keep every downstream
  // surface confidently mislabelling the term.
  if (
    typeof value !== "string" ||
    !DATAFORSEO_KEYWORD_MAIN_INTENTS.includes(
      value as DataForSeoKeywordMainIntent,
    )
  ) {
    throw invalidResponse(`${context} did not contain a supported intent.`);
  }
  return value as DataForSeoKeywordMainIntent;
}

function providerStatusErrorCode(status: number): SourceErrorCode {
  if (AUTH_STATUSES.has(status)) return "AUTH_REQUIRED";
  if (QUOTA_STATUSES.has(status)) return "QUOTA_EXCEEDED";
  if (PERMISSION_STATUSES.has(status)) return "PERMISSION_DENIED";
  if (RETRYABLE_RATE_LIMIT_STATUSES.has(status)) return "RATE_LIMITED";
  if (RETRYABLE_UNAVAILABLE_STATUSES.has(status) || status >= 50_000) {
    return "UNAVAILABLE";
  }
  // The remaining 4xxxx families describe invalid task, endpoint or parameter
  // configurations, which a retry cannot fix.
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
    case 404:
      return "INVALID_CONFIGURATION";
    case 408:
      return "TIMEOUT";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE";
  }
}

function transportError(
  error: unknown,
  operation: KeywordMetricsOperation,
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
 * The join key for a term.
 *
 * The provider echoes terms with its own casing and spacing, so comparing raw
 * strings turns a returned row into a missing one — which in this pipeline
 * means inventing a "no provider data" verdict for a keyword that was answered.
 */
export function dataForSeoKeywordKey(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The join key for a host. SERP domains and bulk-rank targets are normalized
 * identically, because the second hop only works if the two sets can be matched
 * without the caller guessing at `www.` handling.
 */
function domainKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  return HOSTNAME_RE.test(host) ? host : null;
}

function chunk<T>(
  values: readonly T[],
  size: number,
): readonly (readonly T[])[] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

/** Deduplicate by join key while keeping the caller's first spelling. */
function dedupeByKey(
  values: readonly string[],
  key: (value: string) => string | null,
): readonly string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const value of values) {
    const normalized = key(value);
    if (normalized === null || seen.has(normalized)) continue;
    seen.add(normalized);
    kept.push(value);
  }
  return kept;
}

interface DataForSeoLiveTask {
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
  readonly costUsd: number;
  /** `null` when the provider honestly reported no result for this task. */
  readonly result: JsonRecord | null;
}

/**
 * Unwrap the envelope every live endpoint shares.
 *
 * Cost is read before any result is inspected: an empty or no-data response is
 * still billed, and dropping its cost would understate what a run actually
 * spent.
 */
function parseLiveTask(payload: unknown, context: string): DataForSeoLiveTask {
  const envelope = asRecord(payload, `${context} response`);
  const providerStatusCode = asStatusCode(
    envelope.status_code,
    `${context} response`,
  );
  if (
    providerStatusCode !== SUCCESS_STATUS &&
    providerStatusCode !== EMPTY_RESULT_STATUS
  ) {
    throwProviderStatus(providerStatusCode, "request");
  }
  const envelopeCost = asNonNegativeNumber(
    envelope.cost,
    `${context} response cost`,
  );
  if (providerStatusCode === EMPTY_RESULT_STATUS) {
    return {
      providerStatusCode,
      taskStatusCode: EMPTY_RESULT_STATUS,
      costUsd: envelopeCost,
      result: null,
    };
  }
  if (!Array.isArray(envelope.tasks) || envelope.tasks.length !== 1) {
    throw invalidResponse(
      `${context} response did not contain exactly one task.`,
    );
  }
  const task = asRecord(envelope.tasks[0], `${context} task`);
  const taskStatusCode = asStatusCode(task.status_code, `${context} task`);
  if (
    taskStatusCode !== SUCCESS_STATUS &&
    taskStatusCode !== EMPTY_RESULT_STATUS
  ) {
    throwProviderStatus(taskStatusCode, "task");
  }
  const costUsd = asNonNegativeNumber(task.cost, `${context} task cost`);
  return {
    providerStatusCode,
    taskStatusCode,
    costUsd,
    result: firstResult(task.result, context),
  };
}

function firstResult(value: unknown, context: string): JsonRecord | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw invalidResponse(`${context} task result was not an array.`);
  }
  if (value.length === 0) return null;
  return asRecord(value[0], `${context} result`);
}

function resultItems(
  result: JsonRecord | null,
  context: string,
): readonly unknown[] {
  if (result === null) return [];
  const items = result.items;
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items)) {
    throw invalidResponse(`${context} result items was not an array.`);
  }
  return items;
}

function parseKeywordOverviewRow(
  value: unknown,
  index: number,
): DataForSeoKeywordOverviewRow {
  const context = `DataForSEO keyword-overview item ${index}`;
  const item = asRecord(value, context);
  const keyword = item.keyword;
  if (typeof keyword !== "string" || keyword.trim() === "") {
    throw invalidResponse(`${context} did not contain a keyword.`);
  }
  const keywordInfo = optionalRecord(
    item.keyword_info,
    `${context}.keyword_info`,
  );
  const keywordProperties = optionalRecord(
    item.keyword_properties,
    `${context}.keyword_properties`,
  );
  const searchIntentInfo = optionalRecord(
    item.search_intent_info,
    `${context}.search_intent_info`,
  );
  const serpInfo = optionalRecord(item.serp_info, `${context}.serp_info`);
  return {
    keyword: keyword.trim(),
    searchVolume: nullableNonNegativeNumber(
      keywordInfo?.search_volume,
      `${context}.keyword_info.search_volume`,
    ),
    keywordDifficulty: nullableIntegerInRange(
      keywordProperties?.keyword_difficulty,
      0,
      100,
      `${context}.keyword_properties.keyword_difficulty`,
    ),
    mainIntent: nullableMainIntent(
      searchIntentInfo?.main_intent,
      `${context}.search_intent_info.main_intent`,
    ),
    serpItemTypes:
      serpInfo === null
        ? null
        : nullableStringArray(
            serpInfo.serp_item_types,
            `${context}.serp_info.serp_item_types`,
          ),
  };
}

interface KeywordOverviewBatch extends DataForSeoLiveTask {
  readonly rows: readonly DataForSeoKeywordOverviewRow[];
}

function parseKeywordOverviewBatch(payload: unknown): KeywordOverviewBatch {
  const task = parseLiveTask(payload, "DataForSEO keyword-overview");
  const items = resultItems(task.result, "DataForSEO keyword-overview");
  return { ...task, rows: items.map(parseKeywordOverviewRow) };
}

interface SerpOrganicItems {
  readonly rows: readonly DataForSeoSerpOrganicRow[];
  readonly unresolvedItemCount: number;
}

function isSerpCommunityItemType(
  value: unknown,
): value is DataForSeoSerpCommunityItemType {
  return (
    typeof value === "string" &&
    DATAFORSEO_SERP_COMMUNITY_ITEM_TYPES.includes(
      value as DataForSeoSerpCommunityItemType,
    )
  );
}

function communityPosition(item: JsonRecord, context: string): number {
  const absolute = nullablePositiveInteger(
    item.rank_absolute,
    `${context}.rank_absolute`,
  );
  if (absolute !== null) return absolute;
  const group = nullablePositiveInteger(
    item.rank_group,
    `${context}.rank_group`,
  );
  if (group !== null) return group;
  throw invalidResponse(`${context} did not contain a reportable position.`);
}

function nullableProviderDomain(
  value: unknown,
  context: string,
): string | null {
  const bounded = nullableBoundedString(value, 253, context);
  if (bounded === null) return null;
  const direct = domainKey(bounded);
  if (direct !== null) return direct;
  try {
    const parsed = new URL(`http://${bounded}`);
    const normalized = domainKey(parsed.hostname);
    if (
      normalized !== null &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.port === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === ""
    ) {
      return normalized;
    }
  } catch {
    // Fall through to one bounded provider-contract error below.
  }
  throw invalidResponse(`${context} did not contain a valid hostname.`);
}

interface SerpCommunityItems {
  readonly items: readonly DataForSeoSerpCommunityItem[];
  readonly blockReported: boolean;
}

function collectSerpCommunityItems(
  items: readonly unknown[],
): SerpCommunityItems {
  const collected: DataForSeoSerpCommunityItem[] = [];
  let blockReported = false;

  for (const [index, value] of items.entries()) {
    const context = `DataForSEO serp-organic item ${index}`;
    const block = asRecord(value, context);
    if (!isSerpCommunityItemType(block.type)) continue;
    blockReported = true;
    const type = block.type;
    const nested = optionalBoundedArray(
      block.items,
      MAX_DATAFORSEO_SERP_COMMUNITY_ITEMS,
      `${context}.items`,
    );
    const candidates = nested ?? [block];
    if (candidates.length === 0) continue;
    const position = communityPosition(block, context);
    for (const [candidateIndex, candidateValue] of candidates.entries()) {
      const candidateContext =
        nested === null ? context : `${context}.items[${candidateIndex}]`;
      const candidate =
        nested === null
          ? block
          : asRecord(candidateValue, candidateContext);
      if (nested !== null && candidate.type !== `${type}_element`) {
        throw invalidResponse(
          `${candidateContext}.type did not match ${type}_element.`,
        );
      }
      const title = nullableBoundedString(
        candidate.title,
        MAX_DATAFORSEO_SERP_TITLE_CHARS,
        `${candidateContext}.title`,
      );
      const url = nullableBoundedString(
        candidate.url,
        MAX_DATAFORSEO_SERP_URL_CHARS,
        `${candidateContext}.url`,
      );
      const domain = nullableProviderDomain(
        candidate.domain,
        `${candidateContext}.domain`,
      );
      // A container label is not a concrete result.
      if (url === null && domain === null) continue;
      if (collected.length >= MAX_DATAFORSEO_SERP_COMMUNITY_ITEMS) {
        throw invalidResponse(
          `DataForSEO serp-organic community items exceeded the ${MAX_DATAFORSEO_SERP_COMMUNITY_ITEMS} item limit.`,
        );
      }
      collected.push({ type, position, title, url, domain });
    }
  }

  return { items: collected, blockReported };
}

function parseSerpAiOverview(
  items: readonly unknown[],
): DataForSeoSerpAiOverview | null {
  const blocks: { readonly item: JsonRecord; readonly index: number }[] = [];
  for (const [index, value] of items.entries()) {
    const item = asRecord(value, `DataForSEO serp-organic item ${index}`);
    if (item.type === "ai_overview") blocks.push({ item, index });
  }
  if (blocks.length === 0) return null;
  if (blocks.length > 1) {
    throw invalidResponse(
      "DataForSEO serp-organic result contained more than one AI Overview block.",
    );
  }

  const block = blocks[0];
  if (block === undefined) return null;
  const context = `DataForSEO serp-organic item ${block.index}`;
  const references: DataForSeoSerpAiOverviewReference[] = [];
  const referenceKeys = new Set<string>();
  const appendReferences = (value: unknown, referenceContext: string): void => {
    const values = optionalBoundedArray(
      value,
      MAX_DATAFORSEO_SERP_REFERENCES,
      referenceContext,
    );
    if (values === null) return;
    for (const [index, entry] of values.entries()) {
      const itemContext = `${referenceContext}[${index}]`;
      const reference = asRecord(entry, itemContext);
      const source = nullableBoundedString(
        reference.source,
        MAX_DATAFORSEO_SERP_TITLE_CHARS,
        `${itemContext}.source`,
      );
      const domain = nullableProviderDomain(
        reference.domain,
        `${itemContext}.domain`,
      );
      const title = nullableBoundedString(
        reference.title,
        MAX_DATAFORSEO_SERP_TITLE_CHARS,
        `${itemContext}.title`,
      );
      const url = nullableBoundedString(
        reference.url,
        MAX_DATAFORSEO_SERP_URL_CHARS,
        `${itemContext}.url`,
      );
      if (
        source === null &&
        domain === null &&
        title === null &&
        url === null
      ) {
        continue;
      }
      const key =
        url !== null
          ? `url:${url}`
          : domain !== null
            ? `domain:${domain}`
            : source !== null
              ? `source:${source}`
              : `title:${title}`;
      if (referenceKeys.has(key)) continue;
      if (references.length >= MAX_DATAFORSEO_SERP_REFERENCES) {
        throw invalidResponse(
          `DataForSEO serp-organic AI Overview references exceeded the ${MAX_DATAFORSEO_SERP_REFERENCES} item limit.`,
        );
      }
      referenceKeys.add(key);
      references.push({ source, domain, title, url });
    }
  };
  appendReferences(block.item.references, `${context}.references`);
  const nestedItems = optionalBoundedArray(
    block.item.items,
    MAX_DATAFORSEO_SERP_ITEMS,
    `${context}.items`,
  );
  if (nestedItems !== null) {
    for (const [index, value] of nestedItems.entries()) {
      const itemContext = `${context}.items[${index}]`;
      const item = asRecord(value, itemContext);
      appendReferences(item.references, `${itemContext}.references`);
    }
  }
  return {
    markdown: nullableBoundedString(
      block.item.markdown,
      MAX_DATAFORSEO_SERP_AI_OVERVIEW_MARKDOWN_CHARS,
      `${context}.markdown`,
    ),
    isAsync: nullableBoolean(
      block.item.asynchronous_ai_overview,
      `${context}.asynchronous_ai_overview`,
    ),
    references,
  };
}

/**
 * Keep only organic results, in provider order, and count what was unusable.
 *
 * A row without a usable rank or host is dropped instead of being carried with
 * a null domain: the whole point of the sample is which hosts hold page one, so
 * a placeholder row would inflate the sample size without adding evidence.
 */
function collectSerpOrganicRows(
  items: readonly unknown[],
  depth: number,
): SerpOrganicItems {
  const rows: DataForSeoSerpOrganicRow[] = [];
  let unresolvedItemCount = 0;
  for (const [index, value] of items.entries()) {
    const item = asRecord(value, `DataForSEO serp-organic item ${index}`);
    if (item.type !== "organic") continue;
    const domain = domainKey(item.domain);
    const rankGroup = positiveIntegerOrNull(item.rank_group);
    if (domain === null || rankGroup === null) {
      unresolvedItemCount += 1;
      continue;
    }
    if (rows.length >= depth) continue;
    rows.push({
      rankGroup,
      domain,
      sitelinkCount: Array.isArray(item.links) ? item.links.length : 0,
      title: nullableBoundedString(
        item.title,
        MAX_DATAFORSEO_SERP_TITLE_CHARS,
        `DataForSEO serp-organic item ${index}.title`,
      ),
      url: nullableBoundedString(
        item.url,
        MAX_DATAFORSEO_SERP_URL_CHARS,
        `DataForSEO serp-organic item ${index}.url`,
      ),
    });
  }
  return { rows, unresolvedItemCount };
}

function parseSerpOrganicResponse(
  payload: unknown,
  keyword: string,
  depth: number,
): DataForSeoSerpOrganicResponse {
  const task = parseLiveTask(payload, "DataForSEO serp-organic");
  const items = resultItems(task.result, "DataForSEO serp-organic");
  if (items.length > MAX_DATAFORSEO_SERP_ITEMS) {
    throw invalidResponse(
      `DataForSEO serp-organic result items exceeded the ${MAX_DATAFORSEO_SERP_ITEMS} item limit.`,
    );
  }
  const collected = collectSerpOrganicRows(items, depth);
  const itemTypes =
    task.result === null
      ? null
      : nullableBoundedStringArray(
          task.result.item_types,
          MAX_DATAFORSEO_SERP_ITEM_TYPES,
          100,
          "DataForSEO serp-organic result item_types",
        );
  const community = collectSerpCommunityItems(items);
  return {
    keyword,
    rows: collected.rows,
    itemTypes,
    aiOverview: parseSerpAiOverview(items),
    communityItems:
      itemTypes !== null || community.blockReported ? community.items : null,
    unresolvedItemCount: collected.unresolvedItemCount,
    costUsd: task.costUsd,
    providerStatusCode: task.providerStatusCode,
    taskStatusCode: task.taskStatusCode,
  };
}

interface BulkRanksBatch extends DataForSeoLiveTask {
  readonly rows: readonly DataForSeoBulkRankRow[];
}

function parseBulkRanksBatch(payload: unknown): BulkRanksBatch {
  const task = parseLiveTask(payload, "DataForSEO bulk-ranks");
  const items = resultItems(task.result, "DataForSEO bulk-ranks");
  const rows: DataForSeoBulkRankRow[] = [];
  for (const [index, value] of items.entries()) {
    const context = `DataForSEO bulk-ranks item ${index}`;
    const item = asRecord(value, context);
    const target = domainKey(item.target);
    const rank = nullableIntegerInRange(
      item.rank,
      0,
      MAX_DATAFORSEO_DOMAIN_RANK,
      `${context}.rank`,
    );
    // A row the provider returned without a usable target or rank resolves
    // nothing; leaving it out puts the target in `unresolvedTargets`, which is
    // the honest answer rather than a fabricated rank.
    if (target === null || rank === null) continue;
    rows.push({ target, rank });
  }
  return { ...task, rows };
}

interface NormalizedKeywordOverviewRequest {
  readonly keywords: readonly string[];
  readonly locationCode: number;
  readonly languageCode: string;
}

function normalizeLocationCode(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw invalidConfiguration(
      `DataForSEO ${label} locationCode must be a positive integer.`,
    );
  }
  return value as number;
}

function normalizeLanguageCode(value: unknown, label: string): string {
  if (typeof value !== "string" || !LANGUAGE_CODE_RE.test(value.trim())) {
    throw invalidConfiguration(
      `DataForSEO ${label} languageCode must be a primary language code.`,
    );
  }
  return value.trim().toLowerCase();
}

function normalizeKeywordOverviewRequest(
  request: DataForSeoKeywordOverviewRequest,
): NormalizedKeywordOverviewRequest {
  if (
    !Array.isArray(request.keywords) ||
    request.keywords.some(
      (keyword) => typeof keyword !== "string" || keyword.trim() === "",
    )
  ) {
    throw invalidConfiguration(
      "DataForSEO keyword-overview keywords must all be non-empty strings.",
    );
  }
  const keywords = dedupeByKey(request.keywords, (value) => {
    const key = dataForSeoKeywordKey(value);
    return key === "" ? null : key;
  });
  if (
    keywords.length < 1 ||
    keywords.length > MAX_DATAFORSEO_KEYWORD_OVERVIEW_KEYWORDS
  ) {
    throw invalidConfiguration(
      `DataForSEO keyword-overview keywords must contain 1 to ${MAX_DATAFORSEO_KEYWORD_OVERVIEW_KEYWORDS} distinct terms.`,
    );
  }
  return {
    keywords,
    locationCode: normalizeLocationCode(
      request.locationCode,
      "keyword-overview",
    ),
    languageCode: normalizeLanguageCode(
      request.languageCode,
      "keyword-overview",
    ),
  };
}

interface NormalizedSerpOrganicRequest {
  readonly keyword: string;
  readonly locationCode: number;
  readonly languageCode: string;
  readonly depth: number;
  readonly loadAsyncAiOverview: boolean;
}

function normalizeSerpOrganicRequest(
  request: DataForSeoSerpOrganicRequest,
): NormalizedSerpOrganicRequest {
  if (typeof request.keyword !== "string" || request.keyword.trim() === "") {
    throw invalidConfiguration(
      "DataForSEO serp-organic keyword must be a non-empty string.",
    );
  }
  const depth = request.depth ?? DEFAULT_DATAFORSEO_SERP_ORGANIC_DEPTH;
  if (
    !Number.isSafeInteger(depth) ||
    depth < 1 ||
    depth > MAX_DATAFORSEO_SERP_ORGANIC_DEPTH
  ) {
    throw invalidConfiguration(
      `DataForSEO serp-organic depth must be an integer from 1 to ${MAX_DATAFORSEO_SERP_ORGANIC_DEPTH}.`,
    );
  }
  if (
    request.loadAsyncAiOverview !== undefined &&
    typeof request.loadAsyncAiOverview !== "boolean"
  ) {
    throw invalidConfiguration(
      "DataForSEO serp-organic loadAsyncAiOverview must be a boolean.",
    );
  }
  return {
    keyword: request.keyword.trim(),
    locationCode: normalizeLocationCode(request.locationCode, "serp-organic"),
    languageCode: normalizeLanguageCode(request.languageCode, "serp-organic"),
    depth,
    loadAsyncAiOverview: request.loadAsyncAiOverview === true,
  };
}

/**
 * The caller's spelling kept next to the key actually sent.
 *
 * Both are needed at once: the provider is asked with the normalized host, but
 * an unresolved target has to be reported back in the caller's own words or the
 * caller cannot tell which of its inputs went unanswered.
 */
interface BulkRankTarget {
  readonly requested: string;
  readonly key: string;
}

function normalizeBulkRanksTargets(
  request: DataForSeoBulkRanksRequest,
): readonly BulkRankTarget[] {
  if (
    !Array.isArray(request.targets) ||
    request.targets.some((target) => domainKey(target) === null)
  ) {
    throw invalidConfiguration(
      "DataForSEO bulk-ranks targets must all be valid public hostnames.",
    );
  }
  const targets = dedupeByKey(request.targets, domainKey).map<BulkRankTarget>(
    (requested) => ({ requested, key: domainKey(requested) ?? requested }),
  );
  if (
    targets.length < 1 ||
    targets.length > MAX_DATAFORSEO_BULK_RANKS_TARGETS
  ) {
    throw invalidConfiguration(
      `DataForSEO bulk-ranks targets must contain 1 to ${MAX_DATAFORSEO_BULK_RANKS_TARGETS} distinct hostnames.`,
    );
  }
  return targets;
}

/**
 * Fixed-endpoint client for the three Keyword Opportunity Map hops.
 *
 * A factory rather than a class so the Basic Auth header is closed over and can
 * never be read back off the returned object — the returned values are meant to
 * be persistable as raw provider evidence.
 */
export function createDataForSeoKeywordMetricsClient(
  options: DataForSeoKeywordMetricsClientOptions,
): DataForSeoKeywordMetricsClient {
  if (
    typeof options.login !== "string" ||
    typeof options.password !== "string" ||
    options.login.trim() === "" ||
    options.password.trim() === ""
  ) {
    throw new SourceError(
      "AUTH_REQUIRED",
      "DataForSEO API credentials are required.",
    );
  }
  const authorization = `Basic ${Buffer.from(
    `${options.login}:${options.password}`,
    "utf8",
  ).toString("base64")}`;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_PROVIDER_MAX_RESPONSE_BYTES;

  async function liveRequest<T>(
    url: string,
    task: JsonRecord,
    operation: KeywordMetricsOperation,
    parse: (payload: unknown) => T,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const abortScope = createRequestAbortScope(requestTimeoutMs, [
      options.signal,
      signal,
    ]);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([task]),
        redirect: "error",
        signal: abortScope.signal,
      });
      if (!response.ok) {
        await cancelResponseBody(response);
        throw new SourceError(
          httpErrorCode(response.status),
          `DataForSEO ${operation} request failed with HTTP ${response.status}.`,
        );
      }
      const payload = await readBoundedJson(
        response,
        maxResponseBytes,
        `DataForSEO ${operation} response`,
        abortScope.signal,
      );
      return parse(payload);
    } catch (error) {
      throw transportError(error, operation);
    } finally {
      abortScope.cleanup();
    }
  }

  return {
    async keywordOverview(request, signal) {
      const normalized = normalizeKeywordOverviewRequest(request);
      const batches = chunk(
        normalized.keywords,
        MAX_DATAFORSEO_KEYWORD_OVERVIEW_BATCH,
      );
      const rows: DataForSeoKeywordOverviewRow[] = [];
      const answered = new Set<string>();
      const providerStatusCodes: number[] = [];
      const taskStatusCodes: number[] = [];
      let costUsd = 0;
      // Batches run one at a time on purpose: firing 3 parallel 700-keyword
      // tasks is the fastest way to meet the provider's per-minute limit, and a
      // rate-limited batch would look like provider silence in the diff.
      for (const batch of batches) {
        const parsed = await liveRequest(
          DATAFORSEO_KEYWORD_OVERVIEW_LIVE_URL,
          {
            keywords: batch.map((keyword) => keyword.trim()),
            location_code: normalized.locationCode,
            language_code: normalized.languageCode,
            include_serp_info: true,
          },
          "keyword-overview",
          parseKeywordOverviewBatch,
          signal,
        );
        costUsd += parsed.costUsd;
        providerStatusCodes.push(parsed.providerStatusCode);
        taskStatusCodes.push(parsed.taskStatusCode);
        for (const row of parsed.rows) {
          rows.push(row);
          answered.add(dataForSeoKeywordKey(row.keyword));
        }
      }
      return {
        rows,
        missingKeywords: normalized.keywords.filter(
          (keyword) => !answered.has(dataForSeoKeywordKey(keyword)),
        ),
        costUsd,
        batchCount: batches.length,
        providerStatusCodes,
        taskStatusCodes,
      };
    },

    async serpOrganic(request, signal) {
      const normalized = normalizeSerpOrganicRequest(request);
      return await liveRequest(
        DATAFORSEO_SERP_ORGANIC_LIVE_URL,
        {
          keyword: normalized.keyword,
          location_code: normalized.locationCode,
          language_code: normalized.languageCode,
          device: "desktop",
          depth: normalized.depth,
          ...(normalized.loadAsyncAiOverview
            ? { load_async_ai_overview: true }
            : {}),
        },
        "serp-organic",
        (payload) =>
          parseSerpOrganicResponse(
            payload,
            normalized.keyword,
            normalized.depth,
          ),
        signal,
      );
    },

    async bulkRanks(request, signal) {
      const targets = normalizeBulkRanksTargets(request);
      const batches = chunk(targets, MAX_DATAFORSEO_BULK_RANKS_BATCH);
      const rows: DataForSeoBulkRankRow[] = [];
      const resolved = new Set<string>();
      const providerStatusCodes: number[] = [];
      const taskStatusCodes: number[] = [];
      let costUsd = 0;
      for (const batch of batches) {
        const parsed = await liveRequest(
          DATAFORSEO_BULK_RANKS_LIVE_URL,
          { targets: batch.map((target) => target.key) },
          "bulk-ranks",
          parseBulkRanksBatch,
          signal,
        );
        costUsd += parsed.costUsd;
        providerStatusCodes.push(parsed.providerStatusCode);
        taskStatusCodes.push(parsed.taskStatusCode);
        for (const row of parsed.rows) {
          rows.push(row);
          resolved.add(row.target);
        }
      }
      return {
        rows,
        unresolvedTargets: targets
          .filter((target) => !resolved.has(target.key))
          .map((target) => target.requested),
        costUsd,
        batchCount: batches.length,
        providerStatusCodes,
        taskStatusCodes,
      };
    },
  };
}
