// @input  -- one contract-valid v3 report and the plan already derived from it
// @output -- the same candidates, shaped so a card can render them without deciding anything
// @pos    -- presentation only; no observation becomes a suggestion here

import {
  GEO_ASSET_TYPES,
  isGeoAssetType,
  type GeoAssetType,
} from "./geo-asset-type.ts";
import {
  GEO_ACTION_REASON_KIND,
  type GeoActionCandidateV1,
  type GeoActionKind,
  type GeoActionPlanV1,
  type GeoActionReason,
} from "./geo-action-mapping.ts";
import type { GeoReportDataV3 } from "./geo-report-contract.ts";

/**
 * Every reason the mapper can produce, as a value rather than a type.
 *
 * The adapter has to be able to *ask* whether a reason is one it knows, and a
 * union type cannot be asked at runtime. Kept beside the mapper's own union so
 * a reason added there and not added here is caught by the exhaustiveness check
 * below rather than by a reader noticing a missing card months later.
 */
export const GEO_ACTION_REASONS = [
  "target_not_observed_in_samples",
  "target_observed_in_minority_of_samples",
  "citation_source_pattern_observed",
  "avoid_new_page_as_first_step",
  "needs_page_inventory",
  "needs_more_evidence",
  "existing_page_fit_confirmed",
] as const;

// Compile-time proof the list above and the mapper's union are the same set.
// A reason added to one and not the other fails typecheck here, which is the
// only place that can catch it before a card renders a translation path.
type ReasonsMatch = (typeof GEO_ACTION_REASONS)[number] extends GeoActionReason
  ? GeoActionReason extends (typeof GEO_ACTION_REASONS)[number]
    ? true
    : never
  : never;
const REASONS_MATCH: ReasonsMatch = true;
void REASONS_MATCH;

const KNOWN_REASONS: ReadonlySet<string> = new Set(GEO_ACTION_REASONS);

/**
 * The one value the three prose fields are keyed by.
 *
 * A candidate's proposed action, required inputs and rejected alternative are
 * about an asset when there is an asset to build, and about the finding itself
 * when there is not: "look at the pages you already have" has no asset type,
 * and "do not start with a new page" is the absence of one. Prefixing keeps the
 * two namespaces from ever colliding — `existing_page_enhancement` is both a
 * legitimate asset type and the asset the avoid candidate carries, and an
 * unprefixed key would render the same sentence for both.
 *
 * `unavailable` is the fail-closed value. It is reachable only if a candidate
 * arrives carrying a value outside the closed enums, which the type system
 * already forbids — but a card that silently rendered a raw enum string, or a
 * translation path, would be worse than one that says the basis could not be
 * read.
 */
export type GeoSolutionBasis =
  | `asset_${GeoAssetType}`
  | `reason_${GeoActionReason}`
  | "unavailable";

/**
 * Every basis a card may ever be keyed by.
 *
 * Enumerated by walking the mapper's own tables rather than by hand: a hand
 * list is only as good as the sweep that maintains it, and the message-parity
 * test built on it would keep passing after a new asset type shipped without
 * copy. `reason_` bases exist only for the kinds that have no asset to name —
 * a `do` candidate is always described by what it proposes to build, so
 * generating a `reason_` key for one would be inventing a sentence nothing can
 * reach.
 */
export const GEO_SOLUTION_BASES: readonly GeoSolutionBasis[] = [
  ...GEO_ASSET_TYPES.map((assetType): GeoSolutionBasis => `asset_${assetType}`),
  ...GEO_ACTION_REASONS.filter(
    (reason) => GEO_ACTION_REASON_KIND[reason] !== "do",
  ).map((reason): GeoSolutionBasis => `reason_${reason}`),
  "unavailable",
];

/**
 * One candidate, ready to render, with nothing decided that was not already
 * decided by {@link deriveGeoActionPlan}.
 *
 * The prose fields are translation keys, never generated sentences. A card that
 * assembled its own wording out of enum values would be a second place where an
 * observation turns into a claim, and the report already has exactly one.
 */
