/**
 * Parameterised Search Analytics client for the anonymous public tools.
 *
 * Separate from `HttpGscClient` on purpose. That one is frozen to the worker's
 * collection shape — `[date,page,query]`, 250k rows, and a 429 that throws
 * immediately (`client.ts` maps it straight to `RATE_LIMITED`). The public
 * tools need to choose their dimensions per call, need the aggregation type
 * echoed back, and need one backoff attempt on a transient failure because a
 * visitor watching a spinner has no worker to retry them.
 *
 * Retries stop after ONE attempt. Search Console quota is counted per GCP
 * project rather than per visitor, so a client that keeps retrying is not
 * being persistent on its own behalf — it is spending the budget every other
 * visitor to the tool needs.
 */

import { SourceError } from "../adapter.ts";
import type { SourceErrorCode } from "../adapter.ts";
import {
  cancelResponseBody,
  createRequestAbortScope,
  DEFAULT_PROVIDER_MAX_RESPONSE_BYTES,
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  readBoundedJson,
} from "../provider-http.ts";

const GSC_API_BASE = "https://www.googleapis.com/webmasters/v3/sites";

/**
 * `final` excludes the days Search Console has not finished counting.
 *
 * Without it the last day or two come back low because they are incomplete,
 * and a CTR computed over them is measuring the reporting lag.
 */
const GSC_DATA_STATE = "final" as const;

/** Floor of the single retry delay, before jitter. */
export const RETRYABLE_BACKOFF_BASE_MS = 400;
/** Jitter added on top, scaled by the injected random source. */
export const RETRYABLE_BACKOFF_JITTER_MS = 600;

export type SearchAnalyticsDimension = "query" | "page" | "date";

/**
 * One equality filter, which is all the callers here need.
 *
 * Deliberately not the API's full filter grammar. `contains` and the regex
 * operators make it easy to write a filter that quietly matches more than the
 * caller meant — a page filter that also catches every child path, say — and
 * the numbers that come back would still look like an answer about one URL.
 */
export interface SearchAnalyticsEqualsFilter {
  readonly dimension: SearchAnalyticsDimension;
  readonly expression: string;
}

export interface SearchAnalyticsRequest {
  readonly dimensions: readonly SearchAnalyticsDimension[];
  readonly startDate: string;
  readonly endDate: string;
  readonly rowLimit: number;
  readonly startRow: number;
  /**
   * Narrows the rows to those matching every entry, or omitted for all rows.
   *
   * Absent from the request body entirely when empty, so an unfiltered call is
   * byte-identical to what it sent before this existed.
   */
  readonly filters?: readonly SearchAnalyticsEqualsFilter[];
}

export interface SearchAnalyticsRow {
  /** One entry per requested dimension, in the order they were requested. */
  readonly keys: readonly string[];
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number;
}

export interface SearchAnalyticsResponse {
  readonly rows: readonly SearchAnalyticsRow[];
  /** Echoed from the service; null when the response omitted it. */
  readonly responseAggregationType: string | null;
}

export type SearchAnalyticsFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface SearchAnalyticsClientOptions {
  /** URL-prefix (`https://example.com/`) or `sc-domain:example.com`. */
  readonly siteUrl: string;
  readonly accessToken: string;
  readonly fetchImpl?: SearchAnalyticsFetch;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  /** Injected so backoff is instant and deterministic under test. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly signal?: AbortSignal;
  /**
   * Milliseconds left in the whole request, read fresh before each attempt.
   *
   * A per-attempt timeout alone does not bound anything: the caller pages
   * several times and each page may retry, so the request runs to the SUM of
   * the timeouts. With this, each attempt gets the smaller of its own timeout
   * and what is actually left, and a retry that could not finish in the
   * remaining time is not started.
   */
  readonly remainingMs?: () => number;
}

function mapHttpStatus(status: number): SourceErrorCode {
  switch (status) {
    case 401:
      return "AUTH_REQUIRED";
    case 403:
      return "PERMISSION_DENIED";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "UNAVAILABLE" : "INVALID_RESPONSE";
  }
}

/** 429 and 5xx are worth one more try; everything else is a decision, not weather. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseRows(payload: Record<string, unknown>): SearchAnalyticsRow[] {
  const raw = payload["rows"];
  // Search Console omits `rows` entirely when nothing matched. That is an
  // empty result, not a malformed body.
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "Search Analytics returned a non-array rows field.",
    );
  }

  return raw.map((entry) => {
    const row = entry as Record<string, unknown>;
    const keys = Array.isArray(row["keys"])
      ? (row["keys"] as unknown[]).map((k) => String(k))
      : [];
    return {
      keys,
      clicks: toNumber(row["clicks"]),
      impressions: toNumber(row["impressions"]),
      position: toNumber(row["position"]),
    };
  });
}

/**
 * Build a client bound to one property and one visitor's access token.
 *
 * The token is captured in the closure and never written into the URL, where
 * it would end up in any proxy or access log that records query strings.
 */
