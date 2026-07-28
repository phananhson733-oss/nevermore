import { describe, expect, it } from "vitest";
import {
  GrowthMapKeywordRankHistory,
  GrowthMapKeywordRankPoint,
} from "./growth-map.ts";

const ids = {
  project: "10000000-0000-4000-8000-000000000001",
  keyword: "10000000-0000-4000-8000-000000000002",
  page: "10000000-0000-4000-8000-000000000003",
  occurrenceA: "10000000-0000-4000-8000-000000000004",
  occurrenceB: "10000000-0000-4000-8000-000000000005",
  snapshotA: "10000000-0000-4000-8000-000000000006",
  snapshotB: "10000000-0000-4000-8000-000000000007",
  observationA: "10000000-0000-4000-8000-000000000008",
  observationB: "10000000-0000-4000-8000-000000000009",
  receipt: "10000000-0000-4000-8000-000000000010",
  attempt: "10000000-0000-4000-8000-000000000011",
  artifact: "10000000-0000-4000-8000-000000000012",
} as const;

const endedAt = "2026-07-27T12:00:00.000Z";
const startedAt = "2026-04-28T12:00:00.000Z";

function absolutePoint() {
  return {
    occurrenceId: ids.occurrenceA,
    snapshotId: ids.snapshotA,
    observationId: ids.observationA,
    provider: "dataforseo" as const,
    metric: "absolute_rank" as const,
    value: 12,
    valuePointer: "/valueJson/currentRank",
    observedAt: "2026-06-01T12:00:00.000Z",
    providerDataAsOf: null,
    grade: "B" as const,
    limitation:
      "DataForSEO exposes an absolute observed rank but no provider data-as-of timestamp.",
  };
}

function gscPoint() {
  return {
    occurrenceId: ids.occurrenceB,
    snapshotId: ids.snapshotB,
    observationId: ids.observationB,
    provider: "gsc" as const,
    metric: "gsc_28d_average_position" as const,
    value: 9.4,
    valuePointer: "/valueJson/topQueries/0/position",
    observedAt: "2026-07-01T12:00:00.000Z",
    providerDataAsOf: "2026-06-30T23:59:59.000Z",
    grade: "A" as const,
    limitation:
      "GSC position is an impression-weighted 28-day average, not an absolute SERP rank.",
  };
}

function history() {
  return {
    projectId: ids.project,
    keywordId: ids.keyword,
    mappedPage: {
      sitePageId: ids.page,
      normalizedUrl: "https://example.com/blog/onboarding/",
    },
    window: { startedAt, endedAt, days: 90 as const },
    series: [
      {
        provider: "dataforseo" as const,
        metric: "absolute_rank" as const,
        points: [absolutePoint()],
        interpretation:
          "Absolute Google organic rank observed by DataForSEO.",
      },
      {
        provider: "gsc" as const,
        metric: "gsc_28d_average_position" as const,
        points: [gscPoint()],
        interpretation:
          "GSC rolling 28-day impression-weighted average position.",
      },
    ],
    changeMarkers: [
      {
        changeReceiptId: ids.receipt,
        publicationAttemptId: ids.attempt,
        attemptKind: "publish" as const,
        artifactId: ids.artifact,
        artifactRevision: 2,
        targetRef: "/blog/onboarding/",
        liveCanonicalUrl: "https://example.com/blog/onboarding/",
        changedAt: "2026-06-15T12:00:00.000Z",
      },
    ],
    coverage: {
      availability: "partial" as const,
      limitations: [
        "DataForSEO does not expose a provider data-as-of timestamp.",
      ],
    },
    generatedAt: endedAt,
  };
}

describe("GrowthMapKeywordRankHistory", () => {
  it("keeps absolute rank and GSC average position in distinct series", () => {
    expect(GrowthMapKeywordRankHistory.parse(history())).toMatchObject({
      projectId: ids.project,
      keywordId: ids.keyword,
      series: [
        { provider: "dataforseo", metric: "absolute_rank" },
        { provider: "gsc", metric: "gsc_28d_average_position" },
      ],
    });
  });

  it("rejects a GSC average position disguised as absolute rank", () => {
    expect(
      GrowthMapKeywordRankPoint.safeParse({
        ...gscPoint(),
        metric: "absolute_rank",
      }).success,
    ).toBe(false);
  });

  it("rejects points outside the exact trailing 90-day window", () => {
    const input = history();
    const firstSeries = input.series[0];
    if (!firstSeries || firstSeries.provider !== "dataforseo") {
      throw new Error("Expected the DataForSEO fixture series.");
    }
    firstSeries.points[0] = {
      ...absolutePoint(),
      observedAt: "2026-04-28T11:59:59.999Z",
    };
    expect(GrowthMapKeywordRankHistory.safeParse(input).success).toBe(
      false,
    );
  });

  it("requires unavailable coverage when no rank series exists", () => {
    expect(
      GrowthMapKeywordRankHistory.safeParse({
        ...history(),
        series: [],
        coverage: { availability: "partial", limitations: ["No data."] },
      }).success,
    ).toBe(false);
  });

  it("does not allow change markers without a canonical mapped page", () => {
    expect(
      GrowthMapKeywordRankHistory.safeParse({
        ...history(),
        mappedPage: null,
      }).success,
    ).toBe(false);
  });
});
