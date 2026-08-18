// @input  -- one contract-valid v3 report, and nothing else
// @output -- zero to five deterministic action candidates with enum-typed reasons
// @pos    -- the only place an observation becomes a suggestion

import type { GeoAssetType } from "./geo-asset-type.ts";
import type { GeoQuerySlot } from "./geo-query-contract.ts";
import type {
  GeoQuestionObservationV3,
  GeoReportDataV3,
} from "./geo-report-contract.ts";
import { deriveGeoSourceLandscape } from "./geo-source-landscape.ts";

/**
 * Why the reason is an enum and not a sentence.
 *
 * The reason is what a reader uses to decide whether to act, so it is the one
 * field most likely to be over-read. A prose reason lets "not observed in these
 * samples" drift into "not cited", and a downstream agent searching prose for a
 * magic phrase cannot tell the two apart. An enum plus the raw counts renders
 * through fixed copy — "observed in 0 of 3 citation-evaluable samples" — and
 * cannot become a claim the samples do not support.
 */
export type GeoActionReason =
  | "target_not_observed_in_samples"
  | "target_observed_in_minority_of_samples"
  | "citation_source_pattern_observed"
  | "avoid_new_page_as_first_step"
  | "needs_page_inventory"
  | "needs_more_evidence"
  | "existing_page_fit_confirmed";

/**
 * What kind of work a candidate is, because "don't" is also an answer.
 *
 * An evidence tool that can only ever say "build this" spends the reader's week
 * on whichever gap it happened to rank first. `avoid` earns its place beside
 * `do`: the run can establish that a page is not the observed pattern without
 * establishing what is, and saying so is the more useful half of that.
 * `external_data` marks the things this run cannot see and the reader can —
 * their own pages, their own analytics — so a lookup is not mistaken for a build.
 */
export type GeoActionKind = "do" | "external_data" | "avoid";

/** One kind per reason, so the label can never disagree with the evidence. */
const REASON_KIND: Readonly<Record<GeoActionReason, GeoActionKind>> = {
  needs_page_inventory: "external_data",
  needs_more_evidence: "external_data",
  avoid_new_page_as_first_step: "avoid",
  target_not_observed_in_samples: "do",
  target_observed_in_minority_of_samples: "do",
  citation_source_pattern_observed: "do",
  existing_page_fit_confirmed: "do",
};

export interface GeoActionCandidateV1 {
  readonly actionId: string;
  readonly assetType: GeoAssetType;
  /** Derived from the reason, never chosen separately. */
  readonly kind: GeoActionKind;
  /** A stable key the UI renders through fixed copy; never a finished sentence. */
  readonly title: GeoActionReason;
  readonly reason: GeoActionReason;
  /** Raw counts backing the reason; null when the reason carries no ratio. */
  readonly reasonCounts: {
    readonly observed: number;
    readonly evaluable: number;
  } | null;
  readonly queryIds: readonly string[];
  readonly sampleIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly targetUrl: string | null;
  readonly unknowns: readonly string[];
  readonly limitations: readonly string[];
  readonly requiresHumanReview: true;
}

/**
 * The mode travels only inside the mapper, so merges stay within one denominator.
 *
 * `kind` is deliberately absent: it is a pure function of the reason, and
 * writing it at each of the four construction sites would be four chances for a
 * label to drift away from the evidence it names. It is stamped once, at the end.
 */
interface GeoActionCandidateWithModeV1
  extends Omit<GeoActionCandidateV1, "kind"> {
  readonly mode: GeoQuestionObservationV3["mode"];
}

/** Applied once, so the label can only ever be the reason's own. */
function withKind(
  candidate: Omit<GeoActionCandidateV1, "kind">,
): GeoActionCandidateV1 {
  return { ...candidate, kind: REASON_KIND[candidate.reason] };
}

