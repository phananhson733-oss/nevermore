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
  // Sibling sites of Stack Exchange, each its own registrable domain, so the
  // suffix above does not reach them: a Super User question page was
  // unclassified while the identical page on stackexchange.com was a forum.
  "superuser.com",
  "serverfault.com",
  "askubuntu.com",
  "stackoverflow.com",
  // Only the forum subdomain. macrumors.com itself publishes news, and a set
  // that matches by suffix would turn its reporting into forum threads.
  "forums.macrumors.com",
  "xda-developers.com",
  "zhihu.com",
  "ptt.cc",
  "dcard.tw",
  "v2ex.com",
  "mobile01.com",
]);
export const COMMERCE_HOSTS: ReadonlySet<string> = new Set([
  "amazon.com", "ebay.com", "walmart.com", "etsy.com", "bestbuy.com", "homedepot.com",
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
  // A medical encyclopedia is an encyclopedia. Its articles were unclassified.
  "medlineplus.gov",
]);

/**
 * Hosts inside a commerce suffix that do not sell anything.
 *
 * COMMERCE_HOSTS matches by suffix, so every subdomain of a shop is a shop:
 * aws.amazon.com and docs.aws.amazon.com are Amazon's cloud documentation and
 * every one of their pages, "What is an API?" included, read as a product page.
 * An exception is only checked against the commerce set, so it cannot suppress
 * any other rule.
 */
