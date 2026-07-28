import { describe, expect, it } from "vitest";
import {
  MeasurementTargetKeywordRanks,
  type MeasurementTargetKeywordRanks as MeasurementTargetKeywordRanksType,
} from "./measurement-keyword-ranks.ts";

const IDS = {
  project: "d1000000-0000-4000-8000-000000000001",
  window: "d1000000-0000-4000-8000-000000000002",
  page: "d1000000-0000-4000-8000-000000000003",
  keyword: "d1000000-0000-4000-8000-000000000004",
  topic: "d1000000-0000-4000-8000-000000000005",
  baselineOccurrence: "d1000000-0000-4000-8000-000000000006",
  baselineSnapshot: "d1000000-0000-4000-8000-000000000007",
  baselineObservation: "d1000000-0000-4000-8000-000000000008",
  outcomeOccurrence: "d1000000-0000-4000-8000-000000000009",
  outcomeSnapshot: "d1000000-0000-4000-8000-00000000000a",
  outcomeObservation: "d1000000-0000-4000-8000-00000000000b",
} as const;

function rankPoint(
  phase: "baseline" | "outcome",
  value: number,
) {
  return {
    occurrenceId:
      phase === "baseline"
        ? IDS.baselineOccurrence
        : IDS.outcomeOccurrence,
    snapshotId:
      phase === "baseline"
        ? IDS.baselineSnapshot
        : IDS.outcomeSnapshot,
    observationId:
      phase === "baseline"
        ? IDS.baselineObservation
        : IDS.outcomeObservation,
    provider: "dataforseo" as const,
    metric: "absolute_rank" as const,
    value,
    valuePointer: "/valueJson/currentRank" as const,
    observedAt:
      phase === "baseline"
        ? "2026-05-20T00:00:00.000Z"
        : "2026-07-20T00:00:00.000Z",
    providerDataAsOf: null,
    grade: "B" as const,
    limitation:
      "DataForSEO does not expose a provider data-as-of timestamp.",
  };
}

function result(): MeasurementTargetKeywordRanksType {
  return {
    projectId: IDS.project,
    measurementWindowId: IDS.window,
    sitePageId: IDS.page,
    canonicalUrl: "https://example.com/customer-onboarding/",
    beforeWindow: {
      startAt: "2026-05-01T00:00:00.000Z",
      endAt: "2026-05-29T00:00:00.000Z",
    },
    afterWindow: {
      startAt: "2026-06-29T00:00:00.000Z",
      endAt: "2026-07-27T00:00:00.000Z",
    },
    interpretation:
      "dataforseo_absolute_rank_observational_non_causal",
    keywords: [
      {
        keywordId: IDS.keyword,
        displayKeyword: "customer onboarding automation",
        normalizedKeyword: "customer onboarding automation",
        marketCode: "US",
        languageTag: "en-US",
        topicNodeId: IDS.topic,
        topicLabel: "Customer onboarding",
        topicModelRevision: 3,
        state: "observed",
        baselineObservation: rankPoint("baseline", 12),
        outcomeObservation: rankPoint("outcome", 7),
        rankImprovement: 5,
        trend: "improved",
        limitation: null,
      },
    ],
    coverage: { availability: "available", limitations: [] },
    generatedAt: "2026-07-27T00:00:00.000Z",
  };
}

describe("MeasurementTargetKeywordRanks", () => {
  it("keeps DataForSEO absolute rank separate and gives improvement a positive direction", () => {
    expect(MeasurementTargetKeywordRanks.parse(result())).toMatchObject({
      keywords: [
        {
          rankImprovement: 5,
          trend: "improved",
          baselineObservation: {
            provider: "dataforseo",
            metric: "absolute_rank",
          },
        },
      ],
    });
  });

  it("requires missing-window evidence to remain explicitly unavailable", () => {
    const input = result();
    expect(
      MeasurementTargetKeywordRanks.safeParse({
        ...input,
        keywords: [
          {
            ...input.keywords[0],
            state: "insufficient_data",
            outcomeObservation: null,
            rankImprovement: 5,
            trend: "improved",
            limitation: null,
          },
        ],
        coverage: {
          availability: "partial",
          limitations: ["The outcome window has no rank observation."],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects GSC average position disguised as target absolute rank", () => {
    const input = result();
    expect(
      MeasurementTargetKeywordRanks.safeParse({
        ...input,
        keywords: [
          {
            ...input.keywords[0],
            baselineObservation: {
              ...input.keywords[0]!.baselineObservation!,
              provider: "gsc",
              metric: "gsc_28d_average_position",
              grade: "A",
              valuePointer: "/valueJson/topQueries/0/position",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("enforces half-open baseline and outcome windows", () => {
    const input = result();
    expect(
      MeasurementTargetKeywordRanks.safeParse({
        ...input,
        keywords: [
          {
            ...input.keywords[0],
            baselineObservation: {
              ...input.keywords[0]!.baselineObservation!,
              observedAt: input.beforeWindow.endAt,
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("reports no confirmed target keywords as unavailable without inventing zero", () => {
    expect(
      MeasurementTargetKeywordRanks.parse({
        ...result(),
        keywords: [],
        coverage: {
          availability: "unavailable",
          limitations: [
            "No confirmed target Keywords are mapped to this exact page.",
          ],
        },
      }),
    ).toMatchObject({
      keywords: [],
      coverage: { availability: "unavailable" },
    });
  });
});
