// @input  -- one SERP row (url / title / domain), or the classified rows plus the primary keyword
// @output -- a SerpFormat / Intent with the ordered rule ids that fired
// @pos    -- handoff §4.6 ordered rule tables; the UI prints FORMAT_RULES / INTENT_RULES verbatim
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { NAVIGATIONAL_BRAND_MIN_CHARS } from "./constants.ts";
import type { ClassifiedSerpFormat, SerpFormat } from "./contract.ts";

/* ------------------------------------------------------------------ */
/* host sets (suffix match on the registrable host, www. stripped)     */
/* ------------------------------------------------------------------ */

export const VIDEO_HOSTS: ReadonlySet<string> = new Set([
  "youtube.com", "vimeo.com", "tiktok.com", "instagram.com", "bilibili.com", "dailymotion.com",
]);
export const FORUM_HOSTS: ReadonlySet<string> = new Set([
  "reddit.com",
  "quora.com",
  "stackexchange.com",
  "stackoverflow.com",
  "zhihu.com",
  "ptt.cc",
  "dcard.tw",
  "v2ex.com",
  "mobile01.com",
]);
export const COMMERCE_HOSTS: ReadonlySet<string> = new Set([
  "amazon.com", "ebay.com", "walmart.com", "etsy.com",
  "shopee.com", "shopee.tw", "taobao.com", "tmall.com", "jd.com", "momoshop.com.tw", "pchome.com.tw",
  // An app marketplace lists software the way a shop lists goods, and its
  // listing for a calculator is a product page, not the calculator.
  "apps.microsoft.com", "apps.apple.com", "play.google.com",
]);
export const NEWS_HOSTS: ReadonlySet<string> = new Set(["nytimes.com", "bbc.com", "reuters.com", "theguardian.com"]);
/**
 * Encyclopedias classify as guides.
 *
 * The format vocabulary is closed and has no "reference" value, and adding one
 * is a contract change. A dictionary or encyclopedia article is an explainer,
 * which is what "guide" means here, and the rule id the page prints says
 * exactly what was recognised — so the reader is not told the page is a blog
 * post. Before this, every Baidu Baike and Wikipedia result was "unknown",
 * which is how a Chinese run ended up with two thirds of its results
 * unclassified and the observed format distribution meaningless.
 */
export const ENCYCLOPEDIA_HOSTS: ReadonlySet<string> = new Set([
  "wikipedia.org", "wiktionary.org", "baike.baidu.com", "britannica.com", "wikiwand.com",
]);

