// @input  -- anonymous raw keyword-signal snapshots plus explicit policy variants
// @output -- deterministic yield, flip and optional human-label calibration metrics
// @pos    -- offline replay only; never calls providers or claims synthetic data is calibrated

import type {
  KeywordOpportunityBasis,
  KeywordOpportunityLane,
  KeywordOpportunitySignal,
  KeywordOpportunitySiteRankTier,
} from "./types.ts";

export const KEYWORD_OPPORTUNITY_CALIBRATION_SCHEMA_VERSION =
  "keyword_opportunity_calibration_snapshot.v1";

export type KeywordOpportunityCalibrationLabel =
  | "true_opportunity"
  | "not_opportunity"
  | "insufficient_evidence"
  | "already_covered"
  | "unknown";

export interface KeywordOpportunityCalibrationCandidate {
  readonly candidateId: string;
  readonly lane: KeywordOpportunityLane;
  readonly discoveryBasis: KeywordOpportunityBasis;
  readonly siteDomainRank: number | null;
  readonly explicitZero: boolean;
  readonly alreadyCovered: boolean;
  readonly serpComplete: boolean;
  readonly domainRegistrationAgeMonths: readonly (number | null)[];
  readonly domainOrganicEtv: readonly (number | null)[];
  readonly communityObserved: boolean | null;
  readonly label?: KeywordOpportunityCalibrationLabel;
}

export interface KeywordOpportunityCalibrationSnapshotV1 {
  readonly schemaVersion: typeof KEYWORD_OPPORTUNITY_CALIBRATION_SCHEMA_VERSION;
  readonly synthetic: boolean;
  readonly candidates: readonly KeywordOpportunityCalibrationCandidate[];
}

export interface KeywordOpportunityCalibrationVariant {
  readonly id: string;
  readonly unknownPolicy: "strict_unknown_first" | "positive_first";
  readonly youngDomainMonths: number;
  readonly trafficThresholds: {
    readonly rank1To200: number;
    readonly rank201To500: number;
    readonly rank501To1000: number;
  };
}

export type KeywordOpportunityCalibrationDisposition =
  | "eligible"
  | "incomplete"
  | "excluded";

type ObservedSignalState = "observed" | "not_observed" | "unavailable";

export type KeywordOpportunityCalibrationSignalState =
  | ObservedSignalState
  | "not_evaluated";

export type KeywordOpportunityCalibrationSignalStates = Readonly<
  Record<KeywordOpportunitySignal, KeywordOpportunityCalibrationSignalState>
>;

export interface KeywordOpportunityCalibrationCandidateResult {
  readonly candidateId: string;
  readonly disposition: KeywordOpportunityCalibrationDisposition;
  readonly positiveSignals: readonly KeywordOpportunitySignal[];
  readonly signalStates: KeywordOpportunityCalibrationSignalStates;
}

export interface KeywordOpportunityCalibrationLabelMetrics {
  readonly labelledCandidates: number;
  readonly eligibleTrueOpportunities: number;
  readonly falsePositiveEligible: number;
  readonly missedTrueOpportunities: number;
  readonly precisionEligible: number | null;
}

export interface KeywordOpportunityCalibrationGroupMetrics<
  Group extends string,
> extends KeywordOpportunityCalibrationLabelMetrics {
  readonly group: Group;
}

export type KeywordOpportunityCalibrationSiteTier =
  | KeywordOpportunitySiteRankTier
  | "unresolved";

export interface KeywordOpportunityCalibrationLabelledMetrics
  extends KeywordOpportunityCalibrationLabelMetrics {
  readonly byLane: readonly KeywordOpportunityCalibrationGroupMetrics<KeywordOpportunityLane>[];
  readonly bySiteRankTier: readonly KeywordOpportunityCalibrationGroupMetrics<KeywordOpportunityCalibrationSiteTier>[];
  readonly byDiscoveryBasis: readonly KeywordOpportunityCalibrationGroupMetrics<KeywordOpportunityBasis>[];
}

