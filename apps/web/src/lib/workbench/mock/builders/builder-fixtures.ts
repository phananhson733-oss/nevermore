/**
 * Test-only literals for the artifact builder tests. Built by hand on purpose:
 * the builders must not depend on what `runAudit` / `buildRows` / `crawlSignals`
 * happen to produce, so these fixtures never call them.
 */
import type {
  AiDoc,
  AuditReport,
  Finding,
  KeywordRow,
  Profile,
  ProfileDoc,
} from "../../types.ts";

export const FIXTURE_PROFILE: Profile = {
  url: "https://acme.io",
  brand: "Acme",
  positioning: "给小团队用的 SEO 检查工具",
  features: "站点审计, 关键词矩阵",
  competitors: "Rival, Other",
  market: "US",
};

export const FIXTURE_AI: AiDoc = {
  summary: "[示例] Acme：给小团队用的 SEO 检查工具",
  icp: [
    {
      seg: "[目标人群 1]",
      role: "[角色待补]",
      pain: "[痛点待补]",
      trigger: "[触发搜索的查询待补]",
      objection: "[常见顾虑待补]",
    },
  ],
  value_props: ["[Acme 的价值主张待补]"],
  diff: ["[Acme 与竞品的差异待补]"],
  pillars: ["[围绕 站点审计 的主题待补]"],
  facts: ["[示例事实：Acme 提供 站点审计，需补证据与核对日期]"],
  tone: "[语气待定：先给结论再给理由]",
};

export const FIXTURE_DOC: ProfileDoc = {
  crawl: {
    pages: 42,
    lang: "en-US",
    stack: "Next.js",
    h1: "[示例] Acme 的首页 H1（未抓取）",
    hasPricing: true,
    hasDocs: false,
    hasBlog: true,
    indexable: 37,
    traffic: 1200,
    dr: 31,
    refdomains: 88,
  },
  third: {
    pages: 40,
    lang: "en-US",
    stack: "Next.js",
    h1: "[示例] Acme 的首页 H1（未抓取）",
    hasPricing: true,
    hasDocs: true,
    hasBlog: true,
    indexable: 35,
    traffic: 1500,
    dr: 29,
    refdomains: 77,
  },
  gsc: {
    total: 3,
    brandQueries: 1,
    brandClicks: 120,
    nonBrandClicks: 45,
    near: 2,
    top: [
      {
        query: "acme seo",
        clicks: 120,
        impressions: 900,
        ctr: 13.3,
        position: 1.2,
      },
      {
        query: "seo checklist",
        clicks: null,
        impressions: 400,
        ctr: null,
        position: null,
      },
    ],
  },
  ai: FIXTURE_AI,
  at: "2026-09-13 10:30",
};

const FINDING_A: Finding = {
  id: "FIX-01",
  cat: "抓取与索引",
  t: "sitemap 里有 404 与重定向 URL",
  sev: "high",
  eng: "seo",
  found: "sitemap.xml 中存在非 200 的 URL",
  expect: "sitemap 只列 200 且可索引的 URL",
  fix: "从 sitemap 生成逻辑里过滤非 200 页面",
  w: 9,
  page: "/",
};

const FINDING_B: Finding = {
  id: "FIX-02",
  cat: "AI 可读性",
  t: "关键论述缺数字与日期",
  sev: "low",
  eng: "both",
  found: "定价页与对比页的关键论述没有数字断言",
  expect: "关键论述带数字、日期或版本号",
  fix: "在定价页与对比页补上可核对的数字",
  w: 3,
  page: "/pricing",
};

export const FIXTURE_REPORT: AuditReport = {
  at: "2026-09-13 09:00",
  score: 72,
  findings: [FINDING_A, FINDING_B],
  crawl: {
    pages: 12,
    indexable: 11,
    blocked: 1,
    orphan: 2,
    lcp: "3.1",
    schema: 4,
    llmReadable: 6,
  },
  pageRows: [
    { url: "/", status: 200, h1: 1, hasSchema: true, lcp: "3.1", issues: 1 },
  ],
};

/** A GSC row with every GSC key, a GSC row whose numbers are null, and a generated row with none of them. */
export const FIXTURE_ROWS: readonly KeywordRow[] = [
  {
    q: "acme seo",
    seed: "",
    intent: "navigational",
    stage: "BOFU",
    page: "landing",
    engine: "seo",
    source: "gsc",
    clicks: 120,
    impressions: 900,
    position: 1.2,
    gscStatus: "ranked",
    volume: 900,
    kd: 12,
    cpc: "1.20",
    aio: false,
    score: 64,
    slug: "/acme-seo",
  },
  {
    q: "seo checklist",
    seed: "",
    intent: "informational",
    stage: "MOFU",
    page: "blog",
    engine: "both",
    source: "gsc",
    clicks: null,
    impressions: 400,
    position: null,
    gscStatus: "unknown",
    volume: 400,
    kd: 40,
    cpc: "2.10",
    aio: true,
    score: 51,
    slug: "/blog/seo-checklist",
  },
  {
    q: "how to rank",
    seed: "rank",
    intent: "informational",
    stage: "TOFU",
    page: "blog",
    engine: "seo",
    source: "generated",
    volume: 1300,
    kd: 55,
    cpc: "0.80",
    aio: false,
    score: 38,
    slug: "/blog/how-to-rank",
  },
];

export function fixtureRow(index: number): KeywordRow {
  const row = FIXTURE_ROWS[index];
  if (row === undefined) throw new Error(`no fixture row ${index}`);
  return row;
}