export interface GeoActionPlanV1 {
  readonly candidates: readonly GeoActionCandidateV1[];
  /** Set exactly when there are no candidates, so zero is explained not silent. */
  readonly zeroActionReason: GeoActionReason | null;
}

/** Most candidates a report may produce. */
export const GEO_MAX_ACTION_CANDIDATES = 5;

/**
 * Which asset answers which buyer decision.
 *
 * The plan's existing-page-first rule is honoured a level up: the inventory
 * check is always the first candidate, because in P0 the entered URL is the
 * only page identity known with certainty and a new page recommended without
 * looking at the existing ones is a guess wearing a plan's clothes.
 */
const SLOT_ASSET: Readonly<Record<GeoQuerySlot, GeoAssetType>> = {
  category_discovery: "blog_guide",
  jtbd_outcome: "use_case_landing",
  pain_how_to: "blog_guide",
  constraint_fit: "pricing_page",
  alternative_status_quo: "comparison_page",
  brand_comparison: "comparison_page",
  due_diligence: "offsite_authority_plan",
  negative_fit_objection: "pricing_page",
};

/**
 * Ranking, so a capped list drops the least useful candidate rather than a
 * random one.
 *
 * The inventory check ranks first because it is the cheapest thing a reader can
 * do and because everything below it is a proposal to build something.
 */
const REASON_RANK: Readonly<Record<GeoActionReason, number>> = {
  needs_page_inventory: 0,
  // Directly after the inventory check and before anything that proposes
  // building: both are cheap, and both exist to stop a week being spent on the
  // first gap that happened to rank highest.
  avoid_new_page_as_first_step: 1,
  target_not_observed_in_samples: 2,
  citation_source_pattern_observed: 3,
  target_observed_in_minority_of_samples: 4,
  existing_page_fit_confirmed: 5,
  needs_more_evidence: 6,
};

function sampleIdsOf(question: GeoQuestionObservationV3): readonly string[] {
  return question.samples.map((sample) => sample.sampleId);
}

function evidenceIdsOf(
  question: GeoQuestionObservationV3,
  kind: "cited" | "mention",
): readonly string[] {
  return question.samples.flatMap((sample) =>
    sample.evidence
      .filter((entry) => entry.kind === kind)
      .map((entry) => entry.evidenceId),
  );
}

/**
 * How many of the question's countable samples cited somebody else.
 *
 * Restricted to the samples that are in the citation denominator. Counting an
 * unsearched or unreadable sample here would let two ineligible calls decide
 * that the customer has an off-site problem, while the ratio printed beside
 * that conclusion came from a different, smaller set.
 */
function nonTargetCitations(question: GeoQuestionObservationV3): number {
  return question.samples.filter(
    (sample) =>
      sample.answerStatus === "answered" &&
      sample.citationStatus === "observed_others_only" &&
      (sample.probeStatus === null || sample.webSearchPerformed === true),
  ).length;
}

/**
 * Turn one question's counts into at most one candidate.
 *
 * A question whose citation denominator is empty produces nothing: a probe that
 * never searched, or whose annotations could not be read, is an instrumentation
 * failure and a plan built on it would be a plan built on nothing.
 */
