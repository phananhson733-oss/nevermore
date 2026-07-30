// @input  -- CaseStudyMetric type from case-study-metrics component
// @output -- astrologywiki case study metrics data + slug-to-metrics map
// @pos    -- case study metrics registry, consumed by blog-article-content.tsx
// once this file is updated, update header comments and _DIR.md in this folder

import type { CaseStudyMetric } from "@/components/blog/case-study-metrics";

export const ASTROLOGYWIKI_METRICS_EN: readonly CaseStudyMetric[] = [
  {
    label: "Monthly Organic Traffic",
    before: "0 users",
    after: "5,000+ users",
    change: "0 -> 5,000+",
  },
  {
    label: "Google-Indexed Pages",
    before: "12 pages",
    after: "247 pages",
    change: "+1,958%",
  },
  {
    label: "Avg. Position (Top Keywords)",
    before: "N/A",
    after: "8.3",
    change: "Unranked -> Page 1",
  },
  {
    label: "Conversion Rate (Visit -> Signup)",
    before: "0%",
    after: "3.2%",
    change: "0% -> 3.2%",
  },
];

export const ASTROLOGYWIKI_METRICS_ZH: readonly CaseStudyMetric[] = [
  {
    label: "月自然流量",
    before: "0 用户",
    after: "5,000+ 用户",
    change: "0 -> 5,000+",
  },
  {
    label: "Google 索引页面",
    before: "12 页",
    after: "247 页",
    change: "+1,958%",
  },
  {
    label: "平均排名（核心关键词）",
    before: "无排名",
    after: "8.3",
    change: "无排名 -> 首页",
  },
  {
    label: "转化率（访问 -> 注册）",
    before: "0%",
    after: "3.2%",
    change: "0% -> 3.2%",
  },
];

/**
 * Map of slug -> locale -> metrics for case study posts.
 * Used by blog-article-content.tsx to render metrics above article body.
 */
export const CASE_STUDY_METRICS_MAP: Record<
  string,
  Record<string, readonly CaseStudyMetric[]>
> = {
  "astrologywiki-zero-to-5000-users": {
    en: ASTROLOGYWIKI_METRICS_EN,
    zh: ASTROLOGYWIKI_METRICS_ZH,
  },
};
