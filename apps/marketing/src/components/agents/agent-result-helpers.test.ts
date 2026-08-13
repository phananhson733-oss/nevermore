// @input  -- synthetic audit records and coverage counters
// @output -- regression coverage for reach ordering and evaluated/unverified math
// @pos    -- pure unit guard for Agent result semantics

import { describe, expect, it } from "vitest";
import type { SeoAuditCoverage, SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import {
  notCollectedUrlCount,
  rankAgentRecommendations,
  summarizeAgentRecords,
} from "./agent-result-helpers";

function record(
  id: string,
  affected: number,
  state: SeoAuditRecord["state"] = "observed",
  unit: SeoAuditRecord["unit"] = "pages",
): SeoAuditRecord {
  return {
    id,
    category: "metadata",
    state,
    unit,
    tested: 12,
    affected,
    observations: [],
    limitation: null,
  };
}

function evaluatedCheck({
  id,
  result,
  primaryAgent,
  evidenceRecordIds,
}: {
  readonly id: string;
  readonly result: "blocker" | "warning" | "tip" | "pass" | "excluded";
  readonly primaryAgent: "seo" | "tech";
  readonly evidenceRecordIds: readonly string[];
}): AgentAuditEvaluatedCheck {
  return {
    check: {
      id,
      scope: id.startsWith("S") ? "site" : "page",
      groupId: id.split(".")[0] ?? id,
      title: { en: `${id} title`, zh: `${id} 标题` },
      impact: { en: `${id} impact`, zh: `${id} 影响` },
      howToFix: { en: `${id} fix`, zh: `${id} 修复` },
      threshold: { en: "expected", zh: "预期" },
      thresholdAuthority: "official",
      dataSource: { en: "public HTML", zh: "公开 HTML" },
      scoreWeight: 1,
      blocking: result === "blocker",
      primaryAgent,
      evidenceRecordIds,
    },
    result,
    engine: evidenceRecordIds.length > 0 ? "ready" : "not-integrated",
    truth: evidenceRecordIds.length > 0 ? "observed" : "unavailable",
    measurement:
      evidenceRecordIds.length > 0
        ? { en: "Observed in this run", zh: "本次运行已观测" }
        : null,
    evidenceRecordIds,
    scoreValue: null,
    scoreContribution: null,
  } as unknown as AgentAuditEvaluatedCheck;
}

describe("Agent recommendation ranking", () => {
  it("ranks blocker and evidenced warning ahead of a much wider tip", () => {
    const checks = [
      evaluatedCheck({
        id: "1.1",
        result: "blocker",
        primaryAgent: "tech",
        evidenceRecordIds: ["status"],
      }),
      evaluatedCheck({
        id: "2.3",
        result: "warning",
        primaryAgent: "seo",
        evidenceRecordIds: ["title"],
      }),
      evaluatedCheck({
        id: "6.1",
        result: "tip",
        primaryAgent: "seo",
        evidenceRecordIds: ["links"],
      }),
    ];
    const records = [
      record("status", 1),
      record("title", 2),
      record("links", 500),
    ];

    expect(
      rankAgentRecommendations("seo", checks, records).map(
        (recommendation) => recommendation.check.check.id,
      ),
    ).toEqual(["1.1", "2.3", "6.1"]);
  });

  it("uses evidence availability and Agent relevance before reach", () => {
    const checks = [
      evaluatedCheck({
        id: "seo-evidenced",
        result: "warning",
        primaryAgent: "seo",
        evidenceRecordIds: ["seo-small"],
      }),
      evaluatedCheck({
        id: "tech-evidenced",
        result: "warning",
        primaryAgent: "tech",
        evidenceRecordIds: ["tech-large"],
      }),
      evaluatedCheck({
        id: "seo-source-gated",
        result: "warning",
        primaryAgent: "seo",
        evidenceRecordIds: [],
      }),
    ];
    const records = [record("seo-small", 1), record("tech-large", 100)];

    expect(
      rankAgentRecommendations("seo", checks, records).map(
        (recommendation) => recommendation.check.check.id,
      ),
    ).toEqual(["seo-evidenced", "tech-evidenced", "seo-source-gated"]);
    expect(
      rankAgentRecommendations("tech", checks, records).map(
        (recommendation) => recommendation.check.check.id,
      ),
    ).toEqual(["tech-evidenced", "seo-evidenced", "seo-source-gated"]);
    expect(
      rankAgentRecommendations("seo", checks, records)[0]?.id,
    ).not.toBe(rankAgentRecommendations("tech", checks, records)[0]?.id);
  });

  it("omits passes and uses reach only as a final deterministic tie-breaker", () => {
    const checks = [
      evaluatedCheck({
        id: "smaller",
        result: "warning",
        primaryAgent: "seo",
        evidenceRecordIds: ["small"],
      }),
      evaluatedCheck({
        id: "larger",
        result: "warning",
        primaryAgent: "seo",
        evidenceRecordIds: ["large"],
      }),
      evaluatedCheck({
        id: "clear",
        result: "pass",
        primaryAgent: "seo",
        evidenceRecordIds: ["pass"],
      }),
    ];

    expect(
      rankAgentRecommendations("seo", checks, [
        record("small", 2),
        record("large", 4),
        record("pass", 999, "not_observed"),
      ]).map((recommendation) => recommendation.check.check.id),
    ).toEqual(["larger", "smaller"]);
  });

  it("keeps page evidence limited to observations for the requested target URL", () => {
    const targetCheck = evaluatedCheck({
      id: "2.2",
      result: "warning",
      primaryAgent: "seo",
      evidenceRecordIds: ["duplicate"],
    });
    const duplicate: SeoAuditRecord = {
      ...record("duplicate", 2),
      observations: [
        { url: "https://example.com/other", values: [] },
        { url: "https://example.com/target", values: [] },
      ],
    };

    const matching = rankAgentRecommendations(
      "seo",
      [targetCheck],
      [duplicate],
      { targetUrl: "https://example.com/target" },
    )[0];
    const unrelated = rankAgentRecommendations(
      "seo",
      [targetCheck],
      [duplicate],
      { targetUrl: "https://example.com/missing" },
    )[0];

    expect(matching?.evidenceAvailable).toBe(true);
    expect(matching?.reach).toBe(1);
    expect(matching?.evidenceRecords[0]?.observations).toHaveLength(1);
    expect(matching?.evidenceRecords[0]?.observations[0]?.url).toBe(
      "https://example.com/target",
    );
    expect(unrelated?.evidenceAvailable).toBe(false);
    expect(unrelated?.evidenceRecords).toEqual([]);
  });
});

describe("Agent evidence summaries", () => {
  it("keeps evaluated and unverified checks separate", () => {
    expect(
      summarizeAgentRecords([
        record("observed", 2),
        record("clear", 0, "not_observed"),
        record("unknown", 0, "unverified"),
      ]),
    ).toEqual({
      total: 3,
      evaluated: 2,
      unverified: 1,
      observed: 1,
      notObserved: 1,
    });
  });

  it("adds only explicit not-collected URL counters", () => {
    const coverage: SeoAuditCoverage = {
      availability: "partial",
      pagesInspected: 4,
      linksObserved: 12,
      sitemapUrlsObserved: 9,
      urlsSkipped: 2,
      urlsBlocked: 3,
      urlsDisallowed: 5,
      urlsErrored: 7,
      stopReason: "budget",
    };
    expect(notCollectedUrlCount(coverage)).toBe(17);
  });

  it("keeps not-collected URL reach unavailable when coverage is unavailable", () => {
    const coverage: SeoAuditCoverage = {
      availability: "unavailable",
      pagesInspected: 0,
      linksObserved: 0,
      sitemapUrlsObserved: 0,
      urlsSkipped: 0,
      urlsBlocked: 0,
      urlsDisallowed: 0,
      urlsErrored: 0,
      stopReason: "crawl_failed",
    };

    expect(notCollectedUrlCount(coverage)).toBeNull();
  });
});
