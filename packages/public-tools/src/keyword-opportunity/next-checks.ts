// @input  -- one finished candidate row
// @output -- the checks a reader should run before building anything for it
// @pos    -- the advice layer: says what to go look at, never whether the term is good
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type {
  KeywordOpportunityCheck,
  KeywordOpportunityCoverage,
  KeywordOpportunityLane,
  KeywordOpportunitySerpEvidence,
  KeywordOpportunityValidation,
} from "./types.ts";

/**
 * Every path, as a value.
 *
 * The type is a union and no test can iterate a union. A surface that renders
 * one label per path breaks at runtime on whichever path nobody wrote copy
 * for, and only for the visitors whose data happens to produce it. This list
 * lets a copy-completeness test find the hole first.
 */
export const KEYWORD_OPPORTUNITY_CHECKS = [
  "read_page_one_intent",
  "confirm_result_page_type",
  "verify_weak_site_breakthrough",
  "check_existing_page_overlap",
  "judge_commercial_fit",
  "decide_whether_to_bet_early",
] as const satisfies readonly KeywordOpportunityCheck[];

export interface KeywordOpportunityCheckInput {
  readonly lane: KeywordOpportunityLane;
  readonly validation: KeywordOpportunityValidation;
  readonly serp: KeywordOpportunitySerpEvidence;
  readonly coverage: KeywordOpportunityCoverage;
}

/**
 * Which checks a row earns.
 *
 * Every row gets at least one, and that is the rule the whole tool is built
 * around: the team's own keyword selection was misled four times by volume and
 * difficulty looking right, and each time the correction came from opening
 * page one by hand. A row shipped with no check attached would reproduce that
 * failure and dress it up as a recommendation.
 *
 * The paths are ordered by what the reader is missing, not by severity:
 *
 * 1. Reading page one comes first whenever the tool sampled it, because the
 *    sample says who ranks, not whether they answer the same question.
 * 2. A term nobody sampled needs its result page looked at from scratch, so it
 *    also earns the page-type check.
 * 3. Weak-site breakthrough is worth confirming precisely when the tool is
 *    leaning on it — an abandoned post on a small domain may not be defendable.
 * 4. Overlap with an existing page matters whenever the site may already serve
 *    the term, including the unverified lexical case.
 * 5. A term with no measured demand, or one on the GEO lane, has nothing to
 *    size the bet with; saying so is more useful than a confidence number.
 * 6. Commercial fit is always the reader's call: demand is not intent to buy.
 */
export function keywordNextChecks(
  row: KeywordOpportunityCheckInput,
): readonly KeywordOpportunityCheck[] {
  const checks: KeywordOpportunityCheck[] = [];

  if (row.serp.verdict === "no_serp_evidence") {
    checks.push("read_page_one_intent", "confirm_result_page_type");
  } else {
    checks.push("read_page_one_intent");
    if (row.serp.verdict === "winnable_evidence") {
      checks.push("verify_weak_site_breakthrough");
    }
  }

  // Written as the positive list rather than "not the one state that skips
  // it". The coverage union grows, and a negation silently grants the check to
  // every member added later — including ones where it would be wrong.
  //
  // `gsc_query_sample_not_read` earns it for the opposite reason to the
  // observed states: nobody checked, so the reader is the only one who can.
  if (
    row.coverage === "observed_exact_strong" ||
    row.coverage === "observed_exact_weak" ||
    row.coverage === "related_coverage_unverified" ||
    row.coverage === "gsc_query_sample_not_read"
  ) {
    checks.push("check_existing_page_overlap");
  }

  if (row.lane === "geo" || row.validation.availability !== "available") {
    checks.push("decide_whether_to_bet_early");
  }

  checks.push("judge_commercial_fit");

  return Array.from(new Set(checks));
}
