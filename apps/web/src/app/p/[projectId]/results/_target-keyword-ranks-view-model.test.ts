import { describe, expect, it } from "vitest";
import type { MeasurementTargetKeywordRank } from "@sf/contracts";

import {
  targetKeywordGrowthMapHref,
  targetKeywordRankLimitationKey,
  targetKeywordRankRow,
} from "./_target-keyword-ranks-view-model";

const KEYWORD_ID = "d1000000-0000-4000-8000-000000000004";

function keyword(
  overrides: Partial<MeasurementTargetKeywordRank> = {},
): MeasurementTargetKeywordRank {
  return {
    keywordId: KEYWORD_ID,
    displayKeyword: "customer onboarding automation",
    normalizedKeyword: "customer onboarding automation",
    marketCode: "US",
    languageTag: "en-US",
    topicNodeId: "d1000000-0000-4000-8000-000000000005",
    topicLabel: "Customer onboarding",
    topicModelRevision: 3,
    state: "observed",
    baselineObservation: {
      occurrenceId: "d1000000-0000-4000-8000-000000000006",
      snapshotId: "d1000000-0000-4000-8000-000000000007",
      observationId: "d1000000-0000-4000-8000-000000000008",
      provider: "dataforseo",
      metric: "absolute_rank",
      value: 12,
      valuePointer: "/valueJson/currentRank",
      observedAt: "2026-05-20T00:00:00.000Z",
      providerDataAsOf: null,
      grade: "B",
      limitation:
        "DataForSEO does not expose a provider data-as-of timestamp.",
    },
    outcomeObservation: {
      occurrenceId: "d1000000-0000-4000-8000-000000000009",
      snapshotId: "d1000000-0000-4000-8000-00000000000a",
      observationId: "d1000000-0000-4000-8000-00000000000b",
      provider: "dataforseo",
      metric: "absolute_rank",
      value: 7,
      valuePointer: "/valueJson/currentRank",
      observedAt: "2026-07-20T00:00:00.000Z",
      providerDataAsOf: null,
      grade: "B",
      limitation:
        "DataForSEO does not expose a provider data-as-of timestamp.",
    },
    rankImprovement: 5,
    trend: "improved",
    limitation: null,
    ...overrides,
  };
}

describe("target Keyword rank view model", () => {
  it("preserves the positive-is-improved absolute-rank direction", () => {
    expect(targetKeywordRankRow(keyword())).toMatchObject({
      baselineRank: 12,
      outcomeRank: 7,
      improvement: 5,
      trend: "improved",
    });
  });

  it("does not manufacture a zero when either window is missing", () => {
    expect(
      targetKeywordRankRow(
        keyword({
          state: "insufficient_data",
          outcomeObservation: null,
          rankImprovement: null,
          trend: "unavailable",
          limitation:
            "The outcome window has no DataForSEO absolute-rank observation.",
        }),
      ),
    ).toMatchObject({
      baselineRank: 12,
      outcomeRank: null,
      improvement: null,
      trend: "unavailable",
    });
  });

  it("deep-links to the exact canonical Keyword in Growth Map", () => {
    expect(
      targetKeywordGrowthMapHref("project-1", KEYWORD_ID),
    ).toBe(
      `/p/project-1/growth-map?object=keywords&selectedKeywordId=${KEYWORD_ID}`,
    );
  });

  it("maps locale-neutral authority limitations to stable UI copy keys", () => {
    expect(
      targetKeywordRankLimitationKey(
        "No confirmed target Keywords are mapped to this exact page.",
      ),
    ).toBe("noConfirmedTargets");
    expect(
      targetKeywordRankLimitationKey(
        "DataForSEO absolute rank is compared by collection observation time because the provider does not expose a separate data-as-of timestamp.",
      ),
    ).toBe("noProviderDataAsOf");
    expect(
      targetKeywordRankLimitationKey("future authority limitation"),
    ).toBe("unknown");
  });
});
