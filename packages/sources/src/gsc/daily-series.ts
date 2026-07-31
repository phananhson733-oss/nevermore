/**
 * Google Search Console daily totals reader.
 *
 * Separate from `HttpGscClient`, which is bound to the worker's
 * `[date, page, query]` collection: this one asks for the `[date]` dimension
 * only, which is what a whole-property time series needs, and adds the two
 * things a public, user-triggered tool requires and the worker path does not —
 * retry with backoff on 429/5xx, and a hard wall-clock budget so a request
 * behind a live HTTP handler cannot hang.
 *
 * Two contracts matter to callers:
 * - Days Search Console does not return are ABSENT from the result. They are
 *   never emitted as zero rows: a day with no data and a day with no traffic
 *   are different facts, and only one of them is a zero.
 * - On exhausted retries the read throws. It never returns the rows collected
 *   so far, because a partial series presented as complete reads as a traffic
 *   collapse that did not happen.
 */

import { SourceError } from "../adapter.ts";
import type { SourceErrorCode } from "../adapter.ts";
import {
  cancelResponseBody,
  createRequestAbortScope,
  DEFAULT_PROVIDER_MAX_RESPONSE_BYTES,
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  isAbortLike,
  readBoundedJson,
} from "../provider-http.ts";

const GSC_API_BASE = "https://www.googleapis.com/webmasters/v3/sites";
const DAILY_DIMENSIONS = ["date"] as const;
/**
 * `all`, not `final`.
 *
 * `final` omits the most recent two to three days entirely, which would make
 * the tool blind to the event a visitor is most likely opening it about. The
 * newest days are included and the report says they are provisional.
 */
const DAILY_DATA_STATE = "all" as const;

/** Rows per page. A daily series is small; paging exists so a long range cannot truncate. */
export const GSC_DAILY_ROW_LIMIT = 25_000;
/** Total-row cap. Far above any real date range; a backstop, not a budget. */
export const GSC_DAILY_MAX_ROWS = 50_000;
export const GSC_DAILY_MAX_ATTEMPTS = 4;
export const GSC_DAILY_BASE_RETRY_DELAY_MS = 500;
export const GSC_DAILY_MAX_WALL_CLOCK_MS = 45_000;

/** One day of property totals. */
export interface GscDailyPoint {
  readonly date: string;
  readonly clicks: number;
  readonly impressions: number;
}

export interface GscDailyRange {
  readonly startDate: string;
  readonly endDate: string;
}

