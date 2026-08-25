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
/** Official Google Labs endpoint for pairwise domain keyword comparison. */
export const DATAFORSEO_DOMAIN_INTERSECTION_LIVE_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/domain_intersection/live";
/** Official Google Labs endpoint for seed-keyword SERP competitor discovery. */
export const DATAFORSEO_SERP_COMPETITORS_LIVE_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/serp_competitors/live";
/** Official AI Optimization endpoint used for citation-host observations. */
export const DATAFORSEO_CHAT_GPT_LLM_RESPONSES_LIVE_URL =
  "https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/live";
/** Official Backlinks API endpoints used by the backlink-growth source. */
export const DATAFORSEO_BACKLINK_SUMMARY_LIVE_URL =
  "https://api.dataforseo.com/v3/backlinks/summary/live";
export const DATAFORSEO_BACKLINKS_LIVE_URL =
  "https://api.dataforseo.com/v3/backlinks/backlinks/live";
export const DATAFORSEO_REFERRING_DOMAINS_LIVE_URL =
  "https://api.dataforseo.com/v3/backlinks/referring_domains/live";
export const DATAFORSEO_DOMAIN_PAGES_LIVE_URL =
  "https://api.dataforseo.com/v3/backlinks/domain_pages/live";

export const DEFAULT_DATAFORSEO_LIMIT = 200;
export const DEFAULT_DATAFORSEO_COMPETITORS_DOMAIN_LIMIT = 100;
export const MAX_DATAFORSEO_LIMIT = 1_000;
/** Provider rank_group ceiling: bounds both the request filter and the parsed ranks. */
const MAX_DOMAIN_INTERSECTION_RANK = 100;
/** Applies to the serialized href, which percent-encoding can inflate well past the raw input. */
const MAX_PROVIDER_URL_CHARS = 2_048;
const MAX_PROVIDER_TITLE_CHARS = 200;
/** core_keyword is a short phrase; the cap only guards against provider drift. */
const MAX_PROVIDER_CORE_KEYWORD_CHARS = 200;
const MAX_PROVIDER_SERP_ITEM_TYPE_CHARS = 64;
const PROVIDER_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\s*([+-])(\d{2}):?(\d{2})|Z)?$/;
const DATAFORSEO_PROVIDER_SEARCH_INTENTS = [
  "informational",
  "navigational",
  "commercial",
  "transactional",
] as const;

export interface DataForSeoBacklinkSummaryRequest {
  readonly target: string;
}

export interface DataForSeoBacklinkListRequest {
  readonly target: string;
  readonly limit: number;
}

interface DataForSeoBacklinksResponseMeta {
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
}

export interface DataForSeoBacklinkSummary {
  readonly target: string;
  readonly firstSeen: string | null;
  readonly lostDate: string | null;
  readonly rank: number;
  readonly backlinks: number;
  readonly referringDomains: number;
  readonly referringMainDomains: number;
}

export interface DataForSeoBacklinkSummaryResponse
  extends DataForSeoBacklinksResponseMeta {
  readonly summary: DataForSeoBacklinkSummary;
}

export interface DataForSeoBacklinkRow {
  readonly sourceDomain: string;
  readonly sourceUrl: string;
  readonly targetDomain: string;
  readonly targetUrl: string;
  readonly isNew: boolean;
  readonly isLost: boolean;
  readonly spamScore: number;
  readonly rank: number;
  readonly pageRank: number;
  readonly domainRank: number;
  readonly sourceStatusCode: number;
  readonly firstSeen: string | null;
  readonly previousSeen: string | null;
  readonly lastSeen: string | null;
  readonly attributes: readonly string[];
  readonly dofollow: boolean;
  readonly anchor: string | null;
  readonly linksCount: number;
  readonly isBroken: boolean;
  readonly targetStatusCode: number | null;
}

export interface DataForSeoBacklinksResponse
  extends DataForSeoBacklinksResponseMeta {
  readonly rows: readonly DataForSeoBacklinkRow[];
  readonly totalCount: number;
  readonly itemsCount: number;
}

export interface DataForSeoReferringDomainRow {
  readonly domain: string;
  readonly rank: number;
  readonly backlinks: number;
  readonly firstSeen: string | null;
  readonly lostDate: string | null;
  readonly spamScore: number;
}

export interface DataForSeoReferringDomainsResponse
  extends DataForSeoBacklinksResponseMeta {
  readonly rows: readonly DataForSeoReferringDomainRow[];
  readonly totalCount: number;
  readonly itemsCount: number;
}

export interface DataForSeoDomainPageRow {
  readonly pageUrl: string;
  readonly title: string | null;
  readonly statusCode: number | null;
  readonly rank: number;
  readonly backlinks: number;
  readonly referringDomains: number;
}

export interface DataForSeoDomainPagesResponse
  extends DataForSeoBacklinksResponseMeta {
  readonly rows: readonly DataForSeoDomainPageRow[];
  readonly totalCount: number;
  readonly itemsCount: number;
}

