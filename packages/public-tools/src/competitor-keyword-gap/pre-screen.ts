// @input  -- one merged gap row's DFS estimates, its competitor pages (row shape), and the requested competitor domains
// @output -- a deterministic pre-screen band with the single reason that decided it
// @pos    -- second, orthogonal axis next to the GSC-derived next step; an estimate, never winnability

import type {
  CompetitorKeywordGapCompetitorPage,
  CompetitorKeywordGapMetric,
  CompetitorKeywordGapPreScreen,
} from "./types.ts";
import {
  COMPETITOR_KEYWORD_GAP_KD_HEAD_MIN,
  COMPETITOR_KEYWORD_GAP_KD_LOW_MAX,
  COMPETITOR_KEYWORD_GAP_PAGE_ONE_RANK_MAX,
} from "./types.ts";

export interface CompetitorKeywordGapPreScreenInput {
  readonly keyword: string;
  readonly keywordDifficulty: CompetitorKeywordGapMetric;
  readonly searchVolume: CompetitorKeywordGapMetric;
  readonly bestCompetitorRank: number;
  readonly providerIntent: string | null;
  /** Competitor domain -> its ranking page, in the row's own shape so the seam passes it through untouched. */
  readonly competitorPages: Readonly<
    Record<string, CompetitorKeywordGapCompetitorPage>
  >;
  readonly competitorDomains: readonly string[];
}

const GENERIC_LABELS = new Set([
  "www",
  "app",
  "site",
  "web",
  "blog",
  "shop",
  "home",
]);
/** Second-level suffixes under which the registrable label sits one step further left (`example.co.uk`). */
const SECOND_LEVEL_SUFFIXES = new Set([
  "co",
  "com",
  "net",
  "org",
  "ac",
  "gov",
  "edu",
]);
/**
 * Trailing labels that make a dotted keyword a file or technology name (`robots.txt`, `node.js`), not a hostname.
 * `php` can also be read as a top-level domain; the file reading wins because `index.php` is the likelier query.
 */
const FILE_EXTENSION_LABELS = new Set([
  "txt",
  "xml",
  "js",
  "jsx",
  "ts",
  "tsx",
  "vue",
  "json",
  "html",
  "htm",
  "css",
  "pdf",
  "config",
  "csv",
  "php",
  "yaml",
  "yml",
  "md",
  "ico",
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "zip",
  "exe",
  "dmg",
  "apk",
]);
const MIN_LABELS_FOR_SECOND_LEVEL_SUFFIX = 3;
const MIN_BRAND_TOKEN_LENGTH = 3;
const MIN_PROFILE_KEYWORD_LENGTH = 3;
const COMPARATIVE_TOKENS =
  /\b(alternatives?|vs\.?|versus|competitors?|compare|comparison)\b|替代|对比|竞品|比较/i;
const HOSTNAME_SHAPE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The registrable label, read from the right: `ahrefs` for `tools.ahrefs.com`, `example` for `blog.example.co.uk`. */
function registrableLabel(domain: string): string | undefined {
  const labels = domain
    .toLowerCase()
    .split(".")
    .filter((label) => label !== "");
  const beforeTld = labels.at(-2);
  if (beforeTld === undefined) return undefined;
  const underSecondLevelSuffix =
    labels.length >= MIN_LABELS_FOR_SECOND_LEVEL_SUFFIX &&
    SECOND_LEVEL_SUFFIXES.has(beforeTld);
  return underSecondLevelSuffix ? labels.at(-3) : beforeTld;
}

/**
 * The label a person would call the competitor by: `ahrefs` for `ahrefs.com`, `seo-tools` for `seo-tools.example`.
 * An IDN competitor arrives punycoded (`xn--fiqs8s.com`) and yields a token that never matches keyword text,
 * so the brand check silently does nothing for it; the other three navigational checks still apply.
 */
export function competitorBrandTokens(
  domains: readonly string[],
): readonly string[] {
  const tokens = new Set<string>();
  for (const domain of domains) {
    const candidate = registrableLabel(domain);
    if (
      candidate !== undefined &&
      !GENERIC_LABELS.has(candidate) &&
      candidate.length >= MIN_BRAND_TOKEN_LENGTH
    ) {
      tokens.add(candidate);
    }
  }
  return [...tokens].toSorted();
}

