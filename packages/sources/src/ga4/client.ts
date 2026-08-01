/**
 * GA4 Data API v1beta transport (spec §7.4). `HttpGa4Client` is the ONLY place
 * that touches the network: it POSTs `runReport` / `checkCompatibility`, attaches
 * the Bearer token, paginates by `offset`, and maps HTTP failures onto the stable
 * `SourceError` codes so business logic never sees provider prose. It is
 * injectable — the worker constructs a token-bound + property-bound instance and
 * hands it to `createGa4Adapter`; tests inject a fake `fetch` and run offline.
 *
 * Read-only scope: `https://www.googleapis.com/auth/analytics.readonly`.
 */

import type { SourceErrorCode } from "../adapter.ts";
import { SourceError } from "../adapter.ts";
import {
  cancelResponseBody,
  createRequestAbortScope,
  DEFAULT_PROVIDER_MAX_RESPONSE_BYTES,
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  isAbortLike,
  readBoundedJson,
} from "../provider-http.ts";

export const GA4_API_BASE = "https://analyticsdata.googleapis.com/v1beta";
/** Spec §7.2: one GA4 collection run may ingest at most 200,000 provider rows. */
export const GA4_MAX_ROWS = 200_000;
/** Bounds the whole multi-page report, not each page independently. */
export const DEFAULT_GA4_REPORT_TIMEOUT_MS = 120_000;
export const GA4_ROW_CAP_STOP_REASON = "row_cap_reached" as const;
export const GA4_PAGINATION_CAP_STOP_REASON = "pagination_cap_reached" as const;
export const GA4_ROW_CAP_LIMITATION =
  "GA4_ROW_CAP_REACHED: GA4 collection stopped at the 200,000-row run budget; collected metrics are incomplete.";
export const GA4_PAGINATION_CAP_LIMITATION =
  "GA4_PAGINATION_CAP_REACHED: GA4 report pagination did not finish within its safety limit; collected metrics are incomplete.";

/** GA4 default page size; a single organic-landing window stays well under this. */
const DEFAULT_PAGE_SIZE = 100_000;
/** Hard safety cap on pagination loops (never reached for real MVP volumes). */
const DEFAULT_MAX_PAGES = 100;

/** The injectable fetch surface (Node global `fetch` by default). */
export type FetchLike = typeof globalThis.fetch;

// ---------------------------------------------------------------------------
// Request / response value types (the subset of the GA4 schema we use).
// ---------------------------------------------------------------------------

export interface Ga4DateRange {
  readonly startDate: string;
  readonly endDate: string;
}

export interface Ga4Dimension {
  readonly name: string;
}

export interface Ga4Metric {
  readonly name: string;
}

export interface Ga4StringFilter {
  readonly matchType: "EXACT";
  readonly value: string;
}

export interface Ga4InListFilter {
  readonly values: readonly string[];
}

export interface Ga4FieldFilter {
  readonly filter: {
    readonly fieldName: string;
    readonly stringFilter?: Ga4StringFilter;
    readonly inListFilter?: Ga4InListFilter;
  };
}

export interface Ga4AndGroup {
  readonly andGroup: { readonly expressions: readonly Ga4FilterExpression[] };
}

export type Ga4FilterExpression = Ga4FieldFilter | Ga4AndGroup;

export interface Ga4RunReportRequest {
  readonly dateRanges: readonly Ga4DateRange[];
  readonly dimensions: readonly Ga4Dimension[];
  readonly metrics: readonly Ga4Metric[];
  readonly dimensionFilter?: Ga4FilterExpression;
  /** Per-page row limit; the client paginates on `offset` until exhausted. */
  readonly limit?: number;
  readonly offset?: number;
}

export interface Ga4ReportCell {
  readonly value: string;
}

export interface Ga4ReportRow {
  readonly dimensionValues: readonly Ga4ReportCell[];
  readonly metricValues: readonly Ga4ReportCell[];
}

export type Ga4ReportStopReason =
  | typeof GA4_ROW_CAP_STOP_REASON
  | typeof GA4_PAGINATION_CAP_STOP_REASON;

