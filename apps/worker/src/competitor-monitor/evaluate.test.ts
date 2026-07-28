import { describe, expect, it } from "vitest";
import {
  evaluateCompetitorMonitor,
  type CompetitorRankedKeywordFact,
  type ConfirmedTopicKeywordSet,
} from "./evaluate.ts";

const topic: ConfirmedTopicKeywordSet = {
  topicNodeId: "10000000-0000-4000-8000-000000000001",
  topicLabel: "Customer onboarding",
  keywords: [
    {
      keywordId: "10000000-0000-4000-8000-000000000002",
      displayKeyword: "customer onboarding automation",
      normalizedKeyword: "customer onboarding automation",
    },
    {
      keywordId: "10000000-0000-4000-8000-000000000003",
      displayKeyword: "onboarding workflow",
      normalizedKeyword: "onboarding workflow",
    },
    {
      keywordId: "10000000-0000-4000-8000-000000000004",
      displayKeyword: "customer onboarding checklist",
      normalizedKeyword: "customer onboarding checklist",
    },
  ],
};

function row(
  keyword: string,
  rank: number,
  currentUrl = "https://competitor.example/blog/onboarding",
): CompetitorRankedKeywordFact {
  return {
    normalizedKeyword: keyword,
    currentRank: rank,
    currentUrl,
  };
}

