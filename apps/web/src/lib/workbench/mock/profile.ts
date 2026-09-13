/**
 * Site profile signals and the sample AI profile (jsx:1142-1169). Unless an
 * audit is supplied, nothing here was observed: `crawlSignals` is generated, so
 * its H1 says it was not crawled (R10), and the crawl and third-party variants
 * draw from different seeds. `gscSignals` reads only the rows it is given, and a
 * count it cannot know is `null`, never 0. `demoAiDoc` replaces the prototype's
 * `DEMO_AI` (GenGrowth's own facts, R8): the summary is made of profile values
 * and every other field is a pending bracket placeholder.
 */
import type { AiDoc, AuditPageRow, AuditReport, CrawlSignals, GscRow, GscSignals, IcpSegment, Profile } from "../types.ts";
import { sitePages } from "./audit.ts";
import { brandOrPlaceholder } from "./brand.ts";
import { gscStatus } from "./gsc.ts";
import { enteredComparedCompetitors } from "./kb.ts";
import { marketLanguage } from "./market.ts";
import { rngOf, seedKey } from "./rng.ts";
import { domainOf, matchesBrand, splitList } from "./text.ts";

export type CrawlVariant = "crawl" | "third";
/** The parts of an audit report that can stand in for generated site shape. */
export type ObservedAudit = Pick<AuditReport, "crawl" | "pageRows">;

// Moved to brand.ts so kb.ts (and through it the client store) can use them without this
// module's audit imports; re-exported so existing importers of profile.ts are unchanged.
export { BRAND_PLACEHOLDER, brandOrPlaceholder } from "./brand.ts";
/** The sample does not know the site's framework, so it never guesses one; the fix-task artifact says the same. */
export const UNKNOWN_STACK = "[未知：先识别仓库框架]";
/** What the sample differentiator compares against when no real competitor was entered: not a name. */
const NEUTRAL_RIVAL = "同类产品";
const TOP_QUERY_LIMIT = 5;
const ICP_SEGMENT_COUNT = 3;
const PILLAR_MIN = 2;
const PILLAR_MAX = 3;

type SiteShape = Pick<CrawlSignals, "pages" | "indexed" | "hasPricing" | "hasDocs" | "hasBlog">;

interface CrawlDraws {
  readonly pages: number;
  readonly pricing: number;
  readonly docs: number;
  readonly blog: number;
  readonly indexed: number;
  readonly traffic: number;
  readonly dr: number;
  readonly refdomains: number;
}

/** Every draw in the prototype's order, taken whether or not an audit replaces some of them. */
function drawCrawl(seed: number): CrawlDraws {
  const next = rngOf(seed);
  return {
    pages: next(),
    pricing: next(),
    docs: next(),
    blog: next(),
    indexed: next(),
    traffic: next(),
    dr: next(),
    refdomains: next(),
  };
}

/** `indexed` never exceeds `pages`: the profile document prints both on one line ("抓到页面 N，收录约 M"). */
function generatedSite(profile: Pick<Profile, "url" | "brand" | "features" | "competitors">, draws: CrawlDraws): SiteShape {
  const pages = sitePages(profile).length + Math.floor(draws.pages * 40);
  return {
    pages,
    indexed: Math.max(1, Math.round(pages * (0.6 + draws.indexed * 0.4))),
    hasPricing: draws.pricing > 0.25,
    hasDocs: draws.docs > 0.45,
    hasBlog: draws.blog > 0.2,
  };
}

/** Path of an absolute or relative page-row URL, without query, fragment or trailing slash. */
function rowPath(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/)[0] ?? "";
  }
  return path.replace(/\/+$/, "") || "/";
}

/** A redirect or an error is not the page: only a row that answered 2xx counts. */
function isReachable(row: AuditPageRow): boolean {
  return row.status >= 200 && row.status < 300;
}

function observedSite(audit: ObservedAudit): SiteShape {
  const paths = audit.pageRows.filter(isReachable).map((row) => rowPath(row.url));
  return {
    pages: audit.crawl.pages,
    indexed: audit.crawl.indexable,
    hasPricing: paths.includes("/pricing"),
    hasDocs: paths.includes("/docs"),
    hasBlog: paths.some((path) => path === "/blog" || path.startsWith("/blog/")),
  };
}

/**
 * A generated crawl (`crawl`) or third-party estimate (`third`) for the site.
 * With `observed`, pages, indexed and the pricing / docs / blog flags come from
 * that audit instead, counting a page only when its row answered 2xx; traffic,
 * DR and referring domains stay generated and identical, because every draw is
 * taken either way. The stack is never guessed.
 */
