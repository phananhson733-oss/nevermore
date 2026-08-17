// @input  -- a sampled page one, resolved to provider domain ranks
// @output -- whether a weak site has already broken through, as an observation
// @pos    -- replaces the difficulty score as the winnability signal; never a promise
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type {
  KeywordOpportunitySerpEvidence,
  KeywordOpportunityWinnability,
} from "./types.ts";

/**
 * Provider domain rank below which a site counts as weak in absolute terms.
 *
 * A heuristic, not a law. It was read off the 2026-08-10 Tranche 2 sample
 * (15 sites, 255 sampled pages) where it separated pages a new site could
 * plausibly enter from pages held entirely by established brands. One sample
 * is not a calibration, so the raw rank travels with the verdict and every
 * surface shows it: the reader opens the actual page one before committing.
 */
export const KEYWORD_OPPORTUNITY_WEAK_DOMAIN_RANK = 200;

export const KEYWORD_OPPORTUNITY_UNSAMPLED: KeywordOpportunitySerpEvidence = {
  verdict: "no_serp_evidence",
  weakestTopTenDomainRank: null,
  weakestTopTenDomain: null,
  weakestTopTenPosition: null,
  topTenDomains: [],
  topTenDomainRanks: [],
  pageOneItemTypes: null,
  isEstimate: false,
};

export interface KeywordOpportunitySerpSample {
  /**
   * Top ten organic results in rank order, each carrying the position a
   * reader sees (the provider's `rank_group`). The position travels with the
   * domain because the two facts are only meaningful together: a weak domain
   * at position 2 and one clinging to position 10 are different evidence.
   */
  readonly results: readonly {
    readonly domain: string;
    readonly position: number;
  }[];
  /** Provider domain rank per domain. Missing entries are skipped, not zeroed. */
  readonly domainRanks: ReadonlyMap<string, number>;
  /**
   * SERP element types the provider observed on the page, e.g. `ai_overview`.
   * `null` when the provider reported none — which is silence, not "no AI
   * Overview", and must stay distinguishable from an empty list.
   */
  readonly pageItemTypes: readonly string[] | null;
}

/**
 * Decide winnability from a sampled page one.
 *
 * Two ways a page one reads as penetrable: someone no stronger than the asking
 * site already ranks, or someone weak in absolute terms does. Both are things
 * observed on the page rather than modelled, which is the whole reason for
 * sampling instead of trusting a difficulty score — the team's own selection
 * was misled four times by scores that looked easy on pages nobody weak held.
 *
 * The weakest rank is a proxy signal, not a sufficient condition: it answers
 * "how weak is the weakest holder", never "how hard is the page overall". So
 * the verdict travels with everything a reader needs to second-guess it — the
 * weakest domain's identity and position, every resolved rank, and the SERP
 * element types the provider saw.
 *
 * A sample whose domains all failed rank resolution stays `no_serp_evidence`.
 * An empty rank set is silence, not a contested page, and reporting it as
 * contested would hide a provider gap behind a confident-sounding verdict.
 * The page WAS opened, though, so its item types and domains still travel.
 */
export function judgeKeywordWinnability(
  sample: KeywordOpportunitySerpSample,
  siteDomainRank: number | null,
): KeywordOpportunitySerpEvidence {
  const topTenDomains = sample.results.map((result) => result.domain);
  const topTenDomainRanks = sample.results.map(
    (result) => sample.domainRanks.get(result.domain) ?? null,
  );

  let weakest: {
    readonly rank: number;
    readonly domain: string;
    readonly position: number;
  } | null = null;
  for (const [index, result] of sample.results.entries()) {
    const rank = topTenDomainRanks[index];
    if (rank === null || rank === undefined) continue;
    // Strictly less-than, so a tie keeps the earliest occurrence — the best
    // position that weak rank holds, which is the page the reader would open.
    if (weakest === null || rank < weakest.rank) {
      weakest = { rank, domain: result.domain, position: result.position };
    }
  }

  if (weakest === null) {
    return {
      ...KEYWORD_OPPORTUNITY_UNSAMPLED,
      topTenDomains,
      topTenDomainRanks,
      pageOneItemTypes: sample.pageItemTypes,
    };
  }

  const ceiling = Math.max(
    siteDomainRank ?? 0,
    KEYWORD_OPPORTUNITY_WEAK_DOMAIN_RANK,
  );
  const verdict: KeywordOpportunityWinnability =
    weakest.rank <= ceiling ? "winnable_evidence" : "contested_evidence";

  return {
    verdict,
    weakestTopTenDomainRank: weakest.rank,
    weakestTopTenDomain: weakest.domain,
    weakestTopTenPosition: weakest.position,
    topTenDomains,
    topTenDomainRanks,
    pageOneItemTypes: sample.pageItemTypes,
    isEstimate: false,
  };
}

/** Whether a row may be shown as an opportunity rather than a note. */
export function isKeywordWinnable(
  evidence: KeywordOpportunitySerpEvidence,
): boolean {
  return evidence.verdict === "winnable_evidence";
}
