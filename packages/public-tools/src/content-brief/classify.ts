// @input  -- one SERP row (url / title / domain), or the classified rows plus the primary keyword
// @output -- a SerpFormat / Intent with the ordered rule ids that fired
// @pos    -- handoff §4.6 ordered rule tables; the UI prints FORMAT_RULES / INTENT_RULES verbatim
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { NAVIGATIONAL_BRAND_MIN_CHARS } from "./constants.ts";
import type { ClassifiedSerpFormat, SerpFormat } from "./contract.ts";

/* ------------------------------------------------------------------ */
/* host sets (suffix match on the registrable host, www. stripped)     */
/* ------------------------------------------------------------------ */

export const VIDEO_HOSTS: ReadonlySet<string> = new Set(["youtube.com", "vimeo.com"]);
export const FORUM_HOSTS: ReadonlySet<string> = new Set([
  "reddit.com",
  "quora.com",
  "stackexchange.com",
  "stackoverflow.com",
]);
export const COMMERCE_HOSTS: ReadonlySet<string> = new Set(["amazon.com", "ebay.com", "walmart.com", "etsy.com"]);
export const NEWS_HOSTS: ReadonlySet<string> = new Set(["nytimes.com", "bbc.com", "reuters.com", "theguardian.com"]);

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
  pathRule("path:product", "product_page", "/product/"),
  pathRule("path:pricing", "product_page", "/pricing"),
  titleRule("title:leading_number", "listicle", /^\d+ /),
  titleRule("title:best", "listicle", /\bbest /),
  titleRule("title:top_n", "listicle", /\btop \d+/),
  titleRule("title:vs", "comparison", / vs\.? /),
  titleRule("title:how_to", "guide", /\bhow to /),
  titleRule("title:what_is", "guide", /\bwhat is /),
  titleRule("title:guide", "guide", /guide/),
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
    title: input.title === null ? null : input.title.toLowerCase(),
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
