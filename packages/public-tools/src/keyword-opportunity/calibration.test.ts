import { describe, expect, it } from "vitest";

import {
  compareKeywordOpportunityCalibration,
  evaluateKeywordOpportunityCalibration,
  type KeywordOpportunityCalibrationSnapshotV1,
  type KeywordOpportunityCalibrationVariant,
} from "./calibration.ts";

const SNAPSHOT: KeywordOpportunityCalibrationSnapshotV1 = {
  schemaVersion: "keyword_opportunity_calibration_snapshot.v1",
  synthetic: true,
  candidates: [
    {
      candidateId: "positive-with-unknown",
      lane: "seo",
      discoveryBasis: "traditional_expansion",
      siteDomainRank: 180,
      explicitZero: false,
      alreadyCovered: false,
      serpComplete: true,
      domainRegistrationAgeMonths: [12, null],
      domainOrganicEtv: [20_000, null],
      communityObserved: false,
      label: "true_opportunity",
    },
    {
      candidateId: "traffic-threshold-flip",
      lane: "seo",
      discoveryBasis: "traditional_expansion",
      siteDomainRank: 180,
      explicitZero: false,
      alreadyCovered: false,
      serpComplete: true,
      domainRegistrationAgeMonths: [48, 60],
      domainOrganicEtv: [6_000, 20_000],
      communityObserved: false,
      label: "true_opportunity",
    },
    {
      candidateId: "completed-negative",
      lane: "geo",
      discoveryBasis: "site_proposition",
      siteDomainRank: 180,
      explicitZero: false,
      alreadyCovered: false,
      serpComplete: true,
      domainRegistrationAgeMonths: [48, 60],
      domainOrganicEtv: [20_000, 30_000],
      communityObserved: false,
      label: "not_opportunity",
    },
  ],
};

const STRICT: KeywordOpportunityCalibrationVariant = {
  id: "strict-v2",
  unknownPolicy: "strict_unknown_first",
  youngDomainMonths: 24,
  trafficThresholds: {
    rank1To200: 5_000,
    rank201To500: 50_000,
    rank501To1000: 100_000,
  },
};

const POSITIVE_FIRST: KeywordOpportunityCalibrationVariant = {
  ...STRICT,
  id: "positive-first-v3",
  unknownPolicy: "positive_first",
};

describe("keyword opportunity calibration replay", () => {
  it("compares strict unknown-first with positive-first without mutating the snapshot", () => {
    const before = structuredClone(SNAPSHOT);
    const compared = compareKeywordOpportunityCalibration(SNAPSHOT, [
      STRICT,
      POSITIVE_FIRST,
    ]);

    expect(compared.variants).toEqual([
      expect.objectContaining({
        id: "strict-v2",
        eligible: 0,
        incomplete: 1,
        excluded: 2,
        signalPrevalence: {
          young_domain: {
            observed: 1,
            not_observed: 2,
            unavailable: 0,
            not_evaluated: 0,
          },
          low_organic_traffic_domain: {
            observed: 0,
            not_observed: 2,
            unavailable: 1,
            not_evaluated: 0,
          },
          community_result: {
            observed: 0,
            not_observed: 3,
            unavailable: 0,
            not_evaluated: 0,
          },
        },
        labelled: expect.objectContaining({ missedTrueOpportunities: 2 }),
      }),
      expect.objectContaining({
        id: "positive-first-v3",
        eligible: 1,
        incomplete: 0,
        excluded: 2,
        labelled: expect.objectContaining({
          eligibleTrueOpportunities: 1,
          missedTrueOpportunities: 1,
          byLane: [
            expect.objectContaining({
              group: "seo",
              labelledCandidates: 2,
              eligibleTrueOpportunities: 1,
              missedTrueOpportunities: 1,
            }),
            expect.objectContaining({
              group: "geo",
              labelledCandidates: 1,
              eligibleTrueOpportunities: 0,
              falsePositiveEligible: 0,
            }),
          ],
          bySiteRankTier: [
            expect.objectContaining({
              group: "rank_1_200",
              labelledCandidates: 3,
            }),
          ],
          byDiscoveryBasis: [
            expect.objectContaining({
              group: "site_proposition",
              labelledCandidates: 1,
            }),
            expect.objectContaining({
              group: "traditional_expansion",
              labelledCandidates: 2,
            }),
          ],
        }),
      }),
    ]);
    expect(compared.flips).toEqual([
      {
        candidateId: "positive-with-unknown",
        fromVariant: "strict-v2",
        fromDisposition: "incomplete",
        toVariant: "positive-first-v3",
        toDisposition: "eligible",
      },
    ]);
    expect(SNAPSHOT).toEqual(before);
  });

  it("replays a candidate traffic threshold without calling a provider", () => {
    const relaxed = evaluateKeywordOpportunityCalibration(SNAPSHOT, {
      ...POSITIVE_FIRST,
      id: "weak-tier-10k",
      trafficThresholds: {
        ...POSITIVE_FIRST.trafficThresholds,
        rank1To200: 10_000,
      },
    });

    expect(relaxed.eligible).toBe(2);
    expect(relaxed.candidates).toContainEqual(
      expect.objectContaining({
        candidateId: "traffic-threshold-flip",
        disposition: "eligible",
        positiveSignals: ["low_organic_traffic_domain"],
      }),
    );
  });

  it("reports label-free yield metrics without inventing precision", () => {
    const unlabelled: KeywordOpportunityCalibrationSnapshotV1 = {
      ...SNAPSHOT,
      candidates: SNAPSHOT.candidates.map(({ label: _label, ...candidate }) =>
        candidate,
      ),
    };
    const result = evaluateKeywordOpportunityCalibration(
      unlabelled,
      POSITIVE_FIRST,
    );

    expect(result.yield).toBeCloseTo(1 / 3);
    expect(result.signalPrevalence.young_domain.observed).toBe(1);
    expect(result.labelled).toBeNull();
  });

  it("keeps unmeasured signals and unresolved rank tiers explicit", () => {
    const snapshot: KeywordOpportunityCalibrationSnapshotV1 = {
      ...SNAPSHOT,
      candidates: [
        {
          ...SNAPSHOT.candidates[0]!,
          candidateId: "explicit-zero-unresolved-tier",
          siteDomainRank: null,
          explicitZero: true,
        },
      ],
    };

    const result = evaluateKeywordOpportunityCalibration(
      snapshot,
      POSITIVE_FIRST,
    );

    expect(result.signalPrevalence).toEqual({
      young_domain: {
        observed: 0,
        not_observed: 0,
        unavailable: 0,
        not_evaluated: 1,
      },
      low_organic_traffic_domain: {
        observed: 0,
        not_observed: 0,
        unavailable: 0,
        not_evaluated: 1,
      },
      community_result: {
        observed: 0,
        not_observed: 0,
        unavailable: 0,
        not_evaluated: 1,
      },
    });
    expect(result.labelled?.bySiteRankTier).toEqual([
      expect.objectContaining({
        group: "unresolved",
        labelledCandidates: 1,
      }),
    ]);
  });
});