export function createSearchAnalyticsClient(
  options: SearchAnalyticsClientOptions,
): (request: SearchAnalyticsRequest) => Promise<SearchAnalyticsResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs =
    options.requestTimeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_PROVIDER_MAX_RESPONSE_BYTES;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;

  const endpoint = `${GSC_API_BASE}/${encodeURIComponent(
    options.siteUrl,
  )}/searchAnalytics/query`;

  /** The attempt's deadline: its own timeout, capped by what the request has left. */
  function attemptTimeoutMs(): number {
    const remaining = options.remainingMs?.();
    if (remaining === undefined) return timeoutMs;
    return Math.min(timeoutMs, Math.max(0, remaining));
  }

  async function attempt(
    request: SearchAnalyticsRequest,
    budgetMs: number,
  ): Promise<
    | { readonly ok: true; readonly value: SearchAnalyticsResponse }
    | { readonly ok: false; readonly status: number }
  > {
    const scope = createRequestAbortScope(budgetMs, [options.signal]);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          dimensions: request.dimensions,
          startDate: request.startDate,
          endDate: request.endDate,
          rowLimit: request.rowLimit,
          startRow: request.startRow,
          dataState: GSC_DATA_STATE,
          ...(request.filters === undefined || request.filters.length === 0
            ? {}
            : {
                dimensionFilterGroups: [
                  {
                    groupType: "and",
                    filters: request.filters.map((filter) => ({
                      dimension: filter.dimension,
                      operator: "equals",
                      expression: filter.expression,
                    })),
                  },
                ],
              }),
        }),
        signal: scope.signal,
      });

      if (!response.ok) {
        await cancelResponseBody(response);
        return { ok: false, status: response.status };
      }

      const payload = await readBoundedJson(
        response,
        maxResponseBytes,
        "Search Analytics",
        scope.signal,
      );
      if (
        typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload)
      ) {
        throw new SourceError(
          "INVALID_RESPONSE",
          "Search Analytics returned a non-object body.",
        );
      }

      const body = payload as Record<string, unknown>;
      const aggregation = body["responseAggregationType"];
      return {
        ok: true,
        value: {
          rows: parseRows(body),
          // Never defaulted. An aggregation the service did not confirm is
          // exactly how two incompatible measurements get divided.
          responseAggregationType:
            typeof aggregation === "string" ? aggregation : null,
        },
      };
    } finally {
      // Runs only after the body has been read or cancelled above, which is
      // the contract createRequestAbortScope documents.
      scope.cleanup();
    }
  }

  return async (request) => {
    const firstBudget = attemptTimeoutMs();
    if (firstBudget <= 0) {
      throw new SourceError(
        "UNAVAILABLE",
        "Search Analytics call skipped: the request budget was already spent.",
      );
    }

    const first = await attempt(request, firstBudget);
    if (first.ok) return first.value;

    if (!isRetryable(first.status)) {
      throw new SourceError(
        mapHttpStatus(first.status),
        `Search Analytics responded ${first.status}.`,
      );
    }

    // Jittered so that many visitors hitting the same quota ceiling do not
    // all come back in the same millisecond and trip it again together.
    const backoffMs =
      RETRYABLE_BACKOFF_BASE_MS + random() * RETRYABLE_BACKOFF_JITTER_MS;

    // Do not start a retry the budget cannot cover. Starting it anyway is how
    // a request already at 40s reaches 80s and is killed by the platform
    // mid-flight, which loses both the stable error envelope and the
    // handler's slot release.
    if (attemptTimeoutMs() - backoffMs <= 0) {
      throw new SourceError(
        mapHttpStatus(first.status),
        `Search Analytics responded ${first.status}; no budget left to retry.`,
      );
    }

    await sleep(backoffMs);

    const secondBudget = attemptTimeoutMs();
    if (secondBudget <= 0) {
      throw new SourceError(
        mapHttpStatus(first.status),
        `Search Analytics responded ${first.status}; budget spent during backoff.`,
      );
    }

    const second = await attempt(request, secondBudget);
    if (second.ok) return second.value;

    throw new SourceError(
      mapHttpStatus(second.status),
      `Search Analytics responded ${second.status} after one retry.`,
    );
  };
}