function tokenPattern(token: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}([^a-z0-9]|$)`, "i");
}

/** Compiled per row on purpose: a handful of tiny patterns is cheap, and the module keeps no state. */
function brandTokenPatterns(domains: readonly string[]): readonly RegExp[] {
  return competitorBrandTokens(domains).map(tokenPattern);
}

/** `now.gg` is a hostname; `robots.txt` and `node.js` are a file and a technology and stay in the metric lane. */
function isHostnameShaped(keyword: string): boolean {
  if (!HOSTNAME_SHAPE.test(keyword)) return false;
  const lastLabel = keyword.slice(keyword.lastIndexOf(".") + 1);
  return !FILE_EXTENSION_LABELS.has(lastLabel);
}

/** True when a competitor ranks with a `/<keyword>.<tld>/` path, i.e. a profile page about another brand. */
function isDomainProfilePage(
  keyword: string,
  pages: Readonly<Record<string, CompetitorKeywordGapCompetitorPage>>,
): boolean {
  const compact = keyword.replace(/\s+/g, "");
  if (compact.length < MIN_PROFILE_KEYWORD_LENGTH) return false;
  // A page file such as `/products/crm.html` has the same shape with a file
  // extension where the TLD would be; it is a page about the keyword, not a
  // profile page about another brand.
  const needle = new RegExp(
    `/${escapeRegExp(compact)}\\.([a-z]{2,})(?:/|$)`,
    "i",
  );
  return Object.values(pages).some((page) => {
    if (page.url === null) return false;
    try {
      const match = needle.exec(new URL(page.url).pathname);
      return (
        match !== null &&
        !FILE_EXTENSION_LABELS.has((match[1] ?? "").toLowerCase())
      );
    } catch {
      return false;
    }
  });
}

/** Which source a reason comes from: the label the surface must show next to it. */
const REASON_BASIS: Readonly<
  Record<
    CompetitorKeywordGapPreScreen["reason"],
    CompetitorKeywordGapPreScreen["basis"]
  >
> = {
  kd_low_rank_top10: "dfs_estimate",
  kd_mid_rank_top20: "dfs_estimate",
  kd_high: "dfs_estimate",
  dfs_metric_missing: "dfs_estimate",
  provider_navigational_intent: "dfs_estimate",
  competitor_brand_token: "tool_heuristic",
  competitor_domain_profile_page: "tool_heuristic",
  domain_like_keyword: "tool_heuristic",
};

function decide(
  band: CompetitorKeywordGapPreScreen["band"],
  reason: CompetitorKeywordGapPreScreen["reason"],
): CompetitorKeywordGapPreScreen {
  return Object.freeze({ band, basis: REASON_BASIS[reason], reason });
}

/** The four brand/navigational checks, skipped entirely for comparative queries. */
function navigationalDecision(
  keyword: string,
  input: CompetitorKeywordGapPreScreenInput,
): CompetitorKeywordGapPreScreen | null {
  if (COMPARATIVE_TOKENS.test(keyword)) return null;
  const patterns = brandTokenPatterns(input.competitorDomains);
  if (patterns.some((pattern) => pattern.test(keyword))) {
    return decide("defer_brand_navigational", "competitor_brand_token");
  }
  if (isHostnameShaped(keyword)) {
    return decide("defer_brand_navigational", "domain_like_keyword");
  }
  if (isDomainProfilePage(keyword, input.competitorPages)) {
    return decide("defer_brand_navigational", "competitor_domain_profile_page");
  }
  if (input.providerIntent?.trim().toLowerCase() === "navigational") {
    return decide("defer_brand_navigational", "provider_navigational_intent");
  }
  return null;
}

export function preScreenCompetitorKeyword(
  input: CompetitorKeywordGapPreScreenInput,
): CompetitorKeywordGapPreScreen {
  const keyword = normalizedKey(input.keyword);
  const navigational = navigationalDecision(keyword, input);
  if (navigational !== null) return navigational;

  const kd = input.keywordDifficulty.value;
  if (
    kd === null ||
    input.keywordDifficulty.availability === "provider_no_data" ||
    input.searchVolume.availability === "provider_no_data"
  ) {
    return decide("unbanded", "dfs_metric_missing");
  }
  if (kd >= COMPETITOR_KEYWORD_GAP_KD_HEAD_MIN) {
    return decide("defer_head_term", "kd_high");
  }
  if (
    kd <= COMPETITOR_KEYWORD_GAP_KD_LOW_MAX &&
    input.bestCompetitorRank <= COMPETITOR_KEYWORD_GAP_PAGE_ONE_RANK_MAX
  ) {
    return decide("prioritize_serp_check", "kd_low_rank_top10");
  }
  // Everything that is not both low-KD and page-one lands here, including a
  // low-KD term a competitor only holds on page two; the reason name is pinned
  // by the contract (see its doc in types.ts) and must not be read as "mid KD".
  return decide("stretch", "kd_mid_rank_top20");
}