export interface DataForSeoBacklinksClient {
  backlinkSummary(
    request: DataForSeoBacklinkSummaryRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoBacklinkSummaryResponse>;
  backlinks(
    request: DataForSeoBacklinkListRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoBacklinksResponse>;
  referringDomains(
    request: DataForSeoBacklinkListRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoReferringDomainsResponse>;
  domainPages(
    request: DataForSeoBacklinkListRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoDomainPagesResponse>;
}

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
export type DataForSeoProviderSearchIntent =
  (typeof DATAFORSEO_PROVIDER_SEARCH_INTENTS)[number];

export interface DataForSeoRankedKeywordRow {
  readonly keyword: string;
  readonly searchVolume: number | null;
  readonly keywordDifficulty: number | null;
  readonly providerSearchIntent: DataForSeoProviderSearchIntent | null;
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

/** Credential-free pairwise comparison input for one fixed Labs live task. */
export interface DataForSeoDomainIntersectionRequest {
  readonly target1: string;
  readonly target2: string;
  readonly locationCode?: number;
  readonly locationName?: string;
  readonly languageCode: string;
  readonly intersections: boolean;
  readonly limit: number;
  /**
   * Keep only items where target1's organic element sits at this rank_group or
   * better. Composed into the provider `filters` array here so no free-form
   * filter expression crosses this boundary.
   */
  readonly maxFirstDomainRank?: number;
  /** Ask for the provider's stored SERP snapshot per keyword (no price change: probe 2026-08-25). */
  readonly includeSerpInfo?: boolean;
}

export interface DataForSeoSearchVolumeTrend {
  readonly monthly: number | null;
  readonly quarterly: number | null;
  readonly yearly: number | null;
}

/** Sanitized facts retained from one domain-intersection keyword item. */
export interface DataForSeoDomainIntersectionRow {
  readonly keyword: string;
  readonly searchVolume: number | null;
  readonly cpc: number | null;
  readonly keywordDifficulty: number | null;
  readonly providerIntent: DataForSeoProviderSearchIntent | null;
  readonly firstDomainRank: number | null;
  readonly secondDomainRank: number | null;
  /** target1's ranking page; http(s) only, no userinfo, at most 2048 chars, else null. */
  readonly firstDomainUrl: string | null;
  /** Provider title of that page, trimmed to 200 chars. */
  readonly firstDomainTitle: string | null;
  /** Provider estimated monthly traffic to that page for this keyword. */
  readonly firstDomainEtv: number | null;
  readonly coreKeyword: string | null;
  readonly searchVolumeTrend: DataForSeoSearchVolumeTrend | null;
  /** Stored SERP snapshot element types; null when no snapshot was requested or reported. */
  readonly serpItemTypes: readonly string[] | null;
  /** ISO timestamp of that snapshot; null when absent or unparseable. */
  readonly serpUpdatedAt: string | null;
}

/** Sanitized pairwise result with no provider prose or authentication. */
export interface DataForSeoDomainIntersectionResponse {
  readonly rows: readonly DataForSeoDomainIntersectionRow[];
  readonly totalCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
}

export interface DataForSeoDomainIntersectionClient {
  domainIntersection(
    request: DataForSeoDomainIntersectionRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoDomainIntersectionResponse>;
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

/** One credential-free, server-governed ChatGPT live request. */
export interface DataForSeoAiCitationRequest {
  readonly userPrompt: string;
  readonly modelName: string;
  readonly maxOutputTokens: number;
  readonly webSearch: true;
  readonly webSearchCountryIsoCode: string;
}

/** Sanitized citation evidence; provider answer prose is intentionally absent. */
export type DataForSeoAiCitationResponse = Readonly<{
  readonly availability: "available" | "unavailable";
  readonly requestedModel: string;
  readonly resolvedModel: string | null;
  readonly observedAt: string | null;
  readonly sourceUrls: readonly string[];
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
  readonly limitation: string | null;
}>;

export interface DataForSeoAiCitationClient {
  aiCitation(
    request: DataForSeoAiCitationRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoAiCitationResponse>;
}

/** The two narrow operations required by the composite landscape adapter. */
export type DataForSeoSearchLandscapeClient = DataForSeoRankedKeywordsClient &
  DataForSeoCompetitorsDomainClient;

export type DataForSeoSearchLandscapeV2Client =
  DataForSeoSearchLandscapeClient & DataForSeoSerpCompetitorsClient;

export type DataForSeoSearchLandscapeV3Client =
  DataForSeoSearchLandscapeV2Client & DataForSeoAiCitationClient;

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

/**
 * A provider URL the surface may link to, or null. Drops rather than throws on
 * unsafe shapes. The length bound is enforced on the serialized href because
 * WHATWG parsing percent-encodes non-ASCII paths and can multiply the length.
 */
function nullableSafeHttpUrl(value: unknown, context: string): string | null {
  const raw = nullableString(value, context);
  if (raw === null) return null;
  try {
    const url = new URL(raw.trim());
    const safeScheme = url.protocol === "http:" || url.protocol === "https:";
    const noUserinfo = url.username === "" && url.password === "";
    return safeScheme && noUserinfo && url.href.length <= MAX_PROVIDER_URL_CHARS
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Whitespace-collapsed provider text cut to maxChars; blank text is null. */
function nullableBoundedText(
  value: unknown,
  maxChars: number,
  context: string,
): string | null {
  const raw = nullableString(value, context);
  if (raw === null) return null;
  const flat = raw.replace(/\s+/g, " ").trim();
  if (flat === "") return null;
  return flat.length > maxChars ? flat.slice(0, maxChars).trim() : flat;
}

/**
 * Provider timestamps arrive as "YYYY-MM-DD HH:MM:SS +00:00". A missing zone is
 * read as UTC because the provider only emits UTC. Fractional seconds, fields
 * that do not name a real instant (Feb 30, hour 24, offset +99:00), and any
 * other format drift are silence (null), never a row failure.
 */
function nullableProviderTimestamp(
  value: unknown,
  context: string,
): string | null {
  const raw = nullableString(value, context);
  if (raw === null) return null;
  const match = PROVIDER_TIMESTAMP_RE.exec(raw.trim());
  if (match === null) return null;
  const fields = match.slice(1, 7).map(Number);
  const utcMillis = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  if (!calendarFieldsRoundTrip(utcMillis, fields)) return null;
  const offsetMinutes = providerOffsetMinutes(match[7], match[8], match[9]);
  if (offsetMinutes === null) return null;
  return new Date(utcMillis - offsetMinutes * 60_000).toISOString();
}

/** JS Date rolls impossible fields over (Feb 30 -> Mar 2); reject anything that did not survive intact. */
function calendarFieldsRoundTrip(
  utcMillis: number,
  fields: readonly number[],
): boolean {
  if (!Number.isFinite(utcMillis)) return false;
  const date = new Date(utcMillis);
  const actual = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ];
  return actual.every((part, index) => part === fields[index]);
}

/** Signed zone offset in minutes; absent means UTC; an impossible offset is null. */
function providerOffsetMinutes(
  sign: string | undefined,
  hours: string | undefined,
  minutes: string | undefined,
): number | null {
  if (sign === undefined) return 0;
  const offsetHours = Number(hours);
  const offsetMinutes = Number(minutes);
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  return (sign === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
}

function nullableNumberOrNull(value: unknown, context: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a finite number.`,
    );
  }
  return value;
}

function nullableSearchVolumeTrend(
  value: unknown,
  context: string,
): DataForSeoSearchVolumeTrend | null {
  if (value === undefined || value === null) return null;
  const trend = asRecord(value, context);
  return {
    monthly: nullableNumberOrNull(trend.monthly, `${context}.monthly`),
    quarterly: nullableNumberOrNull(trend.quarterly, `${context}.quarterly`),
    yearly: nullableNumberOrNull(trend.yearly, `${context}.yearly`),
  };
}

function nullableStringList(
  value: unknown,
  context: string,
): readonly string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new SourceError("INVALID_RESPONSE", `${context} was not an array.`);
  }
  // A list with any malformed entry is silence, not a shorter list: dropping the
  // junk would let a junk-only array read downstream as a reported empty
  // snapshot, which is a claim the provider never made.
  if (
    value.some((entry) => typeof entry !== "string" || entry.trim() === "")
  ) {
    return null;
  }
  return value.map((entry: string) =>
    entry.trim().slice(0, MAX_PROVIDER_SERP_ITEM_TYPE_CHARS),
  );
}

function optionalRecord(value: unknown, context: string): JsonRecord | null {
  if (value === undefined || value === null) return null;
  return asRecord(value, context);
}

function nullableIntegerInRange(
  value: unknown,
  min: number,
  max: number,
  context: string,
): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain an integer from ${min} to ${max}.`,
    );
  }
  const parsed = value as number;
  if (parsed < min || parsed > max) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain an integer from ${min} to ${max}.`,
    );
  }
  return parsed;
}

function nullableProviderSearchIntent(
  value: unknown,
  context: string,
): DataForSeoProviderSearchIntent | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    !DATAFORSEO_PROVIDER_SEARCH_INTENTS.includes(
      value as DataForSeoProviderSearchIntent,
    )
  ) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a supported provider search intent.`,
    );
  }
  return value as DataForSeoProviderSearchIntent;
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
  operation:
    | "ranked-keywords"
    | "competitors-domain"
    | "domain-intersection"
    | "serp-competitors"
    | "ai-citation"
    | "backlink-summary"
    | "backlinks"
    | "referring-domains"
    | "domain-pages",
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

function normalizeDomainIntersectionRequest(
  value: DataForSeoDomainIntersectionRequest,
): DataForSeoDomainIntersectionRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO domain-intersection request must be an object.",
    );
  }

  let target1: string;
  let target2: string;
  try {
    target1 = canonicalProviderDomain(
      value.target1,
      "DataForSEO domain-intersection target1",
    );
    target2 = canonicalProviderDomain(
      value.target2,
      "DataForSEO domain-intersection target2",
    );
  } catch {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO domain-intersection targets must be valid public hostnames.",
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
      "DataForSEO domain-intersection request must contain exactly one location selector.",
    );
  }
  if (
    locationCode !== undefined &&
    (!Number.isSafeInteger(locationCode) || locationCode <= 0)
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO domain-intersection locationCode must be a positive integer.",
    );
  }
  if (
    locationName !== undefined &&
    (typeof locationName !== "string" || locationName.trim() === "")
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO domain-intersection locationName must be a non-empty string.",
    );
  }
  if (
    typeof value.languageCode !== "string" ||
    !/^[A-Za-z]{2,3}$/.test(value.languageCode.trim())
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO domain-intersection languageCode must be a primary language code.",
    );
  }
  if (typeof value.intersections !== "boolean") {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO domain-intersection intersections must be a boolean.",
    );
  }
  if (
    !Number.isSafeInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > MAX_DATAFORSEO_LIMIT
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `DataForSEO domain-intersection limit must be an integer from 1 to ${MAX_DATAFORSEO_LIMIT}.`,
    );
  }
  if (
    value.maxFirstDomainRank !== undefined &&
    (!Number.isSafeInteger(value.maxFirstDomainRank) ||
      value.maxFirstDomainRank < 1 ||
      value.maxFirstDomainRank > MAX_DOMAIN_INTERSECTION_RANK)
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `DataForSEO domain-intersection maxFirstDomainRank must be an integer from 1 to ${MAX_DOMAIN_INTERSECTION_RANK}.`,
    );
  }
  if (
    value.includeSerpInfo !== undefined &&
    typeof value.includeSerpInfo !== "boolean"
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO domain-intersection includeSerpInfo must be a boolean.",
    );
  }

  const common = {
    target1,
    target2,
    languageCode: value.languageCode.trim().toLowerCase(),
    intersections: value.intersections,
    limit: value.limit,
    ...(value.maxFirstDomainRank === undefined
      ? {}
      : { maxFirstDomainRank: value.maxFirstDomainRank }),
    includeSerpInfo: value.includeSerpInfo ?? false,
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
  const keywordProperties =
    keywordData.keyword_properties === undefined ||
    keywordData.keyword_properties === null
      ? null
      : asRecord(
          keywordData.keyword_properties,
          `DataForSEO item ${index}.keyword_properties`,
        );
  const searchIntentInfo =
    keywordData.search_intent_info === undefined ||
    keywordData.search_intent_info === null
      ? null
      : asRecord(
          keywordData.search_intent_info,
          `DataForSEO item ${index}.search_intent_info`,
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
    keywordDifficulty: nullableIntegerInRange(
      keywordProperties?.keyword_difficulty,
      0,
      100,
      `DataForSEO item ${index}.keyword_difficulty`,
    ),
    providerSearchIntent: nullableProviderSearchIntent(
      searchIntentInfo?.main_intent,
      `DataForSEO item ${index}.main_intent`,
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

function domainIntersectionRank(
  element: JsonRecord | null,
  context: string,
): number | null {
  if (element === null) return null;
  const rank = nullableIntegerInRange(
    element.rank_group,
    1,
    MAX_DOMAIN_INTERSECTION_RANK,
    `${context}.rank_group`,
  );
  if (rank === null) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a rank_group.`,
    );
  }
  return rank;
}

/** The paid-for facts about target1's ranking page; all null when the element is absent. */
function parseFirstDomainPageFacts(
  element: JsonRecord | null,
  context: string,
): Pick<
  DataForSeoDomainIntersectionRow,
  "firstDomainUrl" | "firstDomainTitle" | "firstDomainEtv"
> {
  if (element === null) {
    return { firstDomainUrl: null, firstDomainTitle: null, firstDomainEtv: null };
  }
  return {
    firstDomainUrl: nullableSafeHttpUrl(element.url, `${context}.url`),
    firstDomainTitle: nullableBoundedText(
      element.title,
      MAX_PROVIDER_TITLE_CHARS,
      `${context}.title`,
    ),
    firstDomainEtv: nullableNonNegativeNumber(element.etv, `${context}.etv`),
  };
}

/** The stored SERP snapshot; all null when none was requested or reported. */
function parseSerpSnapshot(
  serpInfo: JsonRecord | null,
  context: string,
): Pick<DataForSeoDomainIntersectionRow, "serpItemTypes" | "serpUpdatedAt"> {
  if (serpInfo === null) return { serpItemTypes: null, serpUpdatedAt: null };
  return {
    serpItemTypes: nullableStringList(
      serpInfo.serp_item_types,
      `${context}.serp_item_types`,
    ),
    serpUpdatedAt: nullableProviderTimestamp(
      serpInfo.last_updated_time,
      `${context}.last_updated_time`,
    ),
  };
}

/** The keyword and its provider metrics carried by keyword_data. */
function parseDomainIntersectionKeywordFacts(
  keywordData: JsonRecord,
  context: string,
): Pick<
  DataForSeoDomainIntersectionRow,
  | "keyword"
  | "searchVolume"
  | "cpc"
  | "keywordDifficulty"
  | "providerIntent"
  | "coreKeyword"
  | "searchVolumeTrend"
> {
  const keyword = keywordData.keyword;
  if (typeof keyword !== "string" || keyword.trim() === "") {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a keyword.`,
    );
  }
  const keywordInfo = optionalRecord(
    keywordData.keyword_info,
    `${context}.keyword_info`,
  );
  const keywordProperties = optionalRecord(
    keywordData.keyword_properties,
    `${context}.keyword_properties`,
  );
  const searchIntentInfo = optionalRecord(
    keywordData.search_intent_info,
    `${context}.search_intent_info`,
  );
  return {
    keyword: keyword.trim(),
    searchVolume: nullableNonNegativeNumber(
      keywordInfo?.search_volume,
      `${context}.search_volume`,
    ),
    cpc: nullableNonNegativeNumber(keywordInfo?.cpc, `${context}.cpc`),
    keywordDifficulty: nullableIntegerInRange(
      keywordProperties?.keyword_difficulty,
      0,
      100,
      `${context}.keyword_difficulty`,
    ),
    providerIntent: nullableProviderSearchIntent(
      searchIntentInfo?.main_intent,
      `${context}.main_intent`,
    ),
    coreKeyword: nullableBoundedText(
      keywordProperties?.core_keyword,
      MAX_PROVIDER_CORE_KEYWORD_CHARS,
      `${context}.core_keyword`,
    ),
    searchVolumeTrend: nullableSearchVolumeTrend(
      keywordInfo?.search_volume_trend,
      `${context}.search_volume_trend`,
    ),
  };
}

function parseDomainIntersectionRow(
  value: unknown,
  index: number,
): DataForSeoDomainIntersectionRow {
  const ctx = `DataForSEO domain-intersection item ${index}`;
  const item = asRecord(value, ctx);
  const keywordData = asRecord(item.keyword_data, `${ctx}.keyword_data`);
  const firstElement = optionalRecord(
    item.first_domain_serp_element,
    `${ctx}.first_domain_serp_element`,
  );
  const secondElement = optionalRecord(
    item.second_domain_serp_element,
    `${ctx}.second_domain_serp_element`,
  );
  const serpInfo = optionalRecord(keywordData.serp_info, `${ctx}.serp_info`);

  return {
    ...parseDomainIntersectionKeywordFacts(keywordData, ctx),
    firstDomainRank: domainIntersectionRank(
      firstElement,
      `${ctx}.first_domain_serp_element`,
    ),
    secondDomainRank: domainIntersectionRank(
      secondElement,
      `${ctx}.second_domain_serp_element`,
    ),
    ...parseFirstDomainPageFacts(
      firstElement,
      `${ctx}.first_domain_serp_element`,
    ),
    ...parseSerpSnapshot(serpInfo, `${ctx}.serp_info`),
  };
}

function emptyDomainIntersectionResponse(
  providerStatusCode: number,
  taskStatusCode: number,
  costUsd: number,
): DataForSeoDomainIntersectionResponse {
  return {
    rows: [],
    totalCount: 0,
    costUsd,
    providerStatusCode,
    taskStatusCode,
  };
}

function parseDomainIntersectionResponse(
  payload: unknown,
): DataForSeoDomainIntersectionResponse {
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
    return emptyDomainIntersectionResponse(
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
    return emptyDomainIntersectionResponse(
      providerStatusCode,
      taskStatusCode,
      taskCost,
    );
  }

  if (task.result === null || task.result === undefined) {
    if (task.result_count === 0) {
      return emptyDomainIntersectionResponse(
        providerStatusCode,
        taskStatusCode,
        taskCost,
      );
    }
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO task omitted its domain-intersection result.",
    );
  }
  if (!Array.isArray(task.result)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO domain-intersection task result was not an array.",
    );
  }
  const resultCount =
    task.result_count === null || task.result_count === undefined
      ? undefined
      : asNonNegativeInteger(
          task.result_count,
          "DataForSEO domain-intersection task result_count",
        );
  if (resultCount !== undefined && resultCount !== task.result.length) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO domain-intersection task result_count did not match the returned results.",
    );
  }
  if (task.result.length === 0) {
    return emptyDomainIntersectionResponse(
      providerStatusCode,
      taskStatusCode,
      taskCost,
    );
  }
  if (task.result.length !== 1) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO domain-intersection task did not contain exactly one result.",
    );
  }

  const result = asRecord(
    task.result[0],
    "DataForSEO domain-intersection result",
  );
  const rawItems = result.items;
  if (rawItems !== null && rawItems !== undefined && !Array.isArray(rawItems)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO domain-intersection result items was not an array.",
    );
  }
  const rows = (rawItems ?? []).map(parseDomainIntersectionRow);
  const itemsCount =
    result.items_count === null || result.items_count === undefined
      ? rows.length
      : asNonNegativeInteger(
          result.items_count,
          "DataForSEO domain-intersection result items_count",
        );
  if (itemsCount !== rows.length) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO domain-intersection result items_count did not match the returned items.",
    );
  }
  const totalCount =
    result.total_count === null || result.total_count === undefined
      ? itemsCount === 0
        ? 0
        : asNonNegativeInteger(
            result.total_count,
            "DataForSEO domain-intersection result total_count",
          )
      : asNonNegativeInteger(
          result.total_count,
          "DataForSEO domain-intersection result total_count",
        );
  if (totalCount < rows.length) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO domain-intersection result total_count was smaller than the returned items.",
    );
  }

  return {
    rows,
    totalCount,
    costUsd: taskCost,
    providerStatusCode,
    taskStatusCode,
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

function normalizeAiCitationRequest(
  value: DataForSeoAiCitationRequest,
): DataForSeoAiCitationRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO AI-citation request must be an object.",
    );
  }
  const userPrompt =
    typeof value.userPrompt === "string"
      ? value.userPrompt.normalize("NFKC").trim()
      : null;
  const modelName =
    typeof value.modelName === "string" ? value.modelName.trim() : null;
  const country =
    typeof value.webSearchCountryIsoCode === "string"
      ? value.webSearchCountryIsoCode.trim().toUpperCase()
      : null;
  if (
    userPrompt === null ||
    userPrompt.length < 1 ||
    userPrompt.length > 500
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO AI-citation userPrompt must contain 1 to 500 characters.",
    );
  }
  if (
    modelName === null ||
    modelName.length < 1 ||
    modelName.length > 100
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO AI-citation modelName must contain 1 to 100 characters.",
    );
  }
  if (
    !Number.isSafeInteger(value.maxOutputTokens) ||
    value.maxOutputTokens < 16 ||
    value.maxOutputTokens > 4_096
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO AI-citation maxOutputTokens must be an integer from 16 to 4096.",
    );
  }
  if (value.webSearch !== true || country === null || !/^[A-Z]{2}$/.test(country)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO AI citations require web search and a two-letter country code.",
    );
  }
  return {
    userPrompt,
    modelName,
    maxOutputTokens: value.maxOutputTokens,
    webSearch: true,
    webSearchCountryIsoCode: country,
  };
}