function candidateFor(
  question: GeoQuestionObservationV3,
): GeoActionCandidateWithModeV1 | null {
  const { counts } = question;
  if (counts.citationEvaluableSamples === 0) return null;

  const reasonCounts = {
    observed: counts.targetCitedIn,
    evaluable: counts.citationEvaluableSamples,
  };
  const base = {
    mode: question.mode,
    actionId: `act-${question.queryId}`,
    queryIds: [question.queryId],
    sampleIds: sampleIdsOf(question),
    targetUrl: null,
    unknowns: [] as readonly string[],
    limitations: [] as readonly string[],
    requiresHumanReview: true as const,
  };

  if (counts.targetCitedIn === counts.citationEvaluableSamples) {
    // Cited every evaluable time. There is no controllable gap here, and
    // inventing one would be inventing work.
    return null;
  }

  if (counts.targetCitedIn > 0) {
    return {
      ...base,
      assetType: SLOT_ASSET[question.slot],
      title: "target_observed_in_minority_of_samples",
      reason: "target_observed_in_minority_of_samples",
      reasonCounts,
      evidenceIds: evidenceIdsOf(question, "cited"),
    };
  }

  // Not observed at all. When other hosts WERE cited, the gap is about which
  // sources the model reaches for, which is an off-site problem before it is a
  // page problem.
  const othersCited = nonTargetCitations(question);
  if (othersCited >= 2) {
    return {
      ...base,
      assetType: "offsite_authority_plan",
      title: "citation_source_pattern_observed",
      reason: "citation_source_pattern_observed",
      reasonCounts,
      evidenceIds: evidenceIdsOf(question, "cited"),
    };
  }

  return {
    ...base,
    assetType: SLOT_ASSET[question.slot],
    title: "target_not_observed_in_samples",
    reason: "target_not_observed_in_samples",
    reasonCounts,
    evidenceIds: evidenceIdsOf(question, "cited"),
  };
}

/**
 * Merge candidates that would produce the same asset.
 *
 * Two questions asking for the same comparison page are one piece of work, and
 * a list that showed them twice would inflate what the report found. The merged
 * candidate keeps every query, sample and evidence reference so the reasoning
 * stays traceable.
 */
function mergeByAsset(
  candidates: readonly GeoActionCandidateWithModeV1[],
): readonly Omit<GeoActionCandidateV1, "kind">[] {
  const byAsset = new Map<string, GeoActionCandidateWithModeV1>();
  for (const candidate of candidates) {
    // Keyed by asset AND mode. Merging a three-sample retrieval probe with a
    // one-sample natural-demand question would add their counts into one ratio
    // — the shared denominator the whole report exists to avoid — and the
    // merged reason would come from a ranking rather than from those counts.
    const key = `${candidate.assetType}:${candidate.mode}`;
    const existing = byAsset.get(key);
    if (existing === undefined) {
      byAsset.set(key, candidate);
      continue;
    }
    const keepExisting =
      REASON_RANK[existing.reason] <= REASON_RANK[candidate.reason];
    const winner = keepExisting ? existing : candidate;
    byAsset.set(key, {
      ...winner,
      queryIds: [...new Set([...existing.queryIds, ...candidate.queryIds])],
      sampleIds: [...new Set([...existing.sampleIds, ...candidate.sampleIds])],
      evidenceIds: [
        ...new Set([...existing.evidenceIds, ...candidate.evidenceIds]),
      ],
      reasonCounts:
        existing.reasonCounts === null || candidate.reasonCounts === null
          ? (winner.reasonCounts ?? null)
          : {
              observed:
                existing.reasonCounts.observed +
                candidate.reasonCounts.observed,
              evaluable:
                existing.reasonCounts.evaluable +
                candidate.reasonCounts.evaluable,
            },
    });
  }
  return [...byAsset.values()].map(
    ({ mode: _mode, ...candidate }) => candidate,
  );
}

/**
 * The one thing this run can say not to do.
 *
 * Established only when all three hold across the run: the citation denominator
 * is not empty, the customer's host was cited in none of it, and the answers did
 * cite other hosts. That combination says a new page is not the pattern these
 * answers are drawing from — it does not say what is, and this candidate does
 * not pretend to. The reader is pointed at the sources the run actually observed
 * before spending a week writing.
 *
 * Withheld when nothing else was cited either: an answer set that cited nobody
 * is a run with no source pattern to learn from, and "do not build a page"
 * would then rest on nothing.
 */
