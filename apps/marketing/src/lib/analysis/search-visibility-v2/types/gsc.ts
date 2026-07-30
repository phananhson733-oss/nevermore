// @input  -- V1.3 §10.2 GSC connector 类型族
// @output -- GscSearchType / GscDevice / GscPropertyType / GscQueryParams / GscMetricRow / GscFetchResult / GscBundle
// @pos    -- types/ 拆分，依赖 DataQualityWarning（data-quality 模块）

import type { DataQualityWarning } from "./data-quality";

export type GscSearchType =
  | "web"
  | "image"
  | "video"
  | "news"
  | "discover"
  | "googleNews";

export type GscDevice = "DESKTOP" | "MOBILE" | "TABLET";

export type GscPropertyType = "url_prefix" | "domain";

export interface GscQueryParams {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: (
    | "date"
    | "query"
    | "page"
    | "country"
    | "device"
    | "searchAppearance"
  )[];
  type: GscSearchType;
  rowLimit: number;
  startRow: number;
  maxRows: number;
  queryId: string;
  aggregationType?: "auto" | "byPage" | "byProperty";
}

export interface GscMetricRow {
  projectId: string;
  runId: string;
  period: "current" | "previous" | "extended";
  searchType: GscSearchType;
  dimensions: string[];
  keys: string[];
  date?: string;
  query?: string;
  page?: string;
  country?: string;
  device?: GscDevice;
  searchAppearance?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  source: "GSC";
}

export interface GscFetchResult {
  rows: GscMetricRow[];
  capped: boolean;
  rowCount: number;
  queryId: string;
  dataQualityWarnings: DataQualityWarning[];
}

export interface GscBundle {
  total: GscMetricRow[];
  byDate: GscMetricRow[];
  byQuery: GscMetricRow[];
  byPage: GscMetricRow[];
  byQueryPage: GscMetricRow[];
  byDevice: GscMetricRow[];
  byCountry: GscMetricRow[];
  bySearchAppearance: GscMetricRow[];
  imageTotal: GscMetricRow[];
  videoTotal: GscMetricRow[];
  newsTotal: GscMetricRow[];
  discoverTotal: GscMetricRow[];
  googleNewsTotal: GscMetricRow[];
  capped: Record<string, boolean>;
}