function toAiCitationProviderTask(
  request: DataForSeoAiCitationRequest,
): JsonRecord {
  const normalized = normalizeAiCitationRequest(request);
  return {
    user_prompt: normalized.userPrompt,
    model_name: normalized.modelName,
    max_output_tokens: normalized.maxOutputTokens,
    web_search: true,
    web_search_country_iso_code: normalized.webSearchCountryIsoCode,
  };
}

function unavailableAiCitationResponse(
  requestedModel: string,
  providerStatusCode: number,
  taskStatusCode: number,
  costUsd: number,
  limitation = "The provider returned no observable answer.",
): DataForSeoAiCitationResponse {
  return {
    availability: "unavailable",
    requestedModel,
    resolvedModel: null,
    observedAt: null,
    sourceUrls: [],
    costUsd,
    providerStatusCode,
    taskStatusCode,
    limitation,
  };
}

function canonicalObservedAt(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO AI-citation result omitted its observation time.",
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO AI-citation result contained an invalid observation time.",
    );
  }
  return parsed.toISOString();
}

function annotationSourceUrls(value: JsonRecord): readonly string[] {
  const rawItems = value.items;
  if (rawItems === null || rawItems === undefined) return [];
  if (!Array.isArray(rawItems)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO AI-citation result items was not an array.",
    );
  }
  const urls = new Set<string>();
  for (const [itemIndex, rawItem] of rawItems.entries()) {
    const item = asRecord(
      rawItem,
      `DataForSEO AI-citation item ${itemIndex}`,
    );
    const rawSections = item.sections;
    if (rawSections === null || rawSections === undefined) continue;
    if (!Array.isArray(rawSections)) {
      throw new SourceError(
        "INVALID_RESPONSE",
        `DataForSEO AI-citation item ${itemIndex} sections was not an array.`,
      );
    }
    for (const [sectionIndex, rawSection] of rawSections.entries()) {
      const section = asRecord(
        rawSection,
        `DataForSEO AI-citation item ${itemIndex} section ${sectionIndex}`,
      );
      const rawAnnotations = section.annotations;
      if (rawAnnotations === null || rawAnnotations === undefined) continue;
      if (!Array.isArray(rawAnnotations)) {
        throw new SourceError(
          "INVALID_RESPONSE",
          `DataForSEO AI-citation item ${itemIndex} section ${sectionIndex} annotations was not an array.`,
        );
      }
      for (const [annotationIndex, rawAnnotation] of rawAnnotations.entries()) {
        const annotation = asRecord(
          rawAnnotation,
          `DataForSEO AI-citation annotation ${annotationIndex}`,
        );
        if (
          annotation.type !== undefined &&
          annotation.type !== "url_citation"
        ) {
          continue;
        }
        if (typeof annotation.url !== "string") {
          throw new SourceError(
            "INVALID_RESPONSE",
            "DataForSEO AI-citation URL annotation omitted its URL.",
          );
        }
        let url: URL;
        try {
          url = new URL(annotation.url);
        } catch {
          throw new SourceError(
            "INVALID_RESPONSE",
            "DataForSEO AI-citation URL annotation was invalid.",
          );
        }
        if (
          (url.protocol !== "http:" && url.protocol !== "https:") ||
          url.username !== "" ||
          url.password !== ""
        ) {
          throw new SourceError(
            "INVALID_RESPONSE",
            "DataForSEO AI-citation URL annotation was not a public web URL.",
          );
        }
        urls.add(url.href);
      }
    }
  }
  return [...urls].sort((left, right) => left.localeCompare(right, "en"));
}