describe("evaluateCompetitorMonitor", () => {
  it("uses the first complete collection only as a baseline", () => {
    expect(
      evaluateCompetitorMonitor({
        competitorDomain: "competitor.example",
        analysisScopes: ["content", "serp_visibility"],
        current: {
          snapshotId: "10000000-0000-4000-8000-000000000010",
          capturedAt: "2026-07-28T00:00:00.000Z",
          availability: "available",
          rows: [row("customer onboarding automation", 7)],
        },
        previous: null,
        topics: [topic],
      }),
    ).toEqual({
      evaluationState: "baseline",
      limitation: "首次采集仅建立 baseline，不生成竞品动态提醒。",
      signals: [],
    });
  });

  it("detects only a greater-than-five absolute rank improvement in a comparable monthly window", () => {
    const result = evaluateCompetitorMonitor({
      competitorDomain: "competitor.example",
      analysisScopes: ["content", "serp_visibility"],
      current: {
        snapshotId: "10000000-0000-4000-8000-000000000010",
        capturedAt: "2026-07-28T00:00:00.000Z",
        availability: "partial",
        rows: [
          row("customer onboarding automation", 7),
          row("onboarding workflow", 5),
        ],
      },
      previous: {
        snapshotId: "10000000-0000-4000-8000-000000000011",
        capturedAt: "2026-06-28T00:00:00.000Z",
        availability: "partial",
        rows: [
          row("customer onboarding automation", 13),
          row("onboarding workflow", 10),
        ],
      },
      topics: [topic],
    });

    expect(result.evaluationState).toBe("available");
    expect(result.signals).toEqual([
      expect.objectContaining({
        kind: "rank_gain",
        keywordId: topic.keywords[0]?.keywordId,
        previousRank: 13,
        currentRank: 7,
        improvement: 6,
      }),
    ]);
    expect(result.signals).not.toContainEqual(
      expect.objectContaining({
        keywordId: topic.keywords[1]?.keywordId,
      }),
    );
  });

  it("bounds one monthly evaluation to 100 deterministic signals and discloses the truncation", () => {
    const keywords = Array.from({ length: 101 }, (_, index) => {
      const suffix = String(index + 1).padStart(12, "0");
      const keyword = `competitor keyword ${String(index + 1).padStart(3, "0")}`;
      return {
        keywordId: `11000000-0000-4000-8000-${suffix}`,
        displayKeyword: keyword,
        normalizedKeyword: keyword,
      };
    });
    const largeTopic: ConfirmedTopicKeywordSet = {
      topicNodeId: "11000000-0000-4000-8000-000000000999",
      topicLabel: "Large confirmed Topic",
      keywords,
    };
    const result = evaluateCompetitorMonitor({
      competitorDomain: "competitor.example",
      analysisScopes: ["serp_visibility"],
      current: {
        snapshotId: "11000000-0000-4000-8000-000000000010",
        capturedAt: "2026-07-28T00:00:00.000Z",
        availability: "available",
        rows: keywords.map((keyword) => row(keyword.normalizedKeyword, 1)),
      },
      previous: {
        snapshotId: "11000000-0000-4000-8000-000000000011",
        capturedAt: "2026-06-28T00:00:00.000Z",
        availability: "available",
        rows: keywords.map((keyword) => row(keyword.normalizedKeyword, 10)),
      },
      topics: [largeTopic],
    });

    expect(result.evaluationState).toBe("available");
    expect(result.signals).toHaveLength(100);
    expect(result.signals[0]).toMatchObject({
      kind: "rank_gain",
      keywordId: keywords[0]?.keywordId,
    });
    expect(result.signals.at(-1)).toMatchObject({
      kind: "rank_gain",
      keywordId: keywords[99]?.keywordId,
    });
    expect(result.signals).not.toContainEqual(
      expect.objectContaining({ keywordId: keywords[100]?.keywordId }),
    );
    expect(result.limitation).toMatch(/100/u);
  });

  it("detects a newly observed URL only from two complete comparable snapshots and a high confirmed-topic overlap", () => {
    const result = evaluateCompetitorMonitor({
      competitorDomain: "competitor.example",
      analysisScopes: ["content", "serp_visibility"],
      current: {
        snapshotId: "10000000-0000-4000-8000-000000000010",
        capturedAt: "2026-07-28T00:00:00.000Z",
        availability: "available",
        rows: [
          row("customer onboarding automation", 7),
          row("onboarding workflow", 9),
          row(
            "customer onboarding checklist",
            10,
            "https://competitor.example/old",
          ),
        ],
      },
      previous: {
        snapshotId: "10000000-0000-4000-8000-000000000011",
        capturedAt: "2026-06-28T00:00:00.000Z",
        availability: "available",
        rows: [
          row(
            "customer onboarding checklist",
            11,
            "https://competitor.example/old",
          ),
        ],
      },
      topics: [topic],
    });

    expect(result.signals).toContainEqual({
      kind: "new_content_overlap",
      topicNodeId: topic.topicNodeId,
      topicLabel: topic.topicLabel,
      url: "https://competitor.example/blog/onboarding",
      matchedKeywordIds: [
        topic.keywords[0]?.keywordId,
        topic.keywords[1]?.keywordId,
      ],
      overlapRatio: 0.666667,
      limitation:
        "首次在两个完整、可比的 DataForSEO 排名采集中观察到该 URL；这不是发布日期证明。",
    });
  });

  it("does not call a URL new when either snapshot is partial", () => {
    const result = evaluateCompetitorMonitor({
      competitorDomain: "competitor.example",
      analysisScopes: ["content", "serp_visibility"],
      current: {
        snapshotId: "10000000-0000-4000-8000-000000000010",
        capturedAt: "2026-07-28T00:00:00.000Z",
        availability: "partial",
        rows: [
          row("customer onboarding automation", 7),
          row("onboarding workflow", 9),
        ],
      },
      previous: {
        snapshotId: "10000000-0000-4000-8000-000000000011",
        capturedAt: "2026-06-28T00:00:00.000Z",
        availability: "available",
        rows: [],
      },
      topics: [topic],
    });
    expect(result.signals).not.toContainEqual(
      expect.objectContaining({ kind: "new_content_overlap" }),
    );
    expect(result.limitation).toMatch(/不判断.*新发现内容/u);
  });

  it.each([
    {
      name: "missing confirmed topics",
      previousAt: "2026-06-28T00:00:00.000Z",
      topics: [],
      limitation: /已确认 Topic/u,
    },
    {
      name: "too-short window",
      previousAt: "2026-07-20T00:00:00.000Z",
      topics: [topic],
      limitation: /21 至 45/u,
    },
    {
      name: "too-long window",
      previousAt: "2026-05-01T00:00:00.000Z",
      topics: [topic],
      limitation: /21 至 45/u,
    },
  ])("returns unavailable for $name instead of fabricating zeros", ({
    previousAt,
    topics,
    limitation,
  }) => {
    const result = evaluateCompetitorMonitor({
      competitorDomain: "competitor.example",
      analysisScopes: ["content", "serp_visibility"],
      current: {
        snapshotId: "10000000-0000-4000-8000-000000000010",
        capturedAt: "2026-07-28T00:00:00.000Z",
        availability: "available",
        rows: [row("customer onboarding automation", 7)],
      },
      previous: {
        snapshotId: "10000000-0000-4000-8000-000000000011",
        capturedAt: previousAt,
        availability: "available",
        rows: [],
      },
      topics,
    });

    expect(result).toEqual({
      evaluationState: "unavailable",
      limitation: expect.stringMatching(limitation),
      signals: [],
    });
  });

  it("rejects URLs outside the approved competitor domain and duplicate provider keyword facts", () => {
    expect(() =>
      evaluateCompetitorMonitor({
        competitorDomain: "competitor.example",
        analysisScopes: ["content", "serp_visibility"],
        current: {
          snapshotId: "10000000-0000-4000-8000-000000000010",
          capturedAt: "2026-07-28T00:00:00.000Z",
          availability: "available",
          rows: [
            row(
              "customer onboarding automation",
              7,
              "https://attacker.example/blog",
            ),
          ],
        },
        previous: null,
        topics: [topic],
      }),
    ).toThrow(/competitor domain/u);

    expect(() =>
      evaluateCompetitorMonitor({
        competitorDomain: "competitor.example",
        analysisScopes: ["content", "serp_visibility"],
        current: {
          snapshotId: "10000000-0000-4000-8000-000000000010",
          capturedAt: "2026-07-28T00:00:00.000Z",
          availability: "available",
          rows: [
            row("customer onboarding automation", 7),
            row("customer onboarding automation", 8),
          ],
        },
        previous: null,
        topics: [topic],
      }),
    ).toThrow(/duplicate/u);
  });

  it("gates each signal family by the competitor's frozen analysis scope", () => {
    const shared = {
      competitorDomain: "competitor.example",
      current: {
        snapshotId: "10000000-0000-4000-8000-000000000010",
        capturedAt: "2026-07-28T00:00:00.000Z",
        availability: "available" as const,
        rows: [
          row("customer onboarding automation", 7),
          row("onboarding workflow", 9),
        ],
      },
      previous: {
        snapshotId: "10000000-0000-4000-8000-000000000011",
        capturedAt: "2026-06-28T00:00:00.000Z",
        availability: "available" as const,
        rows: [
          row(
            "customer onboarding automation",
            13,
            "https://competitor.example/old",
          ),
        ],
      },
      topics: [topic],
    };

    const contentOnly = evaluateCompetitorMonitor({
      ...shared,
      analysisScopes: ["content"],
    });
    expect(contentOnly.signals).toContainEqual(
      expect.objectContaining({ kind: "new_content_overlap" }),
    );
    expect(contentOnly.signals).not.toContainEqual(
      expect.objectContaining({ kind: "rank_gain" }),
    );

    const serpOnly = evaluateCompetitorMonitor({
      ...shared,
      analysisScopes: ["serp_visibility"],
    });
    expect(serpOnly.signals).toContainEqual(
      expect.objectContaining({ kind: "rank_gain" }),
    );
    expect(serpOnly.signals).not.toContainEqual(
      expect.objectContaining({ kind: "new_content_overlap" }),
    );
  });
});
