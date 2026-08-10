// @input  -- the site context plus every per-candidate observation the pipeline gathered
// @output -- the finished result, its funnel, and an availability the surface must obey
// @pos    -- assembly only; every judgement was already made by the module that owns it
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createPublicToolResult } from "../contract.ts";
import { clusterKeywords, keywordClusterIndex } from "./cluster.ts";
import { isKeywordAlreadyCovered } from "./coverage.ts";
import { keywordNextChecks } from "./next-checks.ts";
import { KEYWORD_OPPORTUNITY_SCHEMA_VERSION } from "./types.ts";
import { isKeywordWinnable } from "./winnability.ts";
import type {
  KeywordOpportunityAvailability,
  KeywordOpportunityBasis,
  KeywordOpportunityContext,
  KeywordOpportunityCoverage,
  KeywordOpportunityEnvelope,
  KeywordOpportunityFunnel,
  KeywordOpportunityLane,
  KeywordOpportunityResult,
  KeywordOpportunityRow,
  KeywordOpportunitySerpEvidence,
  KeywordOpportunityValidation,
  KeywordOpportunityWithheld,
} from "./types.ts";

/**
 * Rows below which a run reports insufficient evidence instead of a list.
 *
 * Five. The Tranche 2 spike put eleven of fifteen sites over this line and the
 * four that missed were all developer-tooling businesses, so the threshold is
 * doing real work: for those categories the honest answer is that the public
 * data does not support a keyword plan, and padding the table to look
 * productive is exactly the failure the tool exists to avoid.
 */
export const KEYWORD_OPPORTUNITY_MIN_ROWS = 5;

/** One candidate with every observation the pipeline collected for it. */
export interface KeywordOpportunityObservation {
  readonly keyword: string;
  readonly lane: KeywordOpportunityLane;
  readonly discoveryBasis: KeywordOpportunityBasis;
  readonly questionForm: boolean;
  readonly propositionIndex: number | null;
  readonly validation: KeywordOpportunityValidation;
  readonly serp: KeywordOpportunitySerpEvidence;
  readonly coverage: KeywordOpportunityCoverage;
  readonly supportingPageUrl: string | null;
}

export interface KeywordOpportunityReportInput {
  readonly marketCode: string;
  readonly languageCode: string;
  readonly context: KeywordOpportunityContext;
  readonly generated: number;
  readonly observations: readonly KeywordOpportunityObservation[];
  /** Stage names that could not run, e.g. "serp_sample" or "gsc_coverage". */
  readonly unavailableStages: readonly string[];
  /**
   * When the run finished, supplied by the caller.
   *
   * The clock lives in `apps/*`: reading it here would make every test either
   * nondeterministic or forced to stub a global.
   */
  readonly completedAt: string;
}

/**
 * Decide whether an observation reaches the reader.
 *
 * The SEO lane needs measured demand and a page one that a weak site already
 * broke into. The GEO lane is judged on neither: gating question-form terms on
 * volume would delete 87% of them, so they qualify on having a crawled page
 * that answers them and are labelled as carrying no demand data.
 */
function isShown(observation: KeywordOpportunityObservation): boolean {
  if (isKeywordAlreadyCovered(observation.coverage)) return false;
  if (observation.lane === "geo") {
    return observation.supportingPageUrl !== null;
  }
  return (
    observation.validation.availability === "available" &&
    isKeywordWinnable(observation.serp)
  );
}

/**
 * Name the actual reason a candidate was held back.
 *
 * Ordered so the earliest true statement wins, and split by lane because the
 * two lanes are judged on different evidence. A GEO row is never held back for
 * missing demand data — it is not judged on demand at all — so reporting that
 * would send the reader looking for a number the tool never wanted. Likewise a
 * page one that was sampled and came back contested is a different fact from a
 * page one nobody sampled: only the second is worth re-running.
 */
function withheldReason(
  observation: KeywordOpportunityObservation,
): KeywordOpportunityWithheld["reason"] {
  if (isKeywordAlreadyCovered(observation.coverage)) return "already_covered";
  if (observation.lane === "geo") return "no_supporting_page";
  if (observation.validation.availability !== "available") {
    return "no_measured_demand";
  }
  return observation.serp.verdict === "contested_evidence"
    ? "page_one_contested"
    : "serp_sample_budget_exhausted";
}