function parseAiCitationResponse(
  payload: unknown,
  requestedModel: string,
): DataForSeoAiCitationResponse {
  const envelope = asRecord(payload, "DataForSEO response");
  const providerStatusCode = asStatusCode(
    envelope.status_code,
    "DataForSEO response",
  );
  if (
    providerStatusCode !== SUCCESS_STATUS &&
    providerStatusCode !== EMPTY_RESULT_STATUS &&
    !RETRYABLE_RATE_LIMIT_STATUSES.has(providerStatusCode)
  ) {
    throwProviderStatus(providerStatusCode, "request");
  }
  const envelopeCost =
    RETRYABLE_RATE_LIMIT_STATUSES.has(providerStatusCode) &&
    (envelope.cost === null || envelope.cost === undefined)
      ? 0
      : asNonNegativeNumber(envelope.cost, "DataForSEO response cost");
  if (RETRYABLE_RATE_LIMIT_STATUSES.has(providerStatusCode)) {
    return unavailableAiCitationResponse(
      requestedModel,
      providerStatusCode,
      providerStatusCode,
      envelopeCost,
      "The provider rate limit made this query unavailable.",
    );
  }
  if (providerStatusCode === EMPTY_RESULT_STATUS) {
    return unavailableAiCitationResponse(
      requestedModel,
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
  if (RETRYABLE_RATE_LIMIT_STATUSES.has(taskStatusCode)) {
    const rateLimitedCost =
      task.cost === null || task.cost === undefined
        ? 0
        : asNonNegativeNumber(task.cost, "DataForSEO task cost");
    return unavailableAiCitationResponse(
      requestedModel,
      providerStatusCode,
      taskStatusCode,
      rateLimitedCost,
      "The provider rate limit made this query unavailable.",
    );
  }
  if (
    taskStatusCode !== SUCCESS_STATUS &&
    taskStatusCode !== EMPTY_RESULT_STATUS
  ) {
    throwProviderStatus(taskStatusCode, "task");
  }
  const costUsd = asNonNegativeNumber(task.cost, "DataForSEO task cost");
  if (taskStatusCode === EMPTY_RESULT_STATUS) {
    return unavailableAiCitationResponse(
      requestedModel,
      providerStatusCode,
      taskStatusCode,
      costUsd,
    );
  }
  if (task.result === null || task.result === undefined) {
    if (task.result_count === 0) {
      return unavailableAiCitationResponse(
        requestedModel,
        providerStatusCode,
        EMPTY_RESULT_STATUS,
        costUsd,
      );
    }
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO task omitted its AI-citation result.",
    );
  }
  if (!Array.isArray(task.result) || task.result.length !== 1) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO AI-citation task did not contain exactly one result.",
    );
  }
  if (
    task.result_count !== null &&
    task.result_count !== undefined &&
    asNonNegativeInteger(
      task.result_count,
      "DataForSEO AI-citation task result_count",
    ) !== 1
  ) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO AI-citation task result_count was contradictory.",
    );
  }
  const result = asRecord(task.result[0], "DataForSEO AI-citation result");
  const resolvedModel = nullableString(
    result.model_name,
    "DataForSEO AI-citation result model_name",
  );
  if (resolvedModel === null) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO AI-citation result omitted its resolved model.",
    );
  }
  return {
    availability: "available",
    requestedModel,
    resolvedModel,
    observedAt: canonicalObservedAt(result.datetime),
    sourceUrls: annotationSourceUrls(result),
    costUsd,
    providerStatusCode,
    taskStatusCode,
    limitation: null,
  };
}