export type KeywordOpportunityCalibrationSignalPrevalence = Readonly<
  Record<
    KeywordOpportunitySignal,
    Readonly<Record<KeywordOpportunityCalibrationSignalState, number>>
  >
>;

export interface KeywordOpportunityCalibrationEvaluation {
  readonly id: string;
  readonly eligible: number;
  readonly incomplete: number;
  readonly excluded: number;
  readonly yield: number;
  readonly incompleteRate: number;
  readonly exclusionRate: number;
  readonly candidates: readonly KeywordOpportunityCalibrationCandidateResult[];
  readonly signalPrevalence: KeywordOpportunityCalibrationSignalPrevalence;
  readonly labelled: KeywordOpportunityCalibrationLabelledMetrics | null;
}

export interface KeywordOpportunityCalibrationComparison {
  readonly schemaVersion: typeof KEYWORD_OPPORTUNITY_CALIBRATION_SCHEMA_VERSION;
  readonly synthetic: boolean;
  readonly calibrated: false;
  readonly variants: readonly KeywordOpportunityCalibrationEvaluation[];
  readonly flips: readonly {
    readonly candidateId: string;
    readonly fromVariant: string;
    readonly fromDisposition: KeywordOpportunityCalibrationDisposition;
    readonly toVariant: string;
    readonly toDisposition: KeywordOpportunityCalibrationDisposition;
  }[];
}

function observedOrUnknown(
  values: readonly (number | null)[],
  predicate: (value: number) => boolean,
): ObservedSignalState {
  const measured = values.filter((value): value is number => value !== null);
  if (measured.some(predicate)) return "observed";
  return values.length > 0 && measured.length === values.length
    ? "not_observed"
    : "unavailable";
}

function trafficThreshold(
  rank: number | null,
  variant: KeywordOpportunityCalibrationVariant,
): number | null {
  if (!Number.isInteger(rank) || rank === null || rank < 1 || rank > 1_000) {
    return null;
  }
  if (rank <= 200) return variant.trafficThresholds.rank1To200;
  if (rank <= 500) return variant.trafficThresholds.rank201To500;
  return variant.trafficThresholds.rank501To1000;
}

function siteRankTier(rank: number | null): KeywordOpportunityCalibrationSiteTier {
  if (!Number.isInteger(rank) || rank === null || rank < 1 || rank > 1_000) {
    return "unresolved";
  }
  if (rank <= 200) return "rank_1_200";
  if (rank <= 500) return "rank_201_500";
  return "rank_501_1000";
}

const NOT_EVALUATED_SIGNAL_STATES = {
  young_domain: "not_evaluated",
  low_organic_traffic_domain: "not_evaluated",
  community_result: "not_evaluated",
} as const satisfies KeywordOpportunityCalibrationSignalStates;

function candidateSignalStates(
  candidate: KeywordOpportunityCalibrationCandidate,
  variant: KeywordOpportunityCalibrationVariant,
): KeywordOpportunityCalibrationSignalStates {
  if (candidate.explicitZero || !candidate.serpComplete) {
    return NOT_EVALUATED_SIGNAL_STATES;
  }
  const threshold = trafficThreshold(candidate.siteDomainRank, variant);
  return {
    young_domain: observedOrUnknown(
      candidate.domainRegistrationAgeMonths,
      (age) => age <= variant.youngDomainMonths,
    ),
    low_organic_traffic_domain:
      threshold === null
        ? "unavailable"
        : observedOrUnknown(
            candidate.domainOrganicEtv,
            (etv) => etv < threshold,
          ),
    community_result:
      candidate.communityObserved === null
        ? "unavailable"
        : candidate.communityObserved
          ? "observed"
          : "not_observed",
  };
}