function countFunnel(
  input: KeywordOpportunityReportInput,
  shown: readonly KeywordOpportunityObservation[],
): KeywordOpportunityFunnel {
  const observations = input.observations;
  const availability = (state: string): number =>
    observations.filter((o) => o.validation.availability === state).length;

  return {
    generated: input.generated,
    deduplicated: observations.length,
    providerReturned: availability("available") + availability("explicit_zero"),
    volumePositive: availability("available"),
    explicitZero: availability("explicit_zero"),
    providerNoData: availability("provider_no_data"),
    // Derived from the observations rather than from `unavailableStages`, so
    // there is one source of truth: a row can only be `gsc_query_sample_not_read`
    // if nothing was read for it, and the count is meaningless then.
    alreadyCovered: observations.some(
      (o) => o.coverage === "gsc_query_sample_not_read",
    )
      ? null
      : observations.filter((o) => isKeywordAlreadyCovered(o.coverage)).length,
    serpSampled: observations.filter(
      (o) => o.serp.verdict !== "no_serp_evidence",
    ).length,
    winnableEvidence: observations.filter((o) => isKeywordWinnable(o.serp))
      .length,
    shown: shown.length,
  };
}

/**
 * What to tell a reader whose run came back thin.
 *
 * Only ever suggestions about the inputs. A run that found nothing has learned
 * nothing about the site's prospects, so it must not editorialise about them.
 */
function nextSteps(
  input: KeywordOpportunityReportInput,
  shownCount: number,
): readonly string[] {
  const steps: string[] = [];
  if (!input.context.contextSufficient) {
    steps.push("supply_product_description");
  }
  if (shownCount < KEYWORD_OPPORTUNITY_MIN_ROWS) {
    steps.push("add_seed_keywords", "try_another_market");
  }
  if (input.unavailableStages.length > 0) {
    steps.push("rerun_when_stage_recovers");
  }
  return steps;
}

/**
 * Resolve the run-level availability.
 *
 * `partial` exists so a missing stage can never be read as a clean run: the
 * seo-audit history in this repo has a case where a fully disallowed crawl was
 * reported as "checked, nothing found". A run missing a stage says so even
 * when it produced plenty of rows.
 */
function resolveAvailability(
  input: KeywordOpportunityReportInput,
  shownCount: number,
): KeywordOpportunityAvailability {
  if (shownCount < KEYWORD_OPPORTUNITY_MIN_ROWS) return "insufficient_evidence";
  if (input.unavailableStages.length > 0) return "partial";
  return "available";
}

/** Assemble the finished result from observations that are already judged. */
export function buildKeywordOpportunityResult(
  input: KeywordOpportunityReportInput,
): KeywordOpportunityResult {
  const shown = input.observations.filter(isShown);
  const clusters = clusterKeywords(shown.map((o) => o.keyword));
  const clusterIds = keywordClusterIndex(clusters);

  const rows: KeywordOpportunityRow[] = shown.map((observation) => ({
    keyword: observation.keyword,
    lane: observation.lane,
    discoveryBasis: observation.discoveryBasis,
    questionForm: observation.questionForm,
    propositionIndex: observation.propositionIndex,
    validation: observation.validation,
    serp: observation.serp,
    coverage: observation.coverage,
    supportingPageUrl: observation.supportingPageUrl,
    nextChecks: keywordNextChecks(observation),
    // Clusters are built from exactly these keywords, so the lookup always
    // hits; the null is the contract's shape for a row that predates
    // clustering, not a case this path can produce.
    clusterId: clusterIds.get(observation.keyword) ?? null,
  }));

  const withheld: KeywordOpportunityWithheld[] = input.observations
    .filter((observation) => !isShown(observation))
    .map((observation) => ({
      keyword: observation.keyword,
      discoveryBasis: observation.discoveryBasis,
      reason: withheldReason(observation),
    }));

  return {
    availability: resolveAvailability(input, rows.length),
    marketCode: input.marketCode,
    languageCode: input.languageCode,
    context: input.context,
    rows,
    withheld,
    clusters,
    funnel: countFunnel(input, shown),
    unavailableStages: input.unavailableStages,
    nextStepSuggestions: nextSteps(input, rows.length),
  };
}

/**
 * Wrap the result in the shared public-tool envelope.
 *
 * `createPublicToolResult` pins `mode: "public_preview"` and
 * `persistence: "none"`, which is exactly true here: nothing this run produces
 * is written anywhere. If that ever stops being true the helper has to change
 * rather than the caller patching the field back in.
 */
export function buildKeywordOpportunityPayload(
  input: KeywordOpportunityReportInput,
): KeywordOpportunityEnvelope {
  return createPublicToolResult(
    {
      tool: "keyword_opportunity_map",
      schemaVersion: KEYWORD_OPPORTUNITY_SCHEMA_VERSION,
      scope: "site",
      completedAt: input.completedAt,
    },
    buildKeywordOpportunityResult(input),
  );
}