interface ParsedBacklinksTask {
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
  readonly costUsd: number;
  readonly results: readonly unknown[];
}

function parseBacklinksTask(
  payload: unknown,
  label: string,
): ParsedBacklinksTask {
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
    return {
      providerStatusCode,
      taskStatusCode: EMPTY_RESULT_STATUS,
      costUsd: envelopeCost,
      results: [],
    };
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
  const costUsd = asNonNegativeNumber(task.cost, "DataForSEO task cost");
  if (taskStatusCode === EMPTY_RESULT_STATUS) {
    return { providerStatusCode, taskStatusCode, costUsd, results: [] };
  }
  if (task.result === null || task.result === undefined) {
    if (task.result_count === 0) {
      return { providerStatusCode, taskStatusCode, costUsd, results: [] };
    }
    throw new SourceError(
      "INVALID_RESPONSE",
      `DataForSEO task omitted its ${label} result.`,
    );
  }
  if (!Array.isArray(task.result)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `DataForSEO ${label} task result was not an array.`,
    );
  }
  const resultCount =
    task.result_count === null || task.result_count === undefined
      ? task.result.length
      : asNonNegativeInteger(
          task.result_count,
          `DataForSEO ${label} task result_count`,
        );
  if (resultCount !== task.result.length) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `DataForSEO ${label} task result_count did not match its results.`,
    );
  }
  return {
    providerStatusCode,
    taskStatusCode,
    costUsd,
    results: task.result,
  };
}

