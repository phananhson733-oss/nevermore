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
  topTenDomains: [],
  isEstimate: false,
};

export interface KeywordOpportunitySerpSample {
  /** Top ten organic domains, in rank order. */
  readonly domains: readonly string[];
  /** Provider domain rank per domain. Missing entries are skipped, not zeroed. */
  readonly domainRanks: ReadonlyMap<string, number>;
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
 * A sample whose domains all failed rank resolution stays `no_serp_evidence`.
 * An empty rank set is silence, not a contested page, and reporting it as
 * contested would hide a provider gap behind a confident-sounding verdict.
 */
export function judgeKeywordWinnability(
  sample: KeywordOpportunitySerpSample,
  siteDomainRank: number | null,
): KeywordOpportunitySerpEvidence {
  const ranks = sample.domains
    .map((domain) => sample.domainRanks.get(domain))
    .filter((rank): rank is number => typeof rank === "number");

  if (ranks.length === 0) {
    return { ...KEYWORD_OPPORTUNITY_UNSAMPLED, topTenDomains: sample.domains };
  }

  const weakest = Math.min(...ranks);
  const ceiling = Math.max(
    siteDomainRank ?? 0,
    KEYWORD_OPPORTUNITY_WEAK_DOMAIN_RANK,
  );
  const verdict: KeywordOpportunityWinnability =
    weakest <= ceiling ? "winnable_evidence" : "contested_evidence";

  return {
    verdict,
    weakestTopTenDomainRank: weakest,
    topTenDomains: sample.domains,
    isEstimate: false,
  };
}

/** Whether a row may be shown as an opportunity rather than a note. */
export function isKeywordWinnable(
  evidence: KeywordOpportunitySerpEvidence,
): boolean {
  return evidence.verdict === "winnable_evidence";
}