export interface GscDailySeriesReader {
  readDailySeries(
    range: GscDailyRange,
    signal?: AbortSignal,
  ): Promise<readonly GscDailyPoint[]>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpGscDailySeriesReaderOptions {
  /** GSC property id: a URL-prefix (`https://example.com/`) or `sc-domain:example.com`. */
  readonly siteUrl: string;
  readonly accessToken: string;
  readonly fetchImpl?: FetchLike;
  readonly rowLimit?: number;
  readonly maxRows?: number;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxAttempts?: number;
  readonly baseRetryDelayMs?: number;
  readonly maxWallClockMs?: number;
  /** Injected in tests so retry behaviour is asserted without real waiting. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0, 1). Injected in tests to make delays deterministic. */
  readonly random?: () => number;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
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

/** Only transient conditions are worth another attempt. */
function isRetryable(error: unknown): boolean {
  return (
    error instanceof SourceError &&
    (error.code === "RATE_LIMITED" ||
      error.code === "UNAVAILABLE" ||
      error.code === "NETWORK_ERROR")
  );
}

function toTransportError(error: unknown): SourceError {
  if (error instanceof SourceError) return error;
  if (isAbortLike(error)) {
    return new SourceError(
      "TIMEOUT",
      "GSC daily series request aborted or timed out.",
    );
  }
  return new SourceError(
    "NETWORK_ERROR",
    "GSC daily series request failed to reach the API.",
  );
}

function toDailyPoint(raw: unknown): GscDailyPoint {
  if (typeof raw !== "object" || raw === null) {
    throw new SourceError("INVALID_RESPONSE", "GSC row was not an object.");
  }
  const record = raw as Record<string, unknown>;
  const keys = record.keys;
  if (!Array.isArray(keys) || keys.length < 1) {
    throw new SourceError("INVALID_RESPONSE", "GSC row.keys must have [date].");
  }
  const date = keys[0];
  if (typeof date !== "string") {
    throw new SourceError("INVALID_RESPONSE", "GSC row.keys[0] must be a date string.");
  }
  const { clicks, impressions } = record;
  if (typeof clicks !== "number" || typeof impressions !== "number") {
    throw new SourceError("INVALID_RESPONSE", "GSC row metrics must be numbers.");
  }
  return { date, clicks, impressions };
}

function parseRows(payload: unknown): readonly GscDailyPoint[] {
  if (typeof payload !== "object" || payload === null) {
    throw new SourceError("INVALID_RESPONSE", "GSC response was not an object.");
  }
  const rows = (payload as { readonly rows?: unknown }).rows;
  // A property with no data for the range returns no `rows` key at all. That
  // is an empty series, not an error, and not a series of zeroes.
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) {
    throw new SourceError("INVALID_RESPONSE", "GSC `rows` was not an array.");
  }
  return rows.map(toDailyPoint);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class HttpGscDailySeriesReader implements GscDailySeriesReader {
  private readonly siteUrl: string;
  private readonly accessToken: string;
  private readonly fetchImpl: FetchLike;
  private readonly rowLimit: number;
  private readonly maxRows: number;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxAttempts: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxWallClockMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly signal: AbortSignal | undefined;

  constructor(options: HttpGscDailySeriesReaderOptions) {
    if (options.siteUrl.trim() === "") {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        "HttpGscDailySeriesReader requires a non-empty siteUrl.",
      );
    }
    if (options.accessToken.trim() === "") {
      throw new SourceError(
        "AUTH_REQUIRED",
        "HttpGscDailySeriesReader requires an access token.",
      );
    }
    this.siteUrl = options.siteUrl;
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.rowLimit = options.rowLimit ?? GSC_DAILY_ROW_LIMIT;
    this.maxRows = options.maxRows ?? GSC_DAILY_MAX_ROWS;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;
    this.maxResponseBytes =
      options.maxResponseBytes ?? DEFAULT_PROVIDER_MAX_RESPONSE_BYTES;
    this.maxAttempts = options.maxAttempts ?? GSC_DAILY_MAX_ATTEMPTS;
    this.baseRetryDelayMs =
      options.baseRetryDelayMs ?? GSC_DAILY_BASE_RETRY_DELAY_MS;
    this.maxWallClockMs = options.maxWallClockMs ?? GSC_DAILY_MAX_WALL_CLOCK_MS;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.signal = options.signal;
  }

  async readDailySeries(
    range: GscDailyRange,
    signal?: AbortSignal,
  ): Promise<readonly GscDailyPoint[]> {
    const deadline = this.now() + this.maxWallClockMs;
    const collected: GscDailyPoint[] = [];
    let startRow = 0;

    while (collected.length < this.maxRows) {
      const page = await this.fetchPageWithRetry(
        range,
        startRow,
        deadline,
        signal,
      );
      if (page.length === 0) break;
      for (const row of page) {
        collected.push(row);
        if (collected.length >= this.maxRows) break;
      }
      if (page.length < this.rowLimit) break;
      startRow += this.rowLimit;
    }

    return collected;
  }

  /** Exponential backoff with jitter, bounded by attempts and the wall clock. */
  private async fetchPageWithRetry(
    range: GscDailyRange,
    startRow: number,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<readonly GscDailyPoint[]> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.fetchPage(range, startRow, signal);
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === this.maxAttempts) break;

        const backoff = this.baseRetryDelayMs * 2 ** (attempt - 1);
        // Full jitter over the window keeps concurrent readers from retrying
        // in lockstep and re-triggering the same rate limit.
        const delay = Math.round(backoff * (0.5 + this.random() * 0.5));
        if (this.now() + delay >= deadline) {
          throw new SourceError(
            "TIMEOUT",
            "GSC daily series exceeded its time budget while retrying.",
          );
        }
        await this.sleep(delay);
      }
    }

    // Retries are exhausted. Throwing — rather than returning what we have —
    // is the whole point: a truncated series looks exactly like a collapse.
    throw toTransportError(lastError);
  }

  private async fetchPage(
    range: GscDailyRange,
    startRow: number,
    signal?: AbortSignal,
  ): Promise<readonly GscDailyPoint[]> {
    const url = `${GSC_API_BASE}/${encodeURIComponent(this.siteUrl)}/searchAnalytics/query`;
    const body = JSON.stringify({
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: DAILY_DIMENSIONS,
      dataState: DAILY_DATA_STATE,
      rowLimit: this.rowLimit,
      startRow,
    });
    const abortScope = createRequestAbortScope(this.requestTimeoutMs, [
      this.signal,
      signal,
    ]);
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body,
        redirect: "error",
        signal: abortScope.signal,
      });

      if (!response.ok) {
        await cancelResponseBody(response);
        throw new SourceError(
          mapHttpStatus(response.status),
          `GSC daily series failed with HTTP ${response.status}.`,
        );
      }

      const payload = await readBoundedJson(
        response,
        this.maxResponseBytes,
        "GSC daily series",
        abortScope.signal,
      );
      return parseRows(payload);
    } catch (error) {
      throw toTransportError(error);
    } finally {
      abortScope.cleanup();
    }
  }
}