function requiredString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a non-empty string.`,
    );
  }
  return value.trim();
}

function requiredBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a boolean.`,
    );
  }
  return value;
}

function nullableNonNegativeInteger(
  value: unknown,
  context: string,
): number | null {
  if (value === undefined || value === null) return null;
  return asNonNegativeInteger(value, context);
}

function stringArray(value: unknown, context: string): readonly string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `${context} did not contain a string array.`,
    );
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function emptyBacklinkSummary(
  target: string,
  task: ParsedBacklinksTask,
): DataForSeoBacklinkSummaryResponse {
  return {
    summary: {
      target,
      firstSeen: null,
      lostDate: null,
      rank: 0,
      backlinks: 0,
      referringDomains: 0,
      referringMainDomains: 0,
    },
    costUsd: task.costUsd,
    providerStatusCode: task.providerStatusCode,
    taskStatusCode: task.taskStatusCode,
  };
}

function parseBacklinkSummaryResponse(
  payload: unknown,
  target: string,
): DataForSeoBacklinkSummaryResponse {
  const task = parseBacklinksTask(payload, "backlink-summary");
  if (task.results.length === 0) return emptyBacklinkSummary(target, task);
  if (task.results.length !== 1) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "DataForSEO backlink-summary task did not contain exactly one result.",
    );
  }
  const result = asRecord(task.results[0], "DataForSEO backlink-summary result");
  return {
    summary: {
      target: canonicalProviderDomain(
        result.target,
        "DataForSEO backlink-summary target",
      ),
      firstSeen: nullableString(
        result.first_seen,
        "DataForSEO backlink-summary first_seen",
      ),
      lostDate: nullableString(
        result.lost_date,
        "DataForSEO backlink-summary lost_date",
      ),
      rank: asNonNegativeNumber(
        result.rank,
        "DataForSEO backlink-summary rank",
      ),
      backlinks: asNonNegativeInteger(
        result.backlinks,
        "DataForSEO backlink-summary backlinks",
      ),
      referringDomains: asNonNegativeInteger(
        result.referring_domains,
        "DataForSEO backlink-summary referring_domains",
      ),
      referringMainDomains: asNonNegativeInteger(
        result.referring_main_domains,
        "DataForSEO backlink-summary referring_main_domains",
      ),
    },
    costUsd: task.costUsd,
    providerStatusCode: task.providerStatusCode,
    taskStatusCode: task.taskStatusCode,
  };
}

function parseBacklinkRow(value: unknown, index: number): DataForSeoBacklinkRow {
  const item = asRecord(value, `DataForSEO backlink item ${index}`);
  return {
    sourceDomain: canonicalProviderDomain(
      item.domain_from,
      `DataForSEO backlink item ${index}.domain_from`,
    ),
    sourceUrl: requiredString(
      item.url_from,
      `DataForSEO backlink item ${index}.url_from`,
    ),
    targetDomain: canonicalProviderDomain(
      item.domain_to,
      `DataForSEO backlink item ${index}.domain_to`,
    ),
    targetUrl: requiredString(
      item.url_to,
      `DataForSEO backlink item ${index}.url_to`,
    ),
    isNew: requiredBoolean(
      item.is_new,
      `DataForSEO backlink item ${index}.is_new`,
    ),
    isLost: requiredBoolean(
      item.is_lost,
      `DataForSEO backlink item ${index}.is_lost`,
    ),
    spamScore: asNonNegativeNumber(
      item.backlink_spam_score,
      `DataForSEO backlink item ${index}.backlink_spam_score`,
    ),
    rank: asNonNegativeNumber(
      item.rank,
      `DataForSEO backlink item ${index}.rank`,
    ),
    pageRank: asNonNegativeNumber(
      item.page_from_rank,
      `DataForSEO backlink item ${index}.page_from_rank`,
    ),
    domainRank: asNonNegativeNumber(
      item.domain_from_rank,
      `DataForSEO backlink item ${index}.domain_from_rank`,
    ),
    sourceStatusCode: asNonNegativeInteger(
      item.page_from_status_code,
      `DataForSEO backlink item ${index}.page_from_status_code`,
    ),
    firstSeen: nullableString(
      item.first_seen,
      `DataForSEO backlink item ${index}.first_seen`,
    ),
    previousSeen: nullableString(
      item.prev_seen,
      `DataForSEO backlink item ${index}.prev_seen`,
    ),
    lastSeen: nullableString(
      item.last_seen,
      `DataForSEO backlink item ${index}.last_seen`,
    ),
    attributes: stringArray(
      item.attributes,
      `DataForSEO backlink item ${index}.attributes`,
    ),
    dofollow: requiredBoolean(
      item.dofollow,
      `DataForSEO backlink item ${index}.dofollow`,
    ),
    anchor: nullableString(
      item.anchor,
      `DataForSEO backlink item ${index}.anchor`,
    ),
    linksCount: asNonNegativeInteger(
      item.links_count,
      `DataForSEO backlink item ${index}.links_count`,
    ),
    isBroken: requiredBoolean(
      item.is_broken,
      `DataForSEO backlink item ${index}.is_broken`,
    ),
    targetStatusCode: nullableNonNegativeInteger(
      item.url_to_status_code,
      `DataForSEO backlink item ${index}.url_to_status_code`,
    ),
  };
}

