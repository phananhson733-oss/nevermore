// @input  — 无
// @output — ConsentEvent / ConsentStatus / ConsentCategoryConfig 类型
// @pos    — Cookie 同意数据类型，对应 SPEC 3.17 + 4.2.18 consent_events 表
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

export type ConsentCategoryName = "necessary" | "analytics" | "marketing";

export interface ConsentCategoryConfig {
  required: boolean;
  default: boolean;
  description: string;
  cookies: string[];
}

export type ConsentCategories = Record<
  ConsentCategoryName,
  ConsentCategoryConfig
>;

export interface ConsentEvent {
  id: string;
  visitor_id: string;
  category: ConsentCategoryName;
  status: "accepted" | "rejected";
  policy_version: string;
  ip_hash?: string;
  geo_country?: string;
  locale: string;
  created_at: string;
}

export type ConsentStatus = "accepted" | "rejected" | "unknown";
