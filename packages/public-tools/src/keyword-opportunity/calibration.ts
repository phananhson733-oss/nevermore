// @input  -- anonymous raw keyword-signal snapshots plus explicit policy variants
// @output -- deterministic yield, flip and optional human-label calibration metrics
// @pos    -- offline replay only; never calls providers or claims synthetic data is calibrated

import type {
  KeywordOpportunityBasis,
  KeywordOpportunityLane,
  KeywordOpportunitySignal,
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

export interface KeywordOpportunityCalibrationCandidateResult {
  readonly candidateId: string;
  readonly disposition: KeywordOpportunityCalibrationDisposition;
  readonly positiveSignals: readonly KeywordOpportunitySignal[];
}

export interface KeywordOpportunityCalibrationLabelledMetrics {
  readonly labelledCandidates: number;
  readonly eligibleTrueOpportunities: number;
  readonly falsePositiveEligible: number;
  readonly missedTrueOpportunities: number;
  readonly precisionEligible: number | null;
}

export interface KeywordOpportunityCalibrationEvaluation {
  readonly id: string;
  readonly eligible: number;
  readonly incomplete: number;
  readonly excluded: number;
  readonly yield: number;
  readonly incompleteRate: number;
  readonly exclusionRate: number;
  readonly candidates: readonly KeywordOpportunityCalibrationCandidateResult[];
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

type SignalState = "observed" | "not_observed" | "unavailable";

function observedOrUnknown(
  values: readonly (number | null)[],
  predicate: (value: number) => boolean,
): SignalState {
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

function evaluateCandidate(
  candidate: KeywordOpportunityCalibrationCandidate,
  variant: KeywordOpportunityCalibrationVariant,
): KeywordOpportunityCalibrationCandidateResult {
  if (candidate.explicitZero || candidate.alreadyCovered) {
    return {
      candidateId: candidate.candidateId,
      disposition: "excluded",
      positiveSignals: [],
    };
  }
  if (!candidate.serpComplete) {
    return {
      candidateId: candidate.candidateId,
      disposition: "incomplete",
      positiveSignals: [],
    };
  }

  const threshold = trafficThreshold(candidate.siteDomainRank, variant);
  const states = [
    [
      "young_domain",
      observedOrUnknown(
        candidate.domainRegistrationAgeMonths,
        (age) => age <= variant.youngDomainMonths,
      ),
    ],
    [
      "low_organic_traffic_domain",
      threshold === null
        ? "unavailable"
        : observedOrUnknown(
            candidate.domainOrganicEtv,
            (etv) => etv < threshold,
          ),
    ],
    [
      "community_result",
      candidate.communityObserved === null
        ? "unavailable"
        : candidate.communityObserved
          ? "observed"
          : "not_observed",
    ],
  ] as const satisfies readonly (readonly [KeywordOpportunitySignal, SignalState])[];
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

  return { candidateId: candidate.candidateId, disposition, positiveSignals };
}

function labelledMetrics(
  snapshot: KeywordOpportunityCalibrationSnapshotV1,
  candidates: readonly KeywordOpportunityCalibrationCandidateResult[],
): KeywordOpportunityCalibrationLabelledMetrics | null {
  const disposition = new Map(
    candidates.map((candidate) => [candidate.candidateId, candidate.disposition]),
  );
  const labelled = snapshot.candidates.filter(
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