function evaluateCandidate(
  candidate: KeywordOpportunityCalibrationCandidate,
  variant: KeywordOpportunityCalibrationVariant,
): KeywordOpportunityCalibrationCandidateResult {
  const signalStates = candidateSignalStates(candidate, variant);
  if (candidate.explicitZero || candidate.alreadyCovered) {
    return {
      candidateId: candidate.candidateId,
      disposition: "excluded",
      positiveSignals: [],
      signalStates,
    };
  }
  if (!candidate.serpComplete) {
    return {
      candidateId: candidate.candidateId,
      disposition: "incomplete",
      positiveSignals: [],
      signalStates,
    };
  }

  const states = [
    ["young_domain", signalStates.young_domain],
    [
      "low_organic_traffic_domain",
      signalStates.low_organic_traffic_domain,
    ],
    ["community_result", signalStates.community_result],
  ] as const satisfies readonly (readonly [
    KeywordOpportunitySignal,
    KeywordOpportunityCalibrationSignalState,
  ])[];
  const positiveSignals = states
    .filter(([, state]) => state === "observed")
    .map(([signal]) => signal);
  const hasUnavailable = states.some(([, state]) => state === "unavailable");
  const disposition: KeywordOpportunityCalibrationDisposition =
    variant.unknownPolicy === "positive_first" && positiveSignals.length > 0
      ? "eligible"
      : hasUnavailable
        ? "incomplete"
        : positiveSignals.length > 0
          ? "eligible"
          : "excluded";

  return {
    candidateId: candidate.candidateId,
    disposition,
    positiveSignals,
    signalStates,
  };
}

function labelMetricSummary(
  sourceCandidates: readonly KeywordOpportunityCalibrationCandidate[],
  candidates: readonly KeywordOpportunityCalibrationCandidateResult[],
): KeywordOpportunityCalibrationLabelMetrics | null {
  const disposition = new Map(
    candidates.map((candidate) => [candidate.candidateId, candidate.disposition]),
  );
  const labelled = sourceCandidates.filter(
    (candidate) => candidate.label !== undefined,
  );
  if (labelled.length === 0) return null;
  const eligibleTrueOpportunities = labelled.filter(
    (candidate) =>
      candidate.label === "true_opportunity" &&
      disposition.get(candidate.candidateId) === "eligible",
  ).length;
  const falsePositiveEligible = labelled.filter(
    (candidate) =>
      candidate.label === "not_opportunity" &&
      disposition.get(candidate.candidateId) === "eligible",
  ).length;
  const missedTrueOpportunities = labelled.filter(
    (candidate) =>
      candidate.label === "true_opportunity" &&
      disposition.get(candidate.candidateId) !== "eligible",
  ).length;
  const eligibleLabelled = eligibleTrueOpportunities + falsePositiveEligible;
  return {
    labelledCandidates: labelled.length,
    eligibleTrueOpportunities,
    falsePositiveEligible,
    missedTrueOpportunities,
    precisionEligible:
      eligibleLabelled === 0
        ? null
        : eligibleTrueOpportunities / eligibleLabelled,
  };
}

function groupedLabelMetrics<Group extends string>(
  sourceCandidates: readonly KeywordOpportunityCalibrationCandidate[],
  candidates: readonly KeywordOpportunityCalibrationCandidateResult[],
  groups: readonly Group[],
  groupOf: (candidate: KeywordOpportunityCalibrationCandidate) => Group,
): readonly KeywordOpportunityCalibrationGroupMetrics<Group>[] {
  return groups.flatMap((group) => {
    const summary = labelMetricSummary(
      sourceCandidates.filter((candidate) => groupOf(candidate) === group),
      candidates,
    );
    return summary === null ? [] : [{ group, ...summary }];
  });
}