function parseReferringDomainRow(
  value: unknown,
  index: number,
): DataForSeoReferringDomainRow {
  const item = asRecord(value, `DataForSEO referring-domain item ${index}`);
  return {
    domain: canonicalProviderDomain(
      item.domain,
      `DataForSEO referring-domain item ${index}.domain`,
    ),
    rank: asNonNegativeNumber(
      item.rank,
      `DataForSEO referring-domain item ${index}.rank`,
    ),
    backlinks: asNonNegativeInteger(
      item.backlinks,
      `DataForSEO referring-domain item ${index}.backlinks`,
    ),
    firstSeen: nullableString(
      item.first_seen,
      `DataForSEO referring-domain item ${index}.first_seen`,
    ),
    lostDate: nullableString(
      item.lost_date,
      `DataForSEO referring-domain item ${index}.lost_date`,
    ),
    spamScore: asNonNegativeNumber(
      item.backlinks_spam_score,
      `DataForSEO referring-domain item ${index}.backlinks_spam_score`,
    ),
  };
}

function parseDomainPageRow(
  value: unknown,
  index: number,
): DataForSeoDomainPageRow {
  const item = asRecord(value, `DataForSEO domain-page item ${index}`);
  const meta = asRecord(
    item.meta,
    `DataForSEO domain-page item ${index}.meta`,
  );
  const summary = asRecord(
    item.page_summary,
    `DataForSEO domain-page item ${index}.page_summary`,
  );
  return {
    pageUrl: requiredString(
      item.page,
      `DataForSEO domain-page item ${index}.page`,
    ),
    title: nullableString(
      meta.title,
      `DataForSEO domain-page item ${index}.meta.title`,
    ),
    statusCode: nullableNonNegativeInteger(
      item.status_code,
      `DataForSEO domain-page item ${index}.status_code`,
    ),
    rank: asNonNegativeNumber(
      summary.rank,
      `DataForSEO domain-page item ${index}.page_summary.rank`,
    ),
    backlinks: asNonNegativeInteger(
      summary.backlinks,
      `DataForSEO domain-page item ${index}.page_summary.backlinks`,
    ),
    referringDomains: asNonNegativeInteger(
      summary.referring_domains,
      `DataForSEO domain-page item ${index}.page_summary.referring_domains`,
    ),
  };
}

function parseBacklinksListResult<Row>(
  payload: unknown,
  label: string,
  parseRowValue: (value: unknown, index: number) => Row,
): {
  readonly rows: readonly Row[];
  readonly totalCount: number;
  readonly itemsCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
} {
  const task = parseBacklinksTask(payload, label);
  if (task.results.length === 0) {
    return {
      rows: [],
      totalCount: 0,
      itemsCount: 0,
      costUsd: task.costUsd,
      providerStatusCode: task.providerStatusCode,
      taskStatusCode: task.taskStatusCode,
    };
  }
  if (task.results.length !== 1) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `DataForSEO ${label} task did not contain exactly one result.`,
    );
  }
  const result = asRecord(task.results[0], `DataForSEO ${label} result`);
  const rawItems = result.items;
  if (rawItems !== null && rawItems !== undefined && !Array.isArray(rawItems)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `DataForSEO ${label} result items was not an array.`,
    );
  }
  const rows = (rawItems ?? []).map(parseRowValue);
  const itemsCount =
    result.items_count === null || result.items_count === undefined
      ? rows.length
      : asNonNegativeInteger(
          result.items_count,
          `DataForSEO ${label} result items_count`,
        );
  const totalCount =
    result.total_count === null || result.total_count === undefined
      ? rows.length === 0
        ? 0
        : asNonNegativeInteger(
            result.total_count,
            `DataForSEO ${label} result total_count`,
          )
      : asNonNegativeInteger(
          result.total_count,
          `DataForSEO ${label} result total_count`,
        );
  if (itemsCount !== rows.length || totalCount < rows.length) {
    throw new SourceError(
      "INVALID_RESPONSE",
      `DataForSEO ${label} result contained contradictory row counts.`,
    );
  }
  return {
    rows,
    totalCount,
    itemsCount,
    costUsd: task.costUsd,
    providerStatusCode: task.providerStatusCode,
    taskStatusCode: task.taskStatusCode,
  };
}

function normalizeBacklinksTarget(value: unknown, label: string): string {
  try {
    return canonicalProviderDomain(value, label);
  } catch {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} must be a valid public hostname.`,
    );
  }
}

function normalizeBacklinkListRequest(
  value: DataForSeoBacklinkListRequest,
  label: string,
): DataForSeoBacklinkListRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} request must be an object.`,
    );
  }
  if (
    !Number.isSafeInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > MAX_DATAFORSEO_LIMIT
  ) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `${label} limit must be an integer from 1 to ${MAX_DATAFORSEO_LIMIT}.`,
    );
  }
  return {
    target: normalizeBacklinksTarget(value.target, `${label} target`),
    limit: value.limit,
  };
}

function backlinksCommonTask(target: string): JsonRecord {
  return {
    target,
    include_subdomains: true,
    exclude_internal_backlinks: true,
    backlinks_status_type: "live",
    rank_scale: "one_hundred",
  };
}

function toBacklinkSummaryProviderTask(
  request: DataForSeoBacklinkSummaryRequest,
): JsonRecord {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      "DataForSEO backlink-summary request must be an object.",
    );
  }
  const target = normalizeBacklinksTarget(
    request.target,
    "DataForSEO backlink-summary target",
  );
  return {
    ...backlinksCommonTask(target),
    include_indirect_links: true,
  };
}

