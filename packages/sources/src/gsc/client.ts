/**
 * Google Search Console Search Analytics client (spec §7.4). Isolates the REST
 * mechanics (endpoint, Bearer auth, pagination, HTTP -> `SourceError` mapping)
 * behind the small `GscClient` seam so the adapter and its tests never touch the
 * network. `HttpGscClient` is bound to one `siteUrl` + access token at
 * construction; the worker builds a token-bound instance per connection.
 *
 * Pagination follows spec §8.4: `dimensions:[date,page,query]`,
 * `dataState:"final"`, `rowLimit:25000`, advancing `startRow` until an empty
 * page or the 250,000-row cap. The cap is a hard stop; the adapter reads
 * `rows.length >= GSC_MAX_ROWS` to mark the snapshot `partial`.
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
const GSC_DIMENSIONS = ["date", "page", "query"] as const;
const GSC_DATA_STATE = "final" as const;

/** Rows requested per page (spec §8.4). */
export const GSC_ROW_LIMIT = 25_000;
/** Hard cap on total rows collected; exceeding it makes the snapshot `partial`. */
export const GSC_MAX_ROWS = 250_000;

/** One Search Analytics row keyed by (date, page, query). `ctr` is intentionally dropped. */
export interface GscRow {
  readonly date: string;
  readonly page: string;
  readonly query: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number;
}

/** Query bounds for one collection; the client owns dimensions/dataState/paging. */
export interface GscQueryParams {
  readonly startDate: string;
  readonly endDate: string;
}

/** The injectable seam the adapter depends on. Bound to a site + token upstream. */
export interface GscClient {
  querySearchAnalytics(
    params: GscQueryParams,
    signal?: AbortSignal,
  ): Promise<readonly GscRow[]>;
}

/** Minimal `fetch` shape so tests can inject a fixture without DOM lib types. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpGscClientOptions {
  /** GSC property id: a URL-prefix (`https://example.com/`) or `sc-domain:example.com`. */
  readonly siteUrl: string;
  readonly accessToken: string;
  /** Defaults to the global `fetch`; injected in tests. */
  readonly fetchImpl?: FetchLike;
  /** Page size override (tests use a small value); defaults to `GSC_ROW_LIMIT`. */
  readonly rowLimit?: number;
  /** Total-row cap override; defaults to `GSC_MAX_ROWS`. */
  readonly maxRows?: number;
  /** Per-page deadline; defaults to 30 seconds. */
  readonly requestTimeoutMs?: number;
  /** Maximum decoded JSON bytes per page; defaults to 32 MiB. */
  readonly maxResponseBytes?: number;
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

function toTransportError(error: unknown): SourceError {
  if (error instanceof SourceError) return error;
  if (isAbortLike(error)) {
    return new SourceError("TIMEOUT", "GSC Search Analytics request aborted or timed out.");
  }
  return new SourceError("NETWORK_ERROR", "GSC Search Analytics request failed to reach the API.");
}

function toGscRow(raw: unknown): GscRow {
  if (typeof raw !== "object" || raw === null) {
    throw new SourceError("INVALID_RESPONSE", "GSC row was not an object.");
  }
  const record = raw as Record<string, unknown>;
  const keys = record.keys;
  if (!Array.isArray(keys) || keys.length < 3) {
    throw new SourceError("INVALID_RESPONSE", "GSC row.keys must have [date, page, query].");
  }
  const date = keys[0];
  const page = keys[1];
  const query = keys[2];
  if (typeof date !== "string" || typeof page !== "string" || typeof query !== "string") {
    throw new SourceError("INVALID_RESPONSE", "GSC row.keys entries must be strings.");
  }
  const { clicks, impressions, position } = record;
  if (typeof clicks !== "number" || typeof impressions !== "number" || typeof position !== "number") {
    throw new SourceError("INVALID_RESPONSE", "GSC row metrics must be numbers.");
  }
  return { date, page, query, clicks, impressions, position };
}

function parseRows(payload: unknown): readonly GscRow[] {
  if (typeof payload !== "object" || payload === null) {
    throw new SourceError("INVALID_RESPONSE", "GSC Search Analytics response was not an object.");
  }
  const rows = (payload as { readonly rows?: unknown }).rows;
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) {
    throw new SourceError("INVALID_RESPONSE", "GSC Search Analytics `rows` was not an array.");
  }
  return rows.map(toGscRow);
}

export class HttpGscClient implements GscClient {
  private readonly siteUrl: string;
  private readonly accessToken: string;
  private readonly fetchImpl: FetchLike;
  private readonly rowLimit: number;
  private readonly maxRows: number;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly signal: AbortSignal | undefined;

  constructor(options: HttpGscClientOptions) {
    if (options.siteUrl.trim() === "") {
      throw new SourceError("INVALID_CONFIGURATION", "HttpGscClient requires a non-empty siteUrl.");
    }
    if (options.accessToken.trim() === "") {
      throw new SourceError("AUTH_REQUIRED", "HttpGscClient requires an access token.");
    }
    this.siteUrl = options.siteUrl;
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.rowLimit = options.rowLimit ?? GSC_ROW_LIMIT;
    this.maxRows = options.maxRows ?? GSC_MAX_ROWS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_PROVIDER_MAX_RESPONSE_BYTES;
    this.signal = options.signal;
  }

  async querySearchAnalytics(
    params: GscQueryParams,
    signal?: AbortSignal,
  ): Promise<readonly GscRow[]> {
    const collected: GscRow[] = [];
    let startRow = 0;
    while (collected.length < this.maxRows) {
      const page = await this.fetchPage(params, startRow, signal);
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

  private async fetchPage(
    params: GscQueryParams,
    startRow: number,
    signal?: AbortSignal,
  ): Promise<readonly GscRow[]> {
    const url = `${GSC_API_BASE}/${encodeURIComponent(this.siteUrl)}/searchAnalytics/query`;
    const body = JSON.stringify({
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: GSC_DIMENSIONS,
      dataState: GSC_DATA_STATE,
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
          `GSC Search Analytics failed with HTTP ${response.status}.`,
        );
      }

      const payload = await readBoundedJson(
        response,
        this.maxResponseBytes,
        "GSC Search Analytics",
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