export interface GeoSolutionPresentationV1 {
  readonly actionId: string;
  readonly kind: GeoActionKind;
  readonly assetType: GeoAssetType;
  readonly reason: GeoActionReason;
  /** Raw numerator and denominator; null when no ratio applies to this item. */
  readonly reasonCounts: {
    readonly observed: number;
    readonly evaluable: number;
  } | null;
  /**
   * The questions this candidate rests on, as the visitor confirmed them.
   *
   * Text, not ids: "observed in 0 of 3" is only actionable once the reader
   * knows which three, and the ids mean nothing to anybody outside this code.
   * Resolved from the report rather than carried alongside it, so a card can
   * never name a question the report does not contain.
   */
  readonly exactQuestions: readonly string[];
  readonly targetUrl: string | null;
  readonly issueKey: string;
  readonly whyKey: string;
  readonly actionKey: string;
  readonly inputsKey: string;
  readonly rejectedAlternativeKey: string;
  /**
   * What this run could not establish, kept apart from what it can.
   *
   * The two are different claims: a limitation bounds what the numbers cover,
   * an unknown names a fact nobody collected. Folding them into one list turned
   * "we did not look at your pages" into a caveat on a measurement, which is
   * how a gap in the method starts reading as a footnote on a result.
   */
  readonly unknownKeys: readonly string[];
  readonly limitationKeys: readonly string[];
  readonly requiresHumanReview: true;
}

function basisOf(candidate: GeoActionCandidateV1): GeoSolutionBasis {
  if (!KNOWN_REASONS.has(candidate.reason)) return "unavailable";
  if (candidate.kind !== "do") return `reason_${candidate.reason}`;
  if (!isGeoAssetType(candidate.assetType)) return "unavailable";
  return `asset_${candidate.assetType}`;
}

/**
 * Shape the plan for the cards, and change nothing about it.
 *
 * Order is the plan's own — the mapper ranks the cheapest, least committing
 * candidate first on purpose, and re-sorting here would quietly promote a
 * proposal to build something above the suggestion to look at what exists.
 *
 * A pure function of `report` and `plan`. The confirmed context is deliberately
 * not a parameter: the only context value a card shows is the entered page, and
 * the plan already carries it on the candidate that names it. Taking the
 * snapshot as well would create a second path to the same fact and a second
 * chance for the card to name a page the plan was not derived against.
 */
export function deriveGeoSolutionPresentations(
  report: GeoReportDataV3,
  plan: GeoActionPlanV1,
): readonly GeoSolutionPresentationV1[] {
  return plan.candidates.map((candidate): GeoSolutionPresentationV1 => {
    const basis = basisOf(candidate);
    return {
      actionId: candidate.actionId,
      kind: candidate.kind,
      assetType: candidate.assetType,
      reason: candidate.reason,
      reasonCounts: candidate.reasonCounts,
      // Deduped and in report order. A merged candidate carries every question
      // it absorbed, and a repeated id would print the same sentence twice.
      exactQuestions: report.questions
        .filter((question) => candidate.queryIds.includes(question.queryId))
        .map((question) => question.text),
      targetUrl: candidate.targetUrl,
      // The issue and the reason it matters are about what was observed, so
      // both are keyed by the reason even when there is an asset to build.
      issueKey: KNOWN_REASONS.has(candidate.reason)
        ? `solutions.issue.${candidate.reason}`
        : "solutions.issue.unavailable",
      whyKey: KNOWN_REASONS.has(candidate.reason)
        ? `solutions.why.${candidate.reason}`
        : "solutions.why.unavailable",
      actionKey: `solutions.action.${basis}`,
      inputsKey: `solutions.inputs.${basis}`,
      rejectedAlternativeKey: `solutions.rejected.${basis}`,
      unknownKeys: candidate.unknowns.map(
        (code) => `solutions.unknown.${code}`,
      ),
      limitationKeys: candidate.limitations.map(
        (code) => `solutions.limitation.${code}`,
      ),
      requiresHumanReview: true,
    };
  });
}
