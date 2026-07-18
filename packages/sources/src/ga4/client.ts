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

export const GA4_API_BASE = "https://analyticsdata.googleapis.com/v1beta";

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

/** All pages merged: `rows` is the concatenation, `rowCount` GA4's reported total. */
export interface Ga4ReportResponse {
  readonly rows: readonly Ga4ReportRow[];
  readonly rowCount: number;
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
  runReport(request: Ga4RunReportRequest, signal?: AbortSignal): Promise<Ga4ReportResponse>;
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

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

  constructor(options: HttpGa4ClientOptions) {
    this.propertyId = options.propertyId;
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? GA4_API_BASE;
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  }

  async runReport(
    request: Ga4RunReportRequest,
    signal?: AbortSignal,
  ): Promise<Ga4ReportResponse> {
    const limit = request.limit ?? this.pageSize;
    let offset = request.offset ?? 0;
    const rows: Ga4ReportRow[] = [];
    let rowCount = 0;

    for (let page = 0; page < this.maxPages; page += 1) {
      const body = this.buildReportBody(request, limit, offset);
      const resp = await this.post<RawReportResponse>(":runReport", body, signal);
      const pageRows = resp.rows ?? [];
      for (const row of pageRows) rows.push(normalizeRow(row));
      rowCount = typeof resp.rowCount === "number" ? resp.rowCount : rows.length;
      // Last page: GA4 returned fewer than a full page, or we have everything.
      if (pageRows.length < limit || rows.length >= rowCount) break;
      offset += limit;
    }

    return { rows, rowCount };
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
    const incompatibleFields: string[] = [];
    for (const entry of resp.dimensionCompatibilities ?? []) {
      if (entry.compatibility !== "COMPATIBLE") {
        incompatibleFields.push(entry.dimensionMetadata?.apiName ?? "unknown");
      }
    }
    for (const entry of resp.metricCompatibilities ?? []) {
      if (entry.compatibility !== "COMPATIBLE") {
        incompatibleFields.push(entry.metricMetadata?.apiName ?? "unknown");
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
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/${this.propertyId}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: signal ?? null,
      });
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError("NETWORK_ERROR", `GA4 request failed: ${errMessage(err)}`);
    }

    if (!res.ok) {
      throw new SourceError(mapStatus(res.status), `GA4 API ${res.status} on ${path}`);
    }

    try {
      return (await res.json()) as T;
    } catch {
      throw new SourceError("INVALID_RESPONSE", `GA4 returned a non-JSON body on ${path}`);
    }
  }
}
