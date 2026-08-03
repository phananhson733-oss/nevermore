// @input  -- none; shared shapes for the Search Analytics seam
// @output -- the request/response contract the injected client must satisfy
// @pos    -- keeps the reader pure: transport lives in apps/*, orchestration here
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/** Dimensions this reader knows how to ask for. */
export type GscDimension = "query" | "page" | "date";

export interface GscQueryRequest {
  readonly dimensions: readonly GscDimension[];
  readonly startDate: string;
  readonly endDate: string;
  readonly rowLimit: number;
  readonly startRow: number;
}

export interface GscRawRow {
  /** One entry per requested dimension, in the order they were requested. */
  readonly keys: readonly string[];
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number;
}

export interface GscQueryResponse {
  readonly rows: readonly GscRawRow[];
  /**
   * What Search Console actually aggregated by, echoed back from the API.
   *
   * Requesting `byProperty` is not accepted once the query groups or filters
   * by page; the service picks its own and reports it here. Two reads with
   * different values are two different measurements: their totals are not
   * comparable and one must never be divided by the other. Null when the
   * response omitted the field.
   */
  readonly responseAggregationType: string | null;
}

/** The transport seam. Implemented in apps/*, faked in tests. */
export type GscQueryClient = (
  request: GscQueryRequest,
) => Promise<GscQueryResponse>;

export interface GscReadPaging {
  readonly pagesFetched: number;
  /**
   * Whether the read stopped before Search Console ran out of rows.
   *
   * True means the row set is a prefix, not the whole thing. Since non-date
   * queries come back ordered by clicks descending, the rows that get cut are
   * the low-click ones — which for a CTR gap table is exactly the population
   * being looked for. Anything computed from a truncated read has to say so.
   */
  readonly truncated: boolean;
}
