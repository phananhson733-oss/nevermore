/**
 * Site profile signals and the sample AI profile (jsx:1142-1169). Nothing here
 * was observed: `crawlSignals` is generated, so its H1 says it was not crawled
 * (R10), and the crawl and third-party variants draw from different seeds.
 * `gscSignals` reads only the rows it is given. `demoAiDoc` replaces the
 * prototype's `DEMO_AI` (GenGrowth's own facts, R8): the summary is made of
 * profile values and every other field is a pending bracket placeholder.
 */
import type { AiDoc, CrawlSignals, GscRow, GscSignals, IcpSegment, Profile } from "../types.ts";
import { sitePages } from "./audit.ts";
import { gscStatus } from "./gsc.ts";
import { marketLanguage } from "./market.ts";
import { pick, rngOf, seedKey } from "./rng.ts";
import { domainOf, splitList, matchesBrand } from "./text.ts";

export type CrawlVariant = "crawl" | "third";

export const BRAND_PLACEHOLDER = "[品牌]";
const STACKS = ["Next.js", "Webflow", "Astro", "WordPress"] as const;
const TOP_QUERY_LIMIT = 5;
const ICP_SEGMENT_COUNT = 3;
const PILLAR_MIN = 2;
const PILLAR_MAX = 3;

/** The brand as typed, or `[品牌]` when it is blank. */
export function brandOrPlaceholder(brand: string): string {
  return brand.trim() === "" ? BRAND_PLACEHOLDER : brand;
}

/**
 * A generated crawl (`crawl`) or third-party estimate (`third`) for the site.
 * `indexed` never exceeds `pages`: the profile document prints them on one line
 * ("抓到页面 N，收录约 M"), and the prototype's ranges often put M above N.
 */
export function crawlSignals(
  profile: Pick<Profile, "url" | "brand" | "market" | "features" | "competitors">,
  variant: CrawlVariant,
): CrawlSignals {
  const next = rngOf(seedKey(variant, domainOf(profile.url)));
  const pages = sitePages(profile).length + Math.floor(next() * 40);
  return {
    pages,
    lang: marketLanguage(profile.market),
    stack: pick(STACKS, next),
    h1: `[示例] ${brandOrPlaceholder(profile.brand)} 的首页 H1（未抓取）`,
    hasPricing: next() > 0.25,
    hasDocs: next() > 0.45,
    hasBlog: next() > 0.2,
    indexed: Math.max(1, Math.round(pages * (0.6 + next() * 0.4))),
    traffic: Math.round((300 + next() * 5200) / 10) * 10,
    dr: Math.floor(8 + next() * 45),
    refdomains: Math.floor(15 + next() * 260),
  };
}

/** Clicks that are unavailable add nothing to a sum and sort as 0. */
function clicksOf(row: GscRow): number {
  return row.clicks !== null && Number.isFinite(row.clicks) ? row.clicks : 0;
}

function sumClicks(rows: readonly GscRow[]): number {
  return rows.reduce((sum, row) => sum + clicksOf(row), 0);
}

/** Brand split by whole-word match (`Gen` is not `genre`), top queries by clicks, and the borderline count. */
export function gscSignals(profile: Pick<Profile, "brand">, gscRows: readonly GscRow[]): GscSignals {
  const isBrand = (row: GscRow): boolean => matchesBrand(row.query, profile.brand);
  const brandRows = gscRows.filter(isBrand);
  return {
    total: gscRows.length,
    brandQueries: brandRows.length,
    brandClicks: sumClicks(brandRows),
    nonBrandClicks: sumClicks(gscRows.filter((row) => !isBrand(row))),
    top: gscRows.toSorted((a, b) => clicksOf(b) - clicksOf(a)).slice(0, TOP_QUERY_LIMIT),
    near: gscRows.filter((row) => gscStatus(row) === "borderline").length,
  };
}

function icpPlaceholder(n: number): IcpSegment {
  return {
    seg: `[目标人群 ${n}]`,
    role: "[角色待补]",
    pain: "[痛点待补]",
    trigger: "[触发搜索的查询待补]",
    objection: "[常见顾虑待补]",
  };
}

function pillarPlaceholders(brand: string, features: readonly string[]): readonly string[] {
  const topics = [
    ...features.slice(0, PILLAR_MAX).map((feature) => `围绕 ${feature} 的主题`),
    `${brand} 的核心主题`,
    "目标人群的常见问题",
  ];
  const count = Math.min(PILLAR_MAX, Math.max(PILLAR_MIN, features.length));
  return topics.slice(0, count).map((topic, index) => `[内容支柱 ${index + 1}：${topic}（待补）]`);
}

/** A sample AI profile that states nothing the profile does not: see the file header. Fresh objects on every call. */
export function demoAiDoc(profile: Profile): AiDoc {
  const brand = brandOrPlaceholder(profile.brand);
  const features = splitList(profile.features);
  const rival = splitList(profile.competitors)[0] ?? "同类产品";
  const positioning = profile.positioning.trim() === "" ? "[一句话定位待补]" : profile.positioning;
  return {
    summary: `[示例] ${brand}：${positioning}`,
    icp: Array.from({ length: ICP_SEGMENT_COUNT }, (_, index) => icpPlaceholder(index + 1)),
    value_props: [
      `[价值主张 1：${brand} 帮目标人群解决的核心问题（待补）]`,
      `[价值主张 2：${brand} 用${features[0] ?? "核心功能"}带来的具体结果（待补）]`,
    ],
    diff: [
      `[差异点 1：${brand} 与 ${rival} 相比的不同（待补对比依据）]`,
      `[差异点 2：${brand} 明确不做的事（待补产品边界）]`,
    ],
    pillars: pillarPlaceholders(brand, features),
    facts:
      features.length > 0
        ? features.map((feature) => `[示例事实：${brand} 提供 ${feature}，需补证据与核对日期]`)
        : [`[示例事实：${brand} 的核心能力待补]`],
    tone: "[语气待定：先给结论再给理由]",
  };
}
