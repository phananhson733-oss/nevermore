import { describe, expect, it } from "vitest";
import {
  CompetitorMonitorResponse,
  UpdateCompetitorMonitorRequest,
} from "./competitor-monitor.ts";

const ids = {
  project: "10000000-0000-4000-8000-000000000001",
  competitor: "10000000-0000-4000-8000-000000000002",
  signal: "10000000-0000-4000-8000-000000000003",
  snapshot: "10000000-0000-4000-8000-000000000004",
  previousSnapshot: "10000000-0000-4000-8000-000000000005",
  topic: "10000000-0000-4000-8000-000000000006",
  keyword: "10000000-0000-4000-8000-000000000007",
} as const;

const now = "2026-07-28T00:00:00.000Z";

function response(): CompetitorMonitorResponse {
  return {
    projectId: ids.project,
    config: {
      enabled: true,
      frequency: "monthly" as const,
      revision: 3,
      updatedAt: now,
    },
    scope: {
      market: "US",
      languageTag: "en-US",
      topicModelRevision: 4,
    },
    availability: "available" as const,
    limitation: null,
    competitors: [
      {
        competitorId: ids.competitor,
        domain: "competitor.example",
        name: "Competitor",
        relationship: "direct" as const,
        analysisScopes: ["content", "serp_visibility"],
        eligibility: "eligible" as const,
        collectionState: "collected" as const,
        evaluationState: "available" as const,
        lastCollectionAt: now,
        nextCollectionAt: "2026-08-28T00:00:00.000Z",
        limitation: null,
        recentSignals: [
          {
            signalId: ids.signal,
            kind: "rank_gain" as const,
            competitorId: ids.competitor,
            detectedAt: now,
            currentSnapshotId: ids.snapshot,
            previousSnapshotId: ids.previousSnapshot,
            topicNodeId: ids.topic,
            topicLabel: "Customer onboarding",
            keywordId: ids.keyword,
            keyword: "customer onboarding automation",
            previousRank: 13,
            currentRank: 7,
            improvement: 6,
            limitation: null,
            opportunityUpdate: {
              state: "ready" as const,
              growthMapSection: "competitor_library" as const,
              sourceRef: `competitor_monitor_signal:${ids.signal}`,
            },
          },
        ],
      },
    ],
    generatedAt: now,
  };
}

describe("competitor monitor contracts", () => {
  it("accepts the real monthly configuration command and rejects unsupported cadence", () => {
    expect(
      UpdateCompetitorMonitorRequest.parse({
        expectedRevision: 2,
        enabled: true,
        frequency: "monthly",
      }),
    ).toEqual({
      expectedRevision: 2,
      enabled: true,
      frequency: "monthly",
    });
    expect(() =>
      UpdateCompetitorMonitorRequest.parse({
        expectedRevision: 2,
        enabled: true,
        frequency: "daily",
      }),
    ).toThrow();
  });

  it("keeps a rank gain strictly greater than five positions and tied to two real snapshots", () => {
    expect(CompetitorMonitorResponse.parse(response())).toMatchObject({
      availability: "available",
      competitors: [
        {
          recentSignals: [
            {
              kind: "rank_gain",
              previousRank: 13,
              currentRank: 7,
              improvement: 6,
            },
          ],
        },
      ],
    });
    const exactlyFive = response();
    const originalSignal =
      exactlyFive.competitors[0]!.recentSignals[0]!;
    if (originalSignal.kind !== "rank_gain") {
      throw new Error("expected rank_gain fixture");
    }
    exactlyFive.competitors[0]!.recentSignals[0] = {
      ...originalSignal,
      previousRank: 12,
      currentRank: 7,
      improvement: 5,
    };
    expect(() => CompetitorMonitorResponse.parse(exactlyFive)).toThrow();
  });

  it("names newly detected content without claiming a proven publication date", () => {
    const value = response();
    value.competitors[0]!.recentSignals = [
      {
        signalId: ids.signal,
        kind: "new_content_overlap",
        competitorId: ids.competitor,
        detectedAt: now,
        currentSnapshotId: ids.snapshot,
        previousSnapshotId: ids.previousSnapshot,
        topicNodeId: ids.topic,
        topicLabel: "Customer onboarding",
        url: "https://competitor.example/blog/onboarding",
        matchedKeywordIds: [
          ids.keyword,
          "10000000-0000-4000-8000-000000000008",
        ],
        overlapRatio: 0.67,
        publicationEvidence: "first_observed_in_ranked_keywords",
        limitation:
          "首次在可比排名采集中观察到该 URL；DataForSEO 不提供发布时间。",
        opportunityUpdate: {
          state: "ready",
          growthMapSection: "competitor_library",
          sourceRef: `competitor_monitor_signal:${ids.signal}`,
        },
      },
    ] as never;
    expect(
      CompetitorMonitorResponse.parse(value).competitors[0]?.recentSignals[0]
        ?.kind,
    ).toBe("new_content_overlap");
    expect(JSON.stringify(value)).not.toMatch(/publishedAt|publicationDate/u);
  });

  it("forbids signals when a competitor is baseline or unavailable", () => {
    for (const evaluationState of ["baseline", "unavailable"] as const) {
      const value = response();
      value.competitors[0] = {
        ...value.competitors[0]!,
        evaluationState,
        recentSignals: [],
        limitation:
          evaluationState === "baseline"
            ? "首次采集仅建立 baseline。"
            : "缺少可比历史窗口。",
      };
      expect(CompetitorMonitorResponse.parse(value)).toBeTruthy();

      value.competitors[0]!.recentSignals =
        response().competitors[0]!.recentSignals;
      expect(() => CompetitorMonitorResponse.parse(value)).toThrow();
    }
  });

  it("rejects duplicated frozen analysis scopes", () => {
    const value = response();
    value.competitors[0]!.analysisScopes = [
      "content",
      "content",
    ] as never;
    expect(() => CompetitorMonitorResponse.parse(value)).toThrow();
  });

  it("requires a limitation and null scope for project-level unavailable state", () => {
    const value = response();
    value.availability = "unavailable";
    value.scope = null as never;
    value.limitation = "目标市场或语言不是唯一值。";
    value.competitors = [];
    expect(CompetitorMonitorResponse.parse(value)).toBeTruthy();

    value.limitation = null;
    expect(() => CompetitorMonitorResponse.parse(value)).toThrow();
  });
});