function labelledMetrics(
  snapshot: KeywordOpportunityCalibrationSnapshotV1,
  candidates: readonly KeywordOpportunityCalibrationCandidateResult[],
): KeywordOpportunityCalibrationLabelledMetrics | null {
  const summary = labelMetricSummary(snapshot.candidates, candidates);
  if (summary === null) return null;
  return {
    ...summary,
    byLane: groupedLabelMetrics(
      snapshot.candidates,
      candidates,
      ["seo", "geo"],
      (candidate) => candidate.lane,
    ),
    bySiteRankTier: groupedLabelMetrics(
      snapshot.candidates,
      candidates,
      ["rank_1_200", "rank_201_500", "rank_501_1000", "unresolved"],
      (candidate) => siteRankTier(candidate.siteDomainRank),
    ),
    byDiscoveryBasis: groupedLabelMetrics(
      snapshot.candidates,
      candidates,
      ["site_proposition", "traditional_expansion"],
      (candidate) => candidate.discoveryBasis,
    ),
  };
}

function signalPrevalence(
  candidates: readonly KeywordOpportunityCalibrationCandidateResult[],
): KeywordOpportunityCalibrationSignalPrevalence {
  const prevalence: Record<
    KeywordOpportunitySignal,
    Record<KeywordOpportunityCalibrationSignalState, number>
  > = {
    young_domain: {
      observed: 0,
      not_observed: 0,
      unavailable: 0,
      not_evaluated: 0,
    },
    low_organic_traffic_domain: {
      observed: 0,
      not_observed: 0,
      unavailable: 0,
      not_evaluated: 0,
    },
    community_result: {
      observed: 0,
      not_observed: 0,
      unavailable: 0,
      not_evaluated: 0,
    },
  };
  for (const candidate of candidates) {
    for (const signal of [
      "young_domain",
      "low_organic_traffic_domain",
      "community_result",
    ] as const) {
      prevalence[signal][candidate.signalStates[signal]] += 1;
    }
  }
  return prevalence;
}

export function evaluateKeywordOpportunityCalibration(
  snapshot: KeywordOpportunityCalibrationSnapshotV1,
  variant: KeywordOpportunityCalibrationVariant,
): KeywordOpportunityCalibrationEvaluation {
  const candidates = snapshot.candidates.map((candidate) =>
    evaluateCandidate(candidate, variant),
  );
  const eligible = candidates.filter(
    (candidate) => candidate.disposition === "eligible",
  ).length;
  const incomplete = candidates.filter(
    (candidate) => candidate.disposition === "incomplete",
  ).length;
  const excluded = candidates.length - eligible - incomplete;
  const denominator = candidates.length;
  return {
    id: variant.id,
    eligible,
    incomplete,
    excluded,
    yield: denominator === 0 ? 0 : eligible / denominator,
    incompleteRate: denominator === 0 ? 0 : incomplete / denominator,
    exclusionRate: denominator === 0 ? 0 : excluded / denominator,
    candidates,
    signalPrevalence: signalPrevalence(candidates),
    labelled: labelledMetrics(snapshot, candidates),
  };
}

export function compareKeywordOpportunityCalibration(
  snapshot: KeywordOpportunityCalibrationSnapshotV1,
  variants: readonly KeywordOpportunityCalibrationVariant[],
): KeywordOpportunityCalibrationComparison {
  const evaluated = variants.map((variant) =>
    evaluateKeywordOpportunityCalibration(snapshot, variant),
  );
  const baseline = evaluated[0];
  const baselineByCandidate = new Map(
    baseline?.candidates.map((candidate) => [
      candidate.candidateId,
      candidate.disposition,
    ]) ?? [],
  );
  const flips = evaluated.slice(1).flatMap((variant) =>
    variant.candidates.flatMap((candidate) => {
      const fromDisposition = baselineByCandidate.get(candidate.candidateId);
      return baseline !== undefined &&
        fromDisposition !== undefined &&
        fromDisposition !== candidate.disposition
        ? [
            {
              candidateId: candidate.candidateId,
              fromVariant: baseline.id,
              fromDisposition,
              toVariant: variant.id,
              toDisposition: candidate.disposition,
            },
          ]
        : [];
    }),
  );
  return {
    schemaVersion: KEYWORD_OPPORTUNITY_CALIBRATION_SCHEMA_VERSION,
    synthetic: snapshot.synthetic,
    calibrated: false,
    variants: evaluated,
    flips,
  };
}