const COMMERCE_HOST_EXCEPTIONS: ReadonlySet<string> = new Set([
  "aws.amazon.com", "docs.aws.amazon.com", "developer.amazon.com",
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

function commerceHostRule(id: string): FormatMatcher {
  return { id, format: "product_page", matches: ({ host }) => hostIn(host, COMMERCE_HOSTS) && !hostIn(host, COMMERCE_HOST_EXCEPTIONS) };
}

function pathRule(id: string, format: ClassifiedSerpFormat, needle: string): FormatMatcher {
  return { id, format, matches: ({ path }) => path !== null && path.includes(needle) };
}

function titleRule(id: string, format: ClassifiedSerpFormat, pattern: RegExp): FormatMatcher {
  return { id, format, matches: ({ title }) => title !== null && pattern.test(title) };
}

/**
 * The words with which a title calls the page a calculator, one source for the
 * rules that read them and for the rules that must stand down in front of them.
 */
const CALCULATOR_EN = String.raw`\bcalculator\b`;
const CALCULATOR_ZH = String.raw`计算器|計算器|生成器|產生器`;

/**
 * `pattern`, but only where no calculator word comes before it in the title.
 *
 * "What Is a Birth Chart Calculator?" is an article about a calculator and
 * "Free Moon Sign Calculator -- What Is My Moon Sign?" is the calculator, and
 * the two differ only in which word arrives first: a title names the page and
 * then says something about it. This is what lets the question rules keep the
 * first without taking the second, and it is the reason the vocabulary above is
 * shared rather than written out twice.
 */
function unlessAfterCalculator(word: string, pattern: string): RegExp {
  return new RegExp(String.raw`^(?:(?!${word}).)*(?:${pattern})`, "u");
}

const FORMAT_MATCHERS: readonly FormatMatcher[] = [
  hostRule("host:video", "video", VIDEO_HOSTS),
  hostRule("host:forum", "forum", FORUM_HOSTS),
  commerceHostRule("host:commerce"),
  // host:news is last, not here. A news publisher is not a format: the same
  // four hosts carry recipes, explainers, round-ups, sport references and eight
  // daily puzzles, and while the host decided first, every one of them was
  // news. A census of 67 confirmed headlines from these hosts, real titles
  // fetched from the live pages, says the trade plainly: 18 rows classified
  // correctly with the host deciding first, 25 with it deciding last. Of the 15
  // that really were news, 13 stayed right and one moved, which is the shape to
  // expect -- a dated report rarely says "best" or "how to" in its headline,
  // and when it does it reads like the thing it says.
  hostRule("host:encyclopedia", "guide", ENCYCLOPEDIA_HOSTS),
  pathRule("path:videos", "video", "/videos/"),
  // There is no /watch/ rule. It reads as a video only because YouTube uses
  // that path, and YouTube is a video host already, so the rule could only ever
  // fire somewhere else -- where it read apple.com/watch/ as a video.
  pathRule("path:reels", "video", "/reels/"),
  pathRule("path:compare", "comparison", "/compare/"),
  pathRule("path:vs", "comparison", "/vs/"),
  pathRule("path:tools", "tool", "/tools/"),
  pathRule("path:calculator", "tool", "/calculator"),
  pathRule("path:forum", "forum", "/forum/"),
  pathRule("path:community", "forum", "/community/"),
  pathRule("path:product", "product_page", "/product/"),
  // Plural, and separate: /products/ is where a store keeps the things it
  // sells, and calculators and generators are things that are sold. A live
  // check found a 13,000 watt petrol generator and a Keysight waveform
  // generator both read as online tools, one by its slug and one by its
  // Chinese title. Deciding commerce first is what the singular rule already
  // does; this only covers the shape that is far more common.
  pathRule("path:products", "product_page", "/products/"),
  pathRule("path:pricing", "product_page", "/pricing"),
  // One to a hundred. Past that a leading number is nearly always an identifier
  // rather than a count, and US finance is full of them: "529 Plan", "457
  // Plan", "1031 Exchange Rules", "1040 Tax Calculator", "1099 Tax Calculator"
  // are a guide, a guide, a guide and two tools, and every one of them read as
  // a list of several hundred items. Excluding only the year range was tried
  // first and caught none of them. The bound loses a real "1000 Questions to
  // ask people", which falls to whatever else its title says and is reported
  // as unclassified if nothing does -- no answer where the alternative was a
  // wrong one.
  //
  // A unit of time after the number is a measurement, not a count of items:
  // "12 Weeks Pregnant" and "10 Minute Mail" are a guide and a tool, and both
  // read as lists. This costs a real "30 Days to Better Sleep", which becomes
  // unclassified rather than a list -- the same trade in the same direction.
  titleRule("title:leading_number", "listicle", /^(?:\d{1,2}|100) (?!(?:second|minute|hour|day|week|month|year)s?\b)/),
  // Above "best", which it used to sit under: "How to get the best mortgage
  // rate" is a how-to that happens to say best, not a round-up.
  titleRule("title:how_to", "guide", unlessAfterCalculator(CALCULATOR_EN, String.raw`\bhow to `)),
  titleRule("title:best", "listicle", /\bbest /),
  titleRule("title:top_n", "listicle", /\btop \d+/),
  // Below the round-up titles, which is where a blog's own round-ups need them:
  // "The 8 best project management software" and "Top 10 Horoscope Apps 2026"
  // both live under /blog/ and both read as guides while these decided first.
  // A blog post that makes no list of itself still reaches them and is one.
  pathRule("path:blog", "guide", "/blog/"),
  pathRule("path:guide", "guide", "/guide/"),
  pathRule("path:learn", "guide", "/learn/"),
  titleRule("title:what_is", "guide", unlessAfterCalculator(CALCULATOR_EN, String.raw`\bwhat is `)),
  titleRule("title:guide", "guide", /guide/),
  titleRule("title:explained", "guide", /\bexplained\b/),
  // timeanddate.com's "FAQ: Time Duration Calculator" is the help page for the
  // calculator, not the calculator. FAQ names the page's kind as plainly as
  // "explained" does, so it decides in the same place.
  titleRule("title:faq", "guide", /\bfaq\b/),
  // No \b here: JavaScript word boundaries are ASCII-based and never fall
  // between two Han characters, so a boundary would make these never match.
  // 什么是X is the ordinary way to ask, and it was missing: only the postposed
  // X是什么 matched, so AWS's "什么是 API？" and most Chinese explainers were
  // unclassified. The preposed form puts the question first, which is exactly
  // where the rule above wants it.
  titleRule("title:zh_what_is", "guide", unlessAfterCalculator(CALCULATOR_ZH, String.raw`是什么|是什麼|什么是|什麼是|什么意思|什麼意思`)),
  // 教程 and 攻略 name a kind of writing, so they hold wherever they appear: a
  // Chinese Tkinter 教程 that builds a calculator is a tutorial even though it
  // says 计算器 first. 怎么 / 如何 open a question, and a question a calculator
  // asks after naming itself is its subtitle -- "上升星座查詢計算器 |
  // 上升星座是什麼？怎麼看？" is the calculator.
  titleRule("title:zh_tutorial", "guide", /教程|攻略/u),
  titleRule("title:zh_how_to", "guide", unlessAfterCalculator(CALCULATOR_ZH, String.raw`怎么|怎麼|如何`)),
  titleRule("title:zh_dates", "guide", /时间表|時間表|日期表/u),
  titleRule("title:zh_best", "listicle", /推荐排行|推薦排行|排行榜/u),
  // The words that name a kind of page decide above these -- how-to, what-is,
  // guide, explained, FAQ, a round-up, 教程, 是什么 -- and so do the article and
  // commerce paths. What reaches these rules is mostly a page that names a
  // calculator and nothing else. Mostly, not always: the table reads a title
  // and a URL, so a help page that calls itself none of those words still
  // arrives here looking like the calculator it is about.
  // Before these rules the table read /calculator/ only as a directory and
  // never read the title at all, so a live SERP of pages titled "Birth Chart
  // Calculator" came back seven tenths unclassified.
  //
  // Their first home was above the topic words, to keep "Pregnancy Due Dates
  // Calculator" from reading as a page about dates. That cost more than it
  // bought: "Mortgage calculator explained" and a Chinese Tkinter 教程 both
  // became tools. Only "dates" follows them down, below.
  //
  // There is no English generator rule, and no title here matches on the word:
  // a generator is as often a machine as a program, so such a rule would read
  // Honda's "Generator Engines" as a tool, and no lexical test separates that
  // from "Sequence Generator" -- "portable generator" defeats every one that
  // suggests itself. RANDOM.ORG's sequence generator is therefore unclassified
  // rather than wrong.
  //
  // 生成器 / 產生器 are not the clean case they look like either: 發電機 is the
  // power generator, but 函數產生器 and 波形產生器 are laboratory instruments
  // Keysight sells. They stay, because the software sense dominates a content
  // SERP, and the commerce paths above are what keep the instruments out.
  //
  // 計算機 is left out although Traditional Chinese does use it for a
  // calculator: it is also the word for a computer, and would read
  // 計算機科學導論 as a tool. That under-matches BMI計算機, which now shows up
  // as a page the sample could not classify rather than one it got wrong.
  titleRule("title:calculator", "tool", new RegExp(CALCULATOR_EN, "u")),
  titleRule("title:zh_calculator", "tool", new RegExp(CALCULATOR_ZH, "u")),
  // Below them, unlike the words above: "dates" and "meaning" name what a page
  // is about, not what kind of page it is, and one that also says "calculator"
  // is the calculator. timeanddate.com classified its own duration calculator
  // as a guide and its FAQ about that calculator as a tool, exactly inverted,
  // and "Angel Number Calculator -- Meaning of Repeating Numbers" is a number
  // input with computed output. What is still lost this way is an article whose
  // only mark is one of these two words, such as an explanation of what a
  // calculator's result means; every other kind of explainer decides above.
  titleRule("title:dates", "guide", /\bdates\b/),
  titleRule("title:meaning", "guide", /\bmeaning\b/),
  // And "vs" with them, in both the title and the slug. "Rent vs. Buy
  // Calculator" is an input form that computes an answer; what it compares is
  // its subject. Left above, the whole rent-vs-buy, lease-vs-buy and
  // Roth-vs-traditional family read as editorial comparisons, and a SERP made
  // entirely of calculators reported commercial intent instead of a tool one.
  titleRule("title:vs", "comparison", / vs\.? /),
  pathRule("path:-vs-", "comparison", "-vs-"),
  // Terminal, and last of all: directoryPath appends a trailing slash, so
  // "-calculator/" ends a segment and /mortgage-calculator-review stays out,
  // while /birth-chart-calculator never contained the /calculator/ segment.
  pathRule("path:-calculator", "tool", "-calculator/"),
  pathRule("path:-generator", "tool", "-generator/"),
  // The fallback described at the top of the table: whatever a news host
  // publishes, if nothing else in the title or the path says what kind of page
  // it is, it is news.
  hostRule("host:news", "news", NEWS_HOSTS),
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
