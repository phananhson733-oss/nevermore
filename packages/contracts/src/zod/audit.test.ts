import { describe, expect, it } from "vitest";
import {
  AuditModuleId,
  AuditModuleSummary,
  CoverageState,
  FrontstageLensId,
  GrowthAuditResponse,
  QueryEvidence,
} from "./audit.ts";

const auditModuleIds = [
  "performance",
  "accessibility",
  "best_practices_security",
  "technical_search",
  "content_intent",
  "ai_geo",
  "links_architecture",
  "compliance_measurement",
] as const;

const lensIds = [
  "site_health",
  "search_ai_visibility",
  "demand_competition",
] as const;

function moduleSummary(moduleId: (typeof auditModuleIds)[number]) {
  return {
    moduleId,
    coverageState: moduleId === "compliance_measurement" ? "no_data" : "available",
    evidenceCount: moduleId === "compliance_measurement" ? 0 : 2,
    findingCount: 0,
    sourceProviders: moduleId === "compliance_measurement" ? [] : ["crawl"],
    latestObservedAt:
      moduleId === "compliance_measurement" ? null : "2026-07-21T08:00:00Z",
    limitations:
      moduleId === "compliance_measurement"
        ? ["No consent-platform observation is available."]
        : [],
  } as const;
}

function auditResponse() {
  return {
    auditRunId: "10000000-0000-4000-8000-000000000001",
    projectId: "10000000-0000-4000-8000-000000000002",
    siteId: "10000000-0000-4000-8000-000000000003",
    status: "completed",
    outputLocale: "zh-CN",
    completedAt: "2026-07-21T08:05:00Z",
    modules: auditModuleIds.map(moduleSummary),
    lenses: lensIds.map((lensId) => ({
      lensId,
      coverageState: "available",
      evidenceCount: 4,
      findingCount: 1,
      limitations: [],
    })),
    coverageAndLimitations: [
      "Compliance measurement has no connected observation source.",
    ],
  } as const;
}

describe("Growth Audit contracts", () => {
  it("freezes all eight customer-readable audit modules", () => {
    expect(AuditModuleId.options).toEqual(auditModuleIds);
  });

  it("freezes all three frontstage lenses", () => {
    expect(FrontstageLensId.options).toEqual(lensIds);
  });

  it("distinguishes unavailable coverage from an observed zero", () => {
    expect(CoverageState.options).toEqual([
      "available",
      "partial",
      "stale",
      "no_data",
    ]);
    expect(
      AuditModuleSummary.parse(moduleSummary("compliance_measurement"))
        .coverageState,
    ).toBe("no_data");
    expect(
      AuditModuleSummary.safeParse({
        ...moduleSummary("compliance_measurement"),
        score: 0,
      }).success,
    ).toBe(false);
  });

  it("keeps SearchQuery and GenerativeQuery evidence metrically separate", () => {
    const search = QueryEvidence.parse({
      queryKind: "search",
      observationId: "10000000-0000-4000-8000-000000000011",
      snapshotId: "10000000-0000-4000-8000-000000000012",
      query: "customer onboarding software",
      marketCode: "US",
      languageCode: "en-US",
      sourceProvider: "dataforseo",
      observedAt: "2026-07-21T08:00:00Z",
      freshness: "current",
      metrics: {
        monthlyVolume: 2400,
        keywordDifficulty: 31,
        organicRank: 12.8,
        impressions: 5100,
        clicks: 1240,
      },
      limitation: "Provider estimate; not a first-party count.",
    });
    const generative = QueryEvidence.parse({
      queryKind: "generative",
      observationId: "10000000-0000-4000-8000-000000000013",
      snapshotId: "10000000-0000-4000-8000-000000000014",
      query: "What is the best way to automate customer onboarding?",
      marketCode: "US",
      languageCode: "en-US",
      sourceProvider: "ai-citation-monitor",
      observedAt: "2026-07-21T08:00:00Z",
      freshness: "current",
      metrics: {
        sampleSize: 8,
        brandMentionCount: 1,
        brandCitationCount: 0,
        citedCompetitorCount: 6,
      },
      limitation: "Observed answer sample; not population-wide visibility.",
    });

    expect(search.queryKind).toBe("search");
    expect(generative.queryKind).toBe("generative");
    expect(
      QueryEvidence.safeParse({
        ...search,
        metrics: { ...search.metrics, brandCitationCount: 0 },
      }).success,
    ).toBe(false);
    expect(
      QueryEvidence.safeParse({
        ...generative,
        metrics: { ...generative.metrics, monthlyVolume: 2400 },
      }).success,
    ).toBe(false);
    expect(
      QueryEvidence.safeParse({
        ...search,
        observationId: undefined,
      }).success,
    ).toBe(false);
    expect(
      QueryEvidence.safeParse({
        ...generative,
        snapshotId: undefined,
      }).success,
    ).toBe(false);
  });

  it("requires every audit response to carry all modules and lenses", () => {
    expect(GrowthAuditResponse.safeParse(auditResponse()).success).toBe(true);

    expect(
      GrowthAuditResponse.safeParse({
        ...auditResponse(),
        modules: auditResponse().modules.slice(0, -1),
      }).success,
    ).toBe(false);
    expect(
      GrowthAuditResponse.safeParse({
        ...auditResponse(),
        modules: [
          ...auditResponse().modules.slice(0, -1),
          moduleSummary("performance"),
        ],
      }).success,
    ).toBe(false);
    expect(
      GrowthAuditResponse.safeParse({
        ...auditResponse(),
        lenses: auditResponse().lenses.slice(0, -1),
      }).success,
    ).toBe(false);
  });

  it("rejects contradictory no-data module and lens summaries", () => {
    for (const contradictory of [
      {
        ...moduleSummary("compliance_measurement"),
        evidenceCount: 1,
      },
      {
        ...moduleSummary("compliance_measurement"),
        findingCount: 1,
      },
      {
        ...moduleSummary("compliance_measurement"),
        sourceProviders: ["crawl"],
      },
      {
        ...moduleSummary("compliance_measurement"),
        latestObservedAt: "2026-07-21T08:00:00Z",
      },
      {
        ...moduleSummary("compliance_measurement"),
        limitations: [],
      },
    ]) {
      expect(AuditModuleSummary.safeParse(contradictory).success).toBe(false);
    }

    expect(
      GrowthAuditResponse.safeParse({
        ...auditResponse(),
        lenses: auditResponse().lenses.map((lens) =>
          lens.lensId === "site_health"
            ? {
                ...lens,
                coverageState: "no_data",
                evidenceCount: 4,
                findingCount: 1,
              }
            : lens,
        ),
      }).success,
    ).toBe(false);
  });

  it("requires terminal audit status and completion time to agree", () => {
    expect(
      GrowthAuditResponse.safeParse({
        ...auditResponse(),
        status: "completed",
        completedAt: null,
      }).success,
    ).toBe(false);
    expect(
      GrowthAuditResponse.safeParse({
        ...auditResponse(),
        status: "running",
        completedAt: "2026-07-21T08:05:00Z",
      }).success,
    ).toBe(false);
  });
});