/** All pages merged; `rowCount` remains GA4's reported total for honest coverage. */
export interface Ga4ReportResponse {
  readonly rows: readonly Ga4ReportRow[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly stopReason: Ga4ReportStopReason | null;
  readonly limitation: string;
}

export interface Ga4RunReportOptions {
  /** Remaining rows in the adapter's collection-wide budget. */
  readonly maxRows?: number;
}

export interface Ga4CompatibilityRequest {
  readonly dimensions: readonly Ga4Dimension[];
  readonly metrics: readonly Ga4Metric[];
  readonly dimensionFilter?: Ga4FilterExpression;
}

export interface Ga4CompatibilityResponse {
  readonly compatible: boolean;
  readonly incompatibleFields: readonly string[];
}

/** The transport contract the adapter depends on (injectable, offline-testable). */
export interface Ga4Client {
  runReport(
    request: Ga4RunReportRequest,
    signal?: AbortSignal,
    options?: Ga4RunReportOptions,
  ): Promise<Ga4ReportResponse>;
  checkCompatibility(
    request: Ga4CompatibilityRequest,
    signal?: AbortSignal,
  ): Promise<Ga4CompatibilityResponse>;
}

export interface HttpGa4ClientOptions {
  /** Property resource name, e.g. `properties/123456789`. */
  readonly propertyId: string;
  /** OAuth access token (analytics.readonly scope). Never logged. */
  readonly accessToken: string;
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
  readonly pageSize?: number;
  readonly maxPages?: number;
  /** Per-report row cap. Cannot exceed the §7.2 collection cap. */
  readonly maxRows?: number;
  /** Per-request deadline; defaults to 30 seconds. */
  readonly requestTimeoutMs?: number;
  /** Deadline for the complete multi-page `runReport` chain. */
  readonly reportTimeoutMs?: number;
  /** Maximum decoded JSON bytes per response; defaults to 32 MiB. */
  readonly maxResponseBytes?: number;
  /** Optional client-lifetime cancellation, combined with per-call signals. */
  readonly signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Loosely-typed views of untrusted JSON responses (validated before use).
// ---------------------------------------------------------------------------

interface RawReportCell {
  readonly value?: string;
}
interface RawReportRow {
  readonly dimensionValues?: readonly RawReportCell[];
  readonly metricValues?: readonly RawReportCell[];
}
interface RawReportResponse {
  readonly rows?: readonly RawReportRow[];
  readonly rowCount?: number;
}
interface RawCompatEntry {
  readonly compatibility?: string;
  readonly dimensionMetadata?: { readonly apiName?: string };
  readonly metricMetadata?: { readonly apiName?: string };
}
interface RawCompatibilityResponse {
  readonly dimensionCompatibilities?: readonly RawCompatEntry[];
  readonly metricCompatibilities?: readonly RawCompatEntry[];
}

/** Map a GA4 HTTP status onto a stable adapter error code (spec §7.1, §13.1). */
function mapStatus(status: number): SourceErrorCode {
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 408) return "TIMEOUT";
  if (status === 400 || status === 404) return "INVALID_CONFIGURATION";
  if (status >= 500) return "NETWORK_ERROR";
  return "INVALID_RESPONSE";
}

function normalizeCell(cell: RawReportCell | undefined): Ga4ReportCell {
  return { value: typeof cell?.value === "string" ? cell.value : "" };
}

function normalizeRow(row: RawReportRow): Ga4ReportRow {
  return {
    dimensionValues: (row.dimensionValues ?? []).map(normalizeCell),
    metricValues: (row.metricValues ?? []).map(normalizeCell),
  };
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SourceError("INVALID_CONFIGURATION", `${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SourceError("INVALID_CONFIGURATION", `${label} must be a non-negative integer.`);
  }
  return value;
}

function reportPage(value: unknown): {
  readonly rows: readonly RawReportRow[];
  readonly rowCount: number;
} {
  if (typeof value !== "object" || value === null) {
    throw new SourceError("INVALID_RESPONSE", "GA4 report response must be an object.");
  }
  const response = value as RawReportResponse;
  if (response.rows !== undefined && !Array.isArray(response.rows)) {
    throw new SourceError("INVALID_RESPONSE", "GA4 report response rows must be an array.");
  }
  const rows = response.rows ?? [];
  if (rows.some((row) => typeof row !== "object" || row === null)) {
    throw new SourceError("INVALID_RESPONSE", "GA4 report response contains an invalid row.");
  }
  // Google APIs use proto3 JSON, which omits scalar fields carrying their
  // default value. A valid empty report can therefore be `{}` rather than
  // `{ rows: [], rowCount: 0 }`. Missing rowCount is honest only when no rows
  // were returned; a non-empty response still needs the provider total so
  // pagination and truncation cannot silently fabricate completeness.
  const rowCount = response.rowCount ?? (rows.length === 0 ? 0 : undefined);
  if (rowCount === undefined || !Number.isSafeInteger(rowCount) || rowCount < 0) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "GA4 report response has an invalid rowCount.",
    );
  }
  return { rows, rowCount };
}

function completedReport(
  rows: readonly Ga4ReportRow[],
  rowCount: number,
): Ga4ReportResponse {
  return { rows, rowCount, truncated: false, stopReason: null, limitation: "" };
}

function truncatedReport(
  rows: readonly Ga4ReportRow[],
  rowCount: number,
  stopReason: Ga4ReportStopReason,
): Ga4ReportResponse {
  return {
    rows,
    rowCount,
    truncated: true,
    stopReason,
    limitation:
      stopReason === GA4_ROW_CAP_STOP_REASON
        ? GA4_ROW_CAP_LIMITATION
        : GA4_PAGINATION_CAP_LIMITATION,
  };
}

/**
 * `HttpGa4Client` — the concrete network transport. Owns nothing about the
 * organic-landing report shape; it just runs whatever request the adapter builds.
 */
export class HttpGa4Client implements Ga4Client {
  private readonly propertyId: string;
  private readonly accessToken: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly maxRows: number;
  private readonly requestTimeoutMs: number;
  private readonly reportTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly signal: AbortSignal | undefined;

  constructor(options: HttpGa4ClientOptions) {
    this.propertyId = options.propertyId;
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? GA4_API_BASE;
    this.pageSize = positiveSafeInteger(options.pageSize ?? DEFAULT_PAGE_SIZE, "GA4 pageSize");
    this.maxPages = positiveSafeInteger(options.maxPages ?? DEFAULT_MAX_PAGES, "GA4 maxPages");
    this.maxRows = positiveSafeInteger(options.maxRows ?? GA4_MAX_ROWS, "GA4 maxRows");
    if (this.maxRows > GA4_MAX_ROWS) {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        `GA4 maxRows cannot exceed ${GA4_MAX_ROWS}.`,
      );
    }
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;
    this.reportTimeoutMs = options.reportTimeoutMs ?? DEFAULT_GA4_REPORT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_PROVIDER_MAX_RESPONSE_BYTES;
    this.signal = options.signal;
  }

  async runReport(
    request: Ga4RunReportRequest,
    signal?: AbortSignal,
    options?: Ga4RunReportOptions,
  ): Promise<Ga4ReportResponse> {
    const requestedPageSize = positiveSafeInteger(
      request.limit ?? this.pageSize,
      "GA4 report limit",
    );
    const requestedMaxRows = positiveSafeInteger(
      options?.maxRows ?? this.maxRows,
      "GA4 report maxRows",
    );
    const maxRows = Math.min(requestedMaxRows, this.maxRows, GA4_MAX_ROWS);
    let offset = nonNegativeSafeInteger(request.offset ?? 0, "GA4 report offset");
    const rows: Ga4ReportRow[] = [];
    let rowCount: number | null = null;
    const reportScope = createRequestAbortScope(this.reportTimeoutMs, [this.signal, signal]);

    try {
      for (let page = 0; page < this.maxPages; page += 1) {
        const remainingBudget = maxRows - rows.length;
        if (remainingBudget === 0) {
          return rowCount !== null && offset >= rowCount
            ? completedReport(rows, rowCount)
            : truncatedReport(rows, rowCount ?? offset, GA4_ROW_CAP_STOP_REASON);
        }

        const remainingProviderRows = rowCount === null ? null : Math.max(0, rowCount - offset);
        if (remainingProviderRows === 0 && rowCount !== null) {
          return completedReport(rows, rowCount);
        }
        const pageLimit = Math.min(
          requestedPageSize,
          remainingBudget,
          remainingProviderRows ?? Number.POSITIVE_INFINITY,
        );
        const body = this.buildReportBody(request, pageLimit, offset);
        const pageResponse = reportPage(
          await this.post<unknown>(":runReport", body, reportScope.signal),
        );

        if (rowCount !== null && pageResponse.rowCount !== rowCount) {
          throw new SourceError(
            "INVALID_RESPONSE",
            "GA4 report rowCount changed during pagination.",
          );
        }
        rowCount = pageResponse.rowCount;
        const expectedOnOrAfterOffset = Math.max(0, rowCount - offset);
        if (
          pageResponse.rows.length > pageLimit ||
          pageResponse.rows.length > expectedOnOrAfterOffset
        ) {
          throw new SourceError(
            "INVALID_RESPONSE",
            "GA4 report returned more rows than requested or reported.",
          );
        }

        for (const row of pageResponse.rows) rows.push(normalizeRow(row));
        offset += pageResponse.rows.length;

        // Check provider completion before the cap so exactly-at-cap remains complete.
        if (offset >= rowCount) return completedReport(rows, rowCount);
        if (rows.length >= maxRows) {
          return truncatedReport(rows, rowCount, GA4_ROW_CAP_STOP_REASON);
        }
        if (pageResponse.rows.length === 0) {
          return truncatedReport(rows, rowCount, GA4_PAGINATION_CAP_STOP_REASON);
        }
      }

      return truncatedReport(
        rows,
        rowCount ?? offset,
        GA4_PAGINATION_CAP_STOP_REASON,
      );
    } finally {
      reportScope.cleanup();
    }
  }

  async checkCompatibility(
    request: Ga4CompatibilityRequest,
    signal?: AbortSignal,
  ): Promise<Ga4CompatibilityResponse> {
    const body: Record<string, unknown> = {
      dimensions: request.dimensions,
      metrics: request.metrics,
    };
    if (request.dimensionFilter) body.dimensionFilter = request.dimensionFilter;

    const resp = await this.post<RawCompatibilityResponse>(":checkCompatibility", body, signal);
    const requestedDimensions = new Set(
      request.dimensions.map((dimension) => dimension.name),
    );
    const requestedMetrics = new Set(request.metrics.map((metric) => metric.name));
    const incompatibleFields: string[] = [];
    for (const entry of resp.dimensionCompatibilities ?? []) {
      const apiName = entry.dimensionMetadata?.apiName;
      if (
        apiName !== undefined &&
        requestedDimensions.has(apiName) &&
        entry.compatibility !== "COMPATIBLE"
      ) {
        incompatibleFields.push(apiName);
      }
    }
    for (const entry of resp.metricCompatibilities ?? []) {
      const apiName = entry.metricMetadata?.apiName;
      if (
        apiName !== undefined &&
        requestedMetrics.has(apiName) &&
        entry.compatibility !== "COMPATIBLE"
      ) {
        incompatibleFields.push(apiName);
      }
    }
    return { compatible: incompatibleFields.length === 0, incompatibleFields };
  }

  private buildReportBody(
    request: Ga4RunReportRequest,
    limit: number,
    offset: number,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      dateRanges: request.dateRanges,
      dimensions: request.dimensions,
      metrics: request.metrics,
      limit: String(limit),
      offset: String(offset),
    };
    if (request.dimensionFilter) body.dimensionFilter = request.dimensionFilter;
    return body;
  }

  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const abortScope = createRequestAbortScope(this.requestTimeoutMs, [this.signal, signal]);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/${this.propertyId}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: abortScope.signal,
      });

      if (!response.ok) {
        await cancelResponseBody(response);
        throw new SourceError(
          mapStatus(response.status),
          `GA4 API ${response.status} on ${path}`,
        );
      }

      return (await readBoundedJson(
        response,
        this.maxResponseBytes,
        `GA4 API ${path}`,
        abortScope.signal,
      )) as T;
    } catch (error) {
      if (error instanceof SourceError) throw error;
      if (isAbortLike(error)) {
        throw new SourceError("TIMEOUT", "GA4 request aborted or timed out.");
      }
      throw new SourceError("NETWORK_ERROR", "GA4 request failed to reach the API.");
    } finally {
      abortScope.cleanup();
    }
  }
}