function toBacklinksProviderTask(
  request: DataForSeoBacklinkListRequest,
): JsonRecord {
  const normalized = normalizeBacklinkListRequest(
    request,
    "DataForSEO backlinks",
  );
  return {
    target: normalized.target,
    mode: "as_is",
    limit: normalized.limit,
    include_subdomains: true,
    exclude_internal_backlinks: true,
    backlinks_status_type: "live",
    rank_scale: "one_hundred",
  };
}

function toReferringDomainsProviderTask(
  request: DataForSeoBacklinkListRequest,
): JsonRecord {
  const normalized = normalizeBacklinkListRequest(
    request,
    "DataForSEO referring-domains",
  );
  return {
    ...backlinksCommonTask(normalized.target),
    limit: normalized.limit,
    offset: 0,
    include_indirect_links: true,
  };
}

function toDomainPagesProviderTask(
  request: DataForSeoBacklinkListRequest,
): JsonRecord {
  const normalized = normalizeBacklinkListRequest(
    request,
    "DataForSEO domain-pages",
  );
  return {
    ...backlinksCommonTask(normalized.target),
    limit: normalized.limit,
    offset: 0,
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

function toDomainIntersectionProviderTask(
  request: DataForSeoDomainIntersectionRequest,
): JsonRecord {
  const normalized = normalizeDomainIntersectionRequest(request);
  return {
    target1: normalized.target1,
    target2: normalized.target2,
    ...(normalized.locationCode !== undefined
      ? { location_code: normalized.locationCode }
      : { location_name: normalized.locationName }),
    language_code: normalized.languageCode,
    intersections: normalized.intersections,
    item_types: ["organic"],
    include_clickstream_data: false,
    include_serp_info: normalized.includeSerpInfo === true,
    ...(normalized.maxFirstDomainRank === undefined
      ? {}
      : {
          filters: [
            [
              "first_domain_serp_element.rank_group",
              "<=",
              normalized.maxFirstDomainRank,
            ],
          ],
        }),
    order_by: [
      "first_domain_serp_element.etv,desc",
      "keyword_data.keyword_info.search_volume,desc",
    ],
    limit: normalized.limit,
    offset: 0,
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
    DataForSeoDomainIntersectionClient,
    DataForSeoSerpCompetitorsClient,
    DataForSeoAiCitationClient,
    DataForSeoBacklinksClient
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

  async domainIntersection(
    request: DataForSeoDomainIntersectionRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoDomainIntersectionResponse> {
    const abortScope = createRequestAbortScope(this.requestTimeoutMs, [
      this.signal,
      signal,
    ]);
    try {
      const response = await this.fetchImpl(
        DATAFORSEO_DOMAIN_INTERSECTION_LIVE_URL,
        {
          method: "POST",
          headers: {
            Authorization: this.authorization,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([toDomainIntersectionProviderTask(request)]),
          redirect: "error",
          signal: abortScope.signal,
        },
      );
      if (!response.ok) {
        await cancelResponseBody(response);
        throw new SourceError(
          httpErrorCode(response.status),
          `DataForSEO domain-intersection request failed with HTTP ${response.status}.`,
        );
      }
      const payload = await readBoundedJson(
        response,
        this.maxResponseBytes,
        "DataForSEO domain-intersection response",
        abortScope.signal,
      );
      return parseDomainIntersectionResponse(payload);
    } catch (error) {
      throw transportError(error, "domain-intersection");
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

  async aiCitation(
    request: DataForSeoAiCitationRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoAiCitationResponse> {
    const normalized = normalizeAiCitationRequest(request);
    const abortScope = createRequestAbortScope(this.requestTimeoutMs, [
      this.signal,
      signal,
    ]);
    try {
      const response = await this.fetchImpl(
        DATAFORSEO_CHAT_GPT_LLM_RESPONSES_LIVE_URL,
        {
          method: "POST",
          headers: {
            Authorization: this.authorization,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([toAiCitationProviderTask(normalized)]),
          redirect: "error",
          signal: abortScope.signal,
        },
      );
      if (!response.ok) {
        await cancelResponseBody(response);
        throw new SourceError(
          httpErrorCode(response.status),
          `DataForSEO AI-citation request failed with HTTP ${response.status}.`,
        );
      }
      const payload = await readBoundedJson(
        response,
        this.maxResponseBytes,
        "DataForSEO AI-citation response",
        abortScope.signal,
      );
      return parseAiCitationResponse(payload, normalized.modelName);
    } catch (error) {
      throw transportError(error, "ai-citation");
    } finally {
      abortScope.cleanup();
    }
  }

  private async backlinksLiveRequest<T>(
    url: string,
    task: JsonRecord,
    operation:
      | "backlink-summary"
      | "backlinks"
      | "referring-domains"
      | "domain-pages",
    parse: (payload: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    const abortScope = createRequestAbortScope(this.requestTimeoutMs, [
      this.signal,
      signal,
    ]);
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: this.authorization,
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
        this.maxResponseBytes,
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

  async backlinkSummary(
    request: DataForSeoBacklinkSummaryRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoBacklinkSummaryResponse> {
    const task = toBacklinkSummaryProviderTask(request);
    return await this.backlinksLiveRequest(
      DATAFORSEO_BACKLINK_SUMMARY_LIVE_URL,
      task,
      "backlink-summary",
      (payload) => parseBacklinkSummaryResponse(payload, task.target as string),
      signal,
    );
  }

  async backlinks(
    request: DataForSeoBacklinkListRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoBacklinksResponse> {
    return await this.backlinksLiveRequest(
      DATAFORSEO_BACKLINKS_LIVE_URL,
      toBacklinksProviderTask(request),
      "backlinks",
      (payload) => parseBacklinksListResult(payload, "backlinks", parseBacklinkRow),
      signal,
    );
  }

  async referringDomains(
    request: DataForSeoBacklinkListRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoReferringDomainsResponse> {
    return await this.backlinksLiveRequest(
      DATAFORSEO_REFERRING_DOMAINS_LIVE_URL,
      toReferringDomainsProviderTask(request),
      "referring-domains",
      (payload) =>
        parseBacklinksListResult(
          payload,
          "referring-domains",
          parseReferringDomainRow,
        ),
      signal,
    );
  }

  async domainPages(
    request: DataForSeoBacklinkListRequest,
    signal?: AbortSignal,
  ): Promise<DataForSeoDomainPagesResponse> {
    return await this.backlinksLiveRequest(
      DATAFORSEO_DOMAIN_PAGES_LIVE_URL,
      toDomainPagesProviderTask(request),
      "domain-pages",
      (payload) =>
        parseBacklinksListResult(payload, "domain-pages", parseDomainPageRow),
      signal,
    );
  }
}