function normalizeHost(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function hostIn(host: string, hosts: ReadonlySet<string>): boolean {
  return [...hosts].some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

/* ------------------------------------------------------------------ */
/* format rules                                                        */
/* ------------------------------------------------------------------ */

export interface FormatRule {
  readonly id: string;
  readonly format: ClassifiedSerpFormat;
}

export interface SerpFormatInput {
  readonly url: string | null;
  readonly title: string | null;
  readonly domain: string;
}

interface NormalizedSerpInput {
  readonly host: string;
  /** Lowercased pathname with a trailing slash so `/compare` reads like `/compare/`; null when absent or unparsable. */
  readonly path: string | null;
  readonly title: string | null;
}

interface FormatMatcher extends FormatRule {
  readonly matches: (input: NormalizedSerpInput) => boolean;
}

function hostRule(id: string, format: ClassifiedSerpFormat, hosts: ReadonlySet<string>): FormatMatcher {
  return { id, format, matches: ({ host }) => hostIn(host, hosts) };
}

function pathRule(id: string, format: ClassifiedSerpFormat, needle: string): FormatMatcher {
  return { id, format, matches: ({ path }) => path !== null && path.includes(needle) };
}

function titleRule(id: string, format: ClassifiedSerpFormat, pattern: RegExp): FormatMatcher {
  return { id, format, matches: ({ title }) => title !== null && pattern.test(title) };
}

const FORMAT_MATCHERS: readonly FormatMatcher[] = [
  hostRule("host:video", "video", VIDEO_HOSTS),
  hostRule("host:forum", "forum", FORUM_HOSTS),
  hostRule("host:commerce", "product_page", COMMERCE_HOSTS),
  hostRule("host:news", "news", NEWS_HOSTS),
  hostRule("host:encyclopedia", "guide", ENCYCLOPEDIA_HOSTS),
  pathRule("path:videos", "video", "/videos/"),
  pathRule("path:watch", "video", "/watch/"),
  pathRule("path:reels", "video", "/reels/"),
  pathRule("path:compare", "comparison", "/compare/"),
  pathRule("path:vs", "comparison", "/vs/"),
  pathRule("path:-vs-", "comparison", "-vs-"),
  pathRule("path:tools", "tool", "/tools/"),
  pathRule("path:calculator", "tool", "/calculator"),
  pathRule("path:forum", "forum", "/forum/"),
  pathRule("path:community", "forum", "/community/"),
  pathRule("path:blog", "guide", "/blog/"),
  pathRule("path:guide", "guide", "/guide/"),
  pathRule("path:learn", "guide", "/learn/"),
  // Below /blog/, /guide/ and /learn/, because an article about a calculator
  // keeps the calculator's name in its own slug. The trailing slash is what
  // makes these terminal: directoryPath appends one, so "-calculator/" ends a
  // segment and /mortgage-calculator-review stays out. /birth-chart-calculator
  // never contained the /calculator/ segment above.
  pathRule("path:-calculator", "tool", "-calculator/"),
  pathRule("path:-generator", "tool", "-generator/"),
  pathRule("path:product", "product_page", "/product/"),
  pathRule("path:pricing", "product_page", "/pricing"),
  // Up to three digits: a leading 2026 is a year, and "2026 Salary Calculator"
  // was read as a list of two thousand items.
  titleRule("title:leading_number", "listicle", /^\d{1,3} /),
  titleRule("title:best", "listicle", /\bbest /),
  titleRule("title:top_n", "listicle", /\btop \d+/),
  titleRule("title:vs", "comparison", / vs\.? /),
  titleRule("title:how_to", "guide", /\bhow to /),
  titleRule("title:what_is", "guide", /\bwhat is /),
  titleRule("title:guide", "guide", /guide/),
  // Below the rules that mark an article ABOUT a thing -- a how-to, a
  // what-is, a round-up, a guide all keep the page -- and above the weaker
  // topic words, so "Pregnancy Due Dates Calculator" is the calculator it is
  // rather than a page about dates. Before this the table read /calculator/
  // only as a directory and never read the title at all, so a live SERP of
  // pages titled "Birth Chart Calculator" came back seven-tenths unknown.
  //
  // There is no English generator rule to match: a generator is as often a
  // machine as a program, and "Generator Engines" is a catalogue. The slug
  // form below is the narrower claim and carries that case alone.
  titleRule("title:calculator", "tool", /\bcalculator\b/),
  // 生成器 / 產生器 are unambiguous where the English is not; a physical
  // generator is 發電機. 計算機 is left out although Traditional Chinese does
  // use it for a calculator, because it is also the word for a computer and
  // would read 計算機科學導論 as a tool. That under-matches BMI計算機, which
  // now shows up as a page the sample could not classify rather than as one
  // it classified wrongly.
  titleRule("title:zh_calculator", "tool", /计算器|計算器|生成器|產生器/u),
  titleRule("title:meaning", "guide", /\bmeaning\b/),
  titleRule("title:explained", "guide", /\bexplained\b/),
  titleRule("title:dates", "guide", /\bdates\b/),
  // No \b here: JavaScript word boundaries are ASCII-based and never fall
  // between two Han characters, so a boundary would make these never match.
  titleRule("title:zh_what_is", "guide", /是什么|是什麼|什么意思|什麼意思/u),
  titleRule("title:zh_how_to", "guide", /怎么|怎麼|如何|教程|攻略/u),
  titleRule("title:zh_dates", "guide", /时间表|時間表|日期表/u),
  titleRule("title:zh_best", "listicle", /推荐排行|推薦排行|排行榜/u),
];

/** The ordered rule table, id + format only, for the page to print. */
export const FORMAT_RULES: readonly FormatRule[] = FORMAT_MATCHERS.map(({ id, format }) => ({ id, format }));

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function directoryPath(parsed: URL): string {
  const pathname = parsed.pathname.toLowerCase();
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

/**
 * The url is the authority for the host: the provider's `domain` field is only
 * trusted when there is no url at all. An unparsable url yields no host, so no
 * host rule (format or navigational) can fire on a domain the url does not
 * vouch for.
 */
function hostOf(url: string | null, domain: string, parsed: URL | null): string {
  if (url === null) return normalizeHost(domain);
  return parsed === null ? "" : normalizeHost(parsed.hostname);
}

function normalizeSerpInput(input: SerpFormatInput): NormalizedSerpInput {
  const parsed = input.url === null ? null : parseUrl(input.url);
  return {
    host: hostOf(input.url, input.domain, parsed),
    path: parsed === null ? null : directoryPath(parsed),
    // NFKC first: a full-width title would otherwise miss every rule below.
    title: input.title === null ? null : input.title.normalize("NFKC").toLowerCase(),
  };
}

/** First hit is the value; every hit, in table order, goes to rules_hit. No hit → unknown. */
export function classifySerpFormat(input: SerpFormatInput): { value: SerpFormat; rules_hit: string[] } {
  const normalized = normalizeSerpInput(input);
  const hits = FORMAT_MATCHERS.filter((rule) => rule.matches(normalized));
  return { value: hits[0]?.format ?? "unknown", rules_hit: hits.map((rule) => rule.id) };
}

/* ------------------------------------------------------------------ */
/* intent rules                                                        */
/* ------------------------------------------------------------------ */

export type Intent = "informational" | "commercial" | "transactional" | "navigational";

export interface IntentRow {
  readonly rank: number;
  readonly format: SerpFormat;
  readonly title: string | null;
  readonly domain: string;
  /** Authority for the host, exactly as in classifySerpFormat; domain is the fallback only when null. */
  readonly url: string | null;
}

export interface IntentRule {
  readonly id: string;
  readonly intent: Intent;
}

interface IntentContext {
  readonly row: IntentRow;
  /** Primary keyword NFKC-lowercased and split on anything that is not a letter or digit. */
  readonly keywordTokens: readonly string[];
}

interface IntentMatcher extends IntentRule {
  readonly matches: (context: IntentContext) => boolean;
}

/** Second-level labels that are part of the public suffix, not the brand (example.co.uk → example). */
const SECOND_LEVEL_SUFFIX_LABELS: ReadonlySet<string> = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);

/**
 * The registrable label of a host: the label before the TLD, or before a
 * co/com/... second-level suffix (blog.acme.co.uk → acme). No length floor
 * here; callers apply NAVIGATIONAL_BRAND_MIN_CHARS themselves.
 */
export function registrableLabel(host: string): string | null {
  const labels = normalizeHost(host).split(".");
  if (labels.length < 2) return null;
  const withoutTld = labels.slice(0, -1);
  const last = withoutTld[withoutTld.length - 1];
  const label =
    withoutTld.length >= 2 && last !== undefined && SECOND_LEVEL_SUFFIX_LABELS.has(last)
      ? withoutTld[withoutTld.length - 2]
      : last;
  return label === undefined || label === "" ? null : label;
}

function compact(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function keywordTokensOf(keyword: string): readonly string[] {
  return keyword
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== "");
}

/**
 * The brand must equal one keyword token or the concatenation of adjacent
 * tokens ("hub spot" → "hubspot"). Never an arbitrary substring: art.com must
 * not turn "cart software" navigational.
 */
function brandInKeyword(brand: string, tokens: readonly string[]): boolean {
  return tokens.some((_, start) => {
    let joined = "";
    for (let end = start; end < tokens.length && joined.length < brand.length; end += 1) {
      joined += tokens[end] ?? "";
      if (joined === brand) return true;
    }
    return false;
  });
}

/** Brand of a SERP row under the same host authority as the format rules, or null when too short to be one. */
function brandOf(row: IntentRow): string | null {
  const host = hostOf(row.url, row.domain, row.url === null ? null : parseUrl(row.url));
  const label = registrableLabel(host);
  return label === null || label.length < NAVIGATIONAL_BRAND_MIN_CHARS ? null : label;
}

function formatRule(id: string, intent: Intent, format: ClassifiedSerpFormat): IntentMatcher {
  return { id, intent, matches: ({ row }) => row.format === format };
}

const INTENT_MATCHERS: readonly IntentMatcher[] = [
  {
    id: "intent:navigational",
    intent: "navigational",
    matches: ({ row, keywordTokens }) => {
      const brand = brandOf(row);
      return brand !== null && brandInKeyword(compact(brand), keywordTokens);
    },
  },
  formatRule("intent:commercial_listicle", "commercial", "listicle"),
  formatRule("intent:commercial_comparison", "commercial", "comparison"),
  formatRule("intent:informational_guide", "informational", "guide"),
  formatRule("intent:informational_forum", "informational", "forum"),
  formatRule("intent:informational_video", "informational", "video"),
  formatRule("intent:transactional_product_page", "transactional", "product_page"),
  formatRule("intent:transactional_tool", "transactional", "tool"),
];

/** The ordered rule table, id + intent only, for the page to print. */
export const INTENT_RULES: readonly IntentRule[] = INTENT_MATCHERS.map(({ id, intent }) => ({ id, intent }));

export interface IntentClassification {
  readonly value: Intent;
  /** Rows whose first hit is `value`. */
  readonly matched: number;
  /** Two or more intents share the top count; value is the best-ranked leader's. */
  readonly tie: boolean;
  readonly rules_hit: string[];
}

interface RowVerdict {
  readonly intent: Intent;
  readonly hits: readonly string[];
}

function judgeRow(context: IntentContext): RowVerdict | null {
  const hits = INTENT_MATCHERS.filter((rule) => rule.matches(context));
  const first = hits[0];
  return first === undefined ? null : { intent: first.intent, hits: hits.map((rule) => rule.id) };
}

function tally(verdicts: readonly RowVerdict[]): ReadonlyMap<Intent, number> {
  return verdicts.reduce(
    (counts, { intent }) => new Map(counts).set(intent, (counts.get(intent) ?? 0) + 1),
    new Map<Intent, number>(),
  );
}

/**
 * Rows are judged in rank order; each row's first hit is its intent. The
 * value is the intent with the most rows; on a tie the best-ranked row among
 * the tied intents decides and `tie` is set. Null when no row hits any rule.
 */
export function classifyIntent(rows: readonly IntentRow[], primaryKeyword: string): IntentClassification | null {
  const keywordTokens = keywordTokensOf(primaryKeyword);
  const verdicts = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.rank - b.row.rank || a.index - b.index)
    .map(({ row }) => judgeRow({ row, keywordTokens }))
    .filter((verdict): verdict is RowVerdict => verdict !== null);
  if (verdicts.length === 0) return null;

  const counts = tally(verdicts);
  const top = Math.max(...counts.values());
  const leaders = new Set([...counts].filter(([, count]) => count === top).map(([intent]) => intent));
  const leadingRow = verdicts.find((verdict) => leaders.has(verdict.intent));
  const value = leadingRow?.intent ?? verdicts[0]!.intent;
  const rulesHit = verdicts.flatMap((verdict) => verdict.hits);
  return {
    value,
    matched: top,
    tie: leaders.size > 1,
    rules_hit: rulesHit.filter((id, index) => rulesHit.indexOf(id) === index),
  };
}