export function crawlSignals(
  profile: Pick<Profile, "url" | "brand" | "market" | "features" | "competitors">,
  variant: CrawlVariant,
  observed?: ObservedAudit,
): CrawlSignals {
  const draws = drawCrawl(seedKey(variant, domainOf(profile.url)));
  const site = observed === undefined ? generatedSite(profile, draws) : observedSite(observed);
  return {
    pages: site.pages,
    lang: marketLanguage(profile.market),
    stack: UNKNOWN_STACK,
    h1: `[示例] ${brandOrPlaceholder(profile.brand)} 的首页 H1（未抓取）`,
    hasPricing: site.hasPricing,
    hasDocs: site.hasDocs,
    hasBlog: site.hasBlog,
    indexed: site.indexed,
    traffic: Math.round((300 + draws.traffic * 5200) / 10) * 10,
    dr: Math.floor(8 + draws.dr * 45),
    refdomains: Math.floor(15 + draws.refdomains * 260),
  };
}

function availableClicks(row: GscRow): number | null {
  return row.clicks !== null && Number.isFinite(row.clicks) ? row.clicks : null;
}

/**
 * 0 for no rows (a real zero); null when no row has available clicks; otherwise
 * the sum of the available clicks. When only some rows have clicks, that sum is
 * a lower bound, not the subset's total.
 */
function sumClicks(rows: readonly GscRow[]): number | null {
  if (rows.length === 0) return 0;
  const available = rows.map(availableClicks).filter((clicks): clicks is number => clicks !== null);
  return available.length === 0 ? null : available.reduce((sum, clicks) => sum + clicks, 0);
}

/** Available clicks descending, unavailable last; `toSorted` is stable, so ties keep their input order. */
function byClicks(a: GscRow, b: GscRow): number {
  const left = availableClicks(a);
  const right = availableClicks(b);
  if (left === null || right === null) return (left === null ? 1 : 0) - (right === null ? 1 : 0);
  return right - left;
}

/** Borderline rows; null when rows exist but none has an available position to check. */
function nearCount(rows: readonly GscRow[]): number | null {
  const statuses = rows.map(gscStatus);
  if (statuses.length > 0 && statuses.every((status) => status === "unknown")) return null;
  return statuses.filter((status) => status === "borderline").length;
}

/** Whole-word brand match (`Gen` is not `genre`); without a brand the split is unknowable. */
function brandSplit(brand: string, rows: readonly GscRow[]): Pick<GscSignals, "brandQueries" | "brandClicks" | "nonBrandClicks"> {
  if (brand.trim() === "") return { brandQueries: null, brandClicks: null, nonBrandClicks: null };
  const isBrand = (row: GscRow): boolean => matchesBrand(row.query, brand);
  const brandRows = rows.filter(isBrand);
  return {
    brandQueries: brandRows.length,
    brandClicks: sumClicks(brandRows),
    nonBrandClicks: sumClicks(rows.filter((row) => !isBrand(row))),
  };
}

export function gscSignals(profile: Pick<Profile, "brand">, gscRows: readonly GscRow[]): GscSignals {
  const split = brandSplit(profile.brand, gscRows);
  return {
    total: gscRows.length,
    brandQueries: split.brandQueries,
    brandClicks: split.brandClicks,
    nonBrandClicks: split.nonBrandClicks,
    top: gscRows.toSorted(byClicks).slice(0, TOP_QUERY_LIMIT),
    near: nearCount(gscRows),
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
    `${brand} 的目标人群最常问的问题`,
  ];
  const count = Math.min(PILLAR_MAX, Math.max(PILLAR_MIN, features.length));
  return topics.slice(0, count).map((topic, index) => `[内容支柱 ${index + 1}：${topic}（待补）]`);
}

/** A sample AI profile that states nothing the profile does not: see the file header. Fresh objects on every call. */
export function demoAiDoc(profile: Profile): AiDoc {
  const brand = brandOrPlaceholder(profile.brand);
  const features = splitList(profile.features);
  const rival = enteredComparedCompetitors(profile)[0] ?? NEUTRAL_RIVAL;
  const positioning = profile.positioning.trim() === "" ? "[一句话定位待补]" : profile.positioning;
  return {
    summary: `[示例] ${brand}：${positioning}`,
    icp: Array.from({ length: ICP_SEGMENT_COUNT }, (_, index) => icpPlaceholder(index + 1)),
    value_props: [
      `[价值主张 1：${brand} 帮目标人群解决的核心问题（待补）]`,
      `[价值主张 2：${brand} 用 ${features[0] ?? "核心功能"} 带来的具体结果（待补）]`,
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
