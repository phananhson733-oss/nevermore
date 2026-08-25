// @input  -- one merged gap row's DFS estimates, its competitor pages, and the requested competitor domains
// @output -- a deterministic pre-screen band with the single reason that decided it
// @pos    -- second, orthogonal axis next to the GSC-derived next step; an estimate, never winnability

import type {
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
  /** Competitor domain -> ranking page URL (already sanitised), when known. */
  readonly competitorPages: Readonly<Record<string, string | null>>;
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

/** The label a person would call the competitor by: `ahrefs` for `ahrefs.com`, `seo-tools` for `seo-tools.example`. */
export function competitorBrandTokens(
  domains: readonly string[],
): readonly string[] {
  const tokens = new Set<string>();
  for (const domain of domains) {
    const labels = domain
      .toLowerCase()
      .split(".")
      .filter((label) => label !== "");
    const candidate = labels.find((label) => !GENERIC_LABELS.has(label));
    if (candidate !== undefined && candidate.length >= MIN_BRAND_TOKEN_LENGTH) {
      tokens.add(candidate);
    }
  }
  return [...tokens].toSorted();
}

function containsToken(keyword: string, token: string): boolean {
  return new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(token)}([^a-z0-9]|$)`,
    "i",
  ).test(keyword);
}

/** True when a competitor ranks with a `/<keyword>.<tld>/` path, i.e. a profile page about another brand. */
function isDomainProfilePage(
  keyword: string,
  pages: Readonly<Record<string, string | null>>,
): boolean {
  const compact = keyword.replace(/\s+/g, "");
  if (compact.length < MIN_PROFILE_KEYWORD_LENGTH) return false;
  const needle = new RegExp(`/${escapeRegExp(compact)}\\.[a-z]{2,}(?:/|$)`, "i");
  return Object.values(pages).some((url) => {
    if (url === null) return false;
    try {
      return needle.test(new URL(url).pathname);
    } catch {
      return false;
    }
  });
}

function decide(
  band: CompetitorKeywordGapPreScreen["band"],
  reason: CompetitorKeywordGapPreScreen["reason"],
): CompetitorKeywordGapPreScreen {
  return Object.freeze({ band, basis: "dfs_estimate", reason });
}

/** The four brand/navigational checks, skipped entirely for comparative queries. */
function navigationalDecision(
  keyword: string,
  input: CompetitorKeywordGapPreScreenInput,
): CompetitorKeywordGapPreScreen | null {
  if (COMPARATIVE_TOKENS.test(keyword)) return null;
  const brandTokens = competitorBrandTokens(input.competitorDomains);
  if (brandTokens.some((token) => containsToken(keyword, token))) {
    return decide("defer_brand_navigational", "competitor_brand_token");
  }
  if (HOSTNAME_SHAPE.test(keyword)) {
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
  return decide("stretch", "kd_mid_rank_top20");
}