function avoidNewPageFirst(
  report: GeoReportDataV3,
): Omit<GeoActionCandidateV1, "kind"> | null {
  const landscape = deriveGeoSourceLandscape(report);
  if (landscape.citationEvaluableSamples === 0) return null;
  if (landscape.targetObserved) return null;
  const others = landscape.sources.filter((source) => !source.isTarget);
  if (others.length < 2) return null;

  return {
    actionId: "act-avoid-new-page-first",
    assetType: "existing_page_enhancement",
    title: "avoid_new_page_as_first_step",
    reason: "avoid_new_page_as_first_step",
    reasonCounts: {
      observed: others.length,
      evaluable: landscape.citationEvaluableSamples,
    },
    queryIds: report.questions.map((question) => question.queryId),
    sampleIds: [],
    evidenceIds: [],
    targetUrl: null,
    unknowns: ["source_pattern_not_explained"],
    limitations: ["observed_sources_only"],
    requiresHumanReview: true,
  };
}

/**
 * Derive the whole plan from a report, deterministically.
 *
 * No model call, no crawl, no page inventory: the report is the only input, and
 * the same report always produces the same plan. Zero candidates is a valid,
 * expected outcome and is returned with the reason that produced it rather than
 * as an empty list a reader has to interpret.
 */
export function deriveGeoActionPlan(
  report: GeoReportDataV3,
  /** The confirmed page, so the inventory action names it rather than a root. */
  targetUrl?: string,
): GeoActionPlanV1 {
  const evaluableSamples =
    report.coverage.citation.retrieval_probe.citationEvaluableSamples +
    report.coverage.citation.natural_demand.citationEvaluableSamples;
  if (evaluableSamples === 0) {
    return { candidates: [], zeroActionReason: "needs_more_evidence" };
  }

  const derived = report.questions
    .map((question) => candidateFor(question))
    .filter(
      (candidate): candidate is GeoActionCandidateWithModeV1 =>
        candidate !== null,
    );

  if (derived.length === 0) {
    // "Every evaluable question cited the site" and "most questions produced no
    // evaluable sample at all" look identical from an empty candidate list, and
    // only the first is a result. A single natural-demand answer must not be
    // able to report a confirmed fit while fifteen retrieval calls were
    // unreadable.
    const blind = report.questions.filter(
      (question) => question.counts.citationEvaluableSamples === 0,
    ).length;
    return {
      candidates: [],
      zeroActionReason:
        blind > 0 ? "needs_more_evidence" : "existing_page_fit_confirmed",
    };
  }

  // Existing-page-first, in the only form P0 can support honestly: the entered
  // URL is the sole page identity known with certainty, so the first candidate
  // is always "look at what already exists" rather than a recommendation to
  // enhance a page nobody has inventoried.
  const inventory: Omit<GeoActionCandidateV1, "kind"> = {
    actionId: "act-page-inventory",
    assetType: "existing_page_enhancement",
    title: "needs_page_inventory",
    reason: "needs_page_inventory",
    reasonCounts: null,
    queryIds: derived.flatMap((candidate) => candidate.queryIds),
    sampleIds: [],
    evidenceIds: [],
    // The entered page when it is known. Fabricating `https://host/` would
    // point the existing-page check at a different page from the one the
    // visitor confirmed, which is the opposite of existing-page-first.
    targetUrl: targetUrl ?? null,
    unknowns: ["page_inventory_not_collected"],
    limitations: ["entered_url_is_the_only_known_page"],
    requiresHumanReview: true,
  };

  const merged = mergeByAsset(derived).filter(
    (candidate) => candidate.assetType !== "existing_page_enhancement",
  );
  const avoid = avoidNewPageFirst(report);
  const ordered = [inventory, ...(avoid === null ? [] : [avoid]), ...merged].sort(
    (a, b) =>
      REASON_RANK[a.reason] - REASON_RANK[b.reason] ||
      a.actionId.localeCompare(b.actionId),
  );

  return {
    candidates: ordered.slice(0, GEO_MAX_ACTION_CANDIDATES).map(withKind),
    zeroActionReason: null,
  };
}
