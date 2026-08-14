// @input  -- synthetic audit records and coverage counters
// @output -- regression coverage for reach ordering and evaluated/unverified math
// @pos    -- pure unit guard for Agent result semantics

import { describe, expect, it } from "vitest";
import type { SeoAuditCoverage, SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import {
  analyzeAgentRecommendations,
  notCollectedUrlCount,
  rankAgentRecommendations,
  summarizeAgentRecords,
} from "./agent-result-helpers";

/**
 * The audit model always emits one observation per affected unit, so fixtures
 * keep `affected === observations.length` the way real records do.
 */
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
    observations: Array.from({ length: affected }, (_, index) => ({
      url: `https://example.com/${id}-${index}`,
      values: [],
    })),
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
    expect(rankAgentRecommendations("seo", checks, records)[0]?.id).not.toBe(
      rankAgentRecommendations("tech", checks, records)[0]?.id,
    );
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

describe("Agent recommendation reach", () => {
  it("counts one affected URL once across sibling evidence records", () => {
    const check = evaluatedCheck({
      id: "3.1",
      result: "warning",
      primaryAgent: "seo",
      evidenceRecordIds: ["h1_missing", "title_missing"],
    });
    const shared = (id: string): SeoAuditRecord => ({
      ...record(id, 2),
      observations: [
        { url: "https://example.com/a", values: [] },
        { url: "https://example.com/b", values: [] },
      ],
    });

    expect(
      rankAgentRecommendations("seo", [check], [
        shared("h1_missing"),
        shared("title_missing"),
      ])[0]?.reach,
    ).toBe(2);
  });

  it("counts site-level observations separately from affected URLs", () => {
    const check = evaluatedCheck({
      id: "4.1",
      result: "warning",
      primaryAgent: "seo",
      evidenceRecordIds: ["site_resource", "pages"],
    });
    const siteRecord: SeoAuditRecord = {
      ...record("site_resource", 1, "observed", "site_resource"),
      observations: [{ url: null, values: [] }],
    };
    const pageRecord: SeoAuditRecord = {
      ...record("pages", 2),
      observations: [
        { url: "https://example.com/a", values: [] },
        { url: "https://example.com/a", values: [] },
      ],
    };

    expect(
      rankAgentRecommendations("seo", [check], [siteRecord, pageRecord])[0]
        ?.reach,
    ).toBe(2);
  });
});

describe("Agent recommendation disclosure", () => {
  const actionable = (id: string, result: "warning" | "tip") =>
    evaluatedCheck({
      id,
      result,
      primaryAgent: "seo",
      evidenceRecordIds: [`record-${id}`],
    });
  const checks = [
    actionable("2.1", "warning"),
    actionable("2.2", "warning"),
    actionable("2.4", "warning"),
    actionable("3.1", "tip"),
    actionable("3.2", "tip"),
    evaluatedCheck({
      id: "8.1",
      result: "excluded",
      primaryAgent: "tech",
      evidenceRecordIds: [],
    }),
    evaluatedCheck({
      id: "8.2",
      result: "excluded",
      primaryAgent: "tech",
      evidenceRecordIds: [],
    }),
    evaluatedCheck({
      id: "1.1",
      result: "pass",
      primaryAgent: "tech",
      evidenceRecordIds: [],
    }),
  ];
  const records = checks.map((check, index) =>
    record(`record-${check.check.id}`, index + 1),
  );

  it("keeps checks with no collected evidence source out of the ranking", () => {
    const analysis = analyzeAgentRecommendations("seo", checks, records);

    expect(
      analysis.ranked.map((recommendation) => recommendation.check.check.id),
    ).not.toContain("8.1");
    expect(
      analysis.ranked.every((recommendation) =>
        ["blocker", "warning", "tip"].includes(
          String(recommendation.check.result),
        ),
      ),
    ).toBe(true);
    expect(
      analysis.dataSourceGaps.map((gap) => gap.check.check.id),
    ).toEqual(["8.1", "8.2"]);
    expect(analysis.dataSourceGaps[0]?.id).toBe("seo:page:8.1");
  });

  it("reports how many ranked recommendations the display limit hides", () => {
    const analysis = analyzeAgentRecommendations("seo", checks, records);

    expect(analysis.displayLimit).toBe(3);
    expect(analysis.ranked).toHaveLength(3);
    expect(analysis.rankedTotal).toBe(5);
    expect(analysis.hiddenCount).toBe(2);
  });

  it("hides nothing when the actionable set fits the display limit", () => {
    const analysis = analyzeAgentRecommendations(
      "seo",
      checks.slice(0, 2),
      records,
    );

    expect(analysis.rankedTotal).toBe(2);
    expect(analysis.hiddenCount).toBe(0);
    expect(analysis.dataSourceGaps).toEqual([]);
  });

  it("returns the same ordered list from the array-shaped ranking helper", () => {
    expect(
      rankAgentRecommendations("seo", checks, records).map(
        (recommendation) => recommendation.id,
      ),
    ).toEqual(
      analyzeAgentRecommendations("seo", checks, records).ranked.map(
        (recommendation) => recommendation.id,
      ),
    );
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
