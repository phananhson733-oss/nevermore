import type { RuleId } from "./rule.ts";

/**
 * Deterministic finding summaries (spec §8.7). Every finding must have a non-empty
 * summary; the default is a deterministic en / zh-CN template (no model). A later
 * WP may overwrite with an LLM `finding_summary` for other output locales, but the
 * deterministic template is the always-available fallback (`summaryLocale=en`).
 */

export type SummaryLocale = "en" | "zh-CN";

type Args = Record<string, string | number>;

export const SUMMARY_ARG_KEYS = {
  "TECH-HTTP-001": ["count", "status"],
  "TECH-CANONICAL-002": ["subtype", "count"],
  "TECH-INDEXABILITY-006": ["url"],
  "TECH-LINKGRAPH-005": ["affectedCount"],
  "SEARCH-CTR-004": ["ctr", "position"],
  "SEARCH-DECAY-002": ["delta"],
  "CONTENT-COVERAGE-001": ["kind", "target"],
  "CONTENT-GAP-011": ["clusterKey", "keywordCount"],
  "CRO-PATH-001": ["affectedCount"],
  "CRO-LANDING-003": ["pageRate", "baseline"],
  "GEO-ENTITY-001": ["selectedCount"],
  "GEO-CRAWLER-002": ["userAgent", "scope"],
} as const satisfies Readonly<Record<RuleId, readonly string[]>>;

function assertCompleteSummaryArgs(ruleId: RuleId, args: Args): void {
  for (const key of SUMMARY_ARG_KEYS[ruleId]) {
    const value = args[key];
    const valid =
      typeof value === "number"
        ? Number.isFinite(value)
        : typeof value === "string" && value.trim().length > 0;
    if (!valid) {
      throw new Error(`Invalid summary argument for ${ruleId}: ${key}`);
    }
  }
}

function n(args: Args, key: string): number {
  const v = args[key];
  return typeof v === "number" ? v : 0;
}
function s(args: Args, key: string): string {
  const v = args[key];
  return v === undefined ? "" : String(v);
}

function linkgraphSummary(args: Args, locale: SummaryLocale): string {
  const count = n(args, "affectedCount");
  switch (s(args, "kind")) {
    case "low_inbound":
      return locale === "zh-CN"
        ? `${count} 个可收录非首页在冻结抓取中只有 0–1 个内部入链。`
        : `${count} indexable non-home page(s) have only 0–1 observed internal inlink(s).`;
    case "deep_page":
      return locale === "zh-CN"
        ? `${count} 个可收录页面在冻结抓取中的观测深度至少为 3。`
        : `${count} indexable page(s) were observed at crawl depth 3 or deeper.`;
    case "unresolved_target":
      return locale === "zh-CN"
        ? `${count} 个来源页面链接到了本次冻结抓取未解析的内部目标。`
        : `${count} source page(s) link to internal targets unresolved by the frozen crawl.`;
    default:
      // Historical TECH-LINKGRAPH-005@2 replay has no kind argument.
      return locale === "zh-CN"
        ? `${count} 个商业页面的内部入链少于两个。`
        : `${count} commercial page(s) have fewer than two internal inlinks.`;
  }
}

const TEMPLATES: Record<RuleId, Record<SummaryLocale, (a: Args) => string>> = {
  "TECH-HTTP-001": {
    en: (a) => `${n(a, "count")} page(s) return HTTP ${s(a, "status")}, blocking users and crawlers.`,
    "zh-CN": (a) => `${n(a, "count")} 个页面返回 HTTP ${s(a, "status")}，阻挡用户与爬虫。`,
  },
  "TECH-CANONICAL-002": {
    en: (a) => `Canonical conflicts detected (${s(a, "subtype")}) affecting ${n(a, "count")} page(s).`,
    "zh-CN": (a) => `检测到 canonical 冲突（${s(a, "subtype")}），影响 ${n(a, "count")} 个页面。`,
  },
  "TECH-INDEXABILITY-006": {
    en: (a) =>
      `${s(a, "url")} is listed in the sitemap but was observed with a page-level non-indexable signal.`,
    "zh-CN": (a) =>
      `${s(a, "url")} 已列入 Sitemap，但观测到页面级不可索引信号。`,
  },
  "TECH-LINKGRAPH-005": {
    en: (a) => linkgraphSummary(a, "en"),
    "zh-CN": (a) => linkgraphSummary(a, "zh-CN"),
  },
  "SEARCH-CTR-004": {
    en: (a) => `A ranking page has CTR ${s(a, "ctr")} below the benchmark for position ${s(a, "position")}.`,
    "zh-CN": (a) => `某排名页面点击率 ${s(a, "ctr")} 低于位置 ${s(a, "position")} 的基准。`,
  },
  "SEARCH-DECAY-002": {
    en: (a) => `Clicks fell ${s(a, "delta")} versus the previous 28 days for a page with prior demand.`,
    "zh-CN": (a) => `某有历史需求的页面点击量较前 28 天下降 ${s(a, "delta")}。`,
  },
  "CONTENT-COVERAGE-001": {
    en: (a) => `No indexable page covers the priority ${s(a, "kind")} "${s(a, "target")}".`,
    "zh-CN": (a) => `没有可收录页面覆盖优先${s(a, "kind")}“${s(a, "target")}”。`,
  },
  "CONTENT-GAP-011": {
    en: (a) => `Keyword cluster "${s(a, "clusterKey")}" (${n(a, "keywordCount")} keywords) has no matching page.`,
    "zh-CN": (a) => `关键词簇“${s(a, "clusterKey")}”（${n(a, "keywordCount")} 个词）没有匹配页面。`,
  },
  "CRO-PATH-001": {
    en: (a) => `${n(a, "affectedCount")} commercial page(s) have no direct link to a conversion destination.`,
    "zh-CN": (a) => `${n(a, "affectedCount")} 个商业页面没有直达转化目标的链接。`,
  },
  "CRO-LANDING-003": {
    en: (a) => `A landing page converts (${s(a, "pageRate")}) well below the site baseline (${s(a, "baseline")}).`,
    "zh-CN": (a) => `某落地页转化率（${s(a, "pageRate")}）远低于站点基线（${s(a, "baseline")}）。`,
  },
  "GEO-ENTITY-001": {
    en: (a) => `${n(a, "selectedCount")} priority page(s) lack entity coverage or proof blocks for AI citability.`,
    "zh-CN": (a) => `${n(a, "selectedCount")} 个优先页面缺少实体覆盖或佐证块，影响 AI 可引用性。`,
  },
  "GEO-CRAWLER-002": {
    en: (a) => `robots.txt disallows the AI crawler ${s(a, "userAgent")} (${s(a, "scope")}).`,
    "zh-CN": (a) => `robots.txt 禁止 AI 爬虫 ${s(a, "userAgent")}（${s(a, "scope")}）。`,
  },
};

/** Build the deterministic summary for a finding in the delivery locale. */
export function buildSummary(
  ruleId: RuleId,
  titleArgs: Record<string, string | number>,
  deliveryLocale: string,
): { summary: string; summaryLocale: SummaryLocale } {
  assertCompleteSummaryArgs(ruleId, titleArgs);
  const locale: SummaryLocale =
    deliveryLocale.toLowerCase() === "zh-cn" ? "zh-CN" : "en";
  const summary = TEMPLATES[ruleId][locale](titleArgs);
  return { summary, summaryLocale: locale };
}
