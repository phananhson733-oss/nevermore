import { describe, expect, it } from "vitest";
import { GrowthAuditResponse, type AuditLensSummary } from "@sf/contracts";
import { ApiError } from "@/lib/api/client";
import { isGrowthAuditAbsent } from "@/lib/api/hooks-audit";
import {
  selectProjectOpportunityMix,
  toProjectOpportunityMixResult,
  type ProjectOpportunityMixInput,
} from "./_project-opportunity-mix.ts";

function lens(
  overrides: Partial<AuditLensSummary> & Pick<AuditLensSummary, "lensId">,
): AuditLensSummary {
  return {
    coverageState: "available",
    evidenceCount: 3,
    findingCount: 2,
    limitations: [],
    ...overrides,
  };
}

const COMPLETE_LENSES: readonly AuditLensSummary[] = [
  lens({ lensId: "site_health", findingCount: 4 }),
  lens({ lensId: "search_ai_visibility", findingCount: 3 }),
  lens({ lensId: "demand_competition", findingCount: 1 }),
];

describe("selectProjectOpportunityMix", () => {
  it("reduces the three lenses to counts, coverage, and a project total", () => {
    const mix = selectProjectOpportunityMix({ lenses: COMPLETE_LENSES });

    expect(mix).toEqual({
      scope: "project",
      lenses: [
        { lensId: "site_health", coverageState: "available", findingCount: 4 },
        {
          lensId: "search_ai_visibility",
          coverageState: "available",
          findingCount: 3,
        },
        {
          lensId: "demand_competition",
          coverageState: "available",
          findingCount: 1,
        },
      ],
      total: 8,
    });
  });

  it("accepts the contract payload the audit endpoint actually returns", () => {
    const audit = GrowthAuditResponse.parse({
      auditRunId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      siteId: "00000000-0000-4000-8000-000000000003",
      status: "completed",
      outputLocale: "en",
      completedAt: "2026-07-20T00:00:00.000Z",
      modules: [
        "performance",
        "accessibility",
        "best_practices_security",
        "technical_search",
        "content_intent",
        "ai_geo",
        "links_architecture",
        "compliance_measurement",
      ].map((moduleId) => ({
        moduleId,
        coverageState: "available",
        evidenceCount: 1,
        findingCount: 1,
        sourceProviders: ["lighthouse"],
        latestObservedAt: "2026-07-20T00:00:00.000Z",
        limitations: [],
      })),
      lenses: COMPLETE_LENSES,
      coverageAndLimitations: [],
    });

    expect(selectProjectOpportunityMix(audit)?.total).toBe(8);
  });

  it("orders lenses by the canonical taxonomy, not by payload order", () => {
    const mix = selectProjectOpportunityMix({
      lenses: [...COMPLETE_LENSES].reverse(),
    });

    expect(mix?.lenses.map((item) => item.lensId)).toEqual([
      "site_health",
      "search_ai_visibility",
      "demand_competition",
    ]);
  });

  it("reports a no_data lens as an unknown count, never as zero", () => {
    const mix = selectProjectOpportunityMix({
      lenses: [
        lens({ lensId: "site_health", findingCount: 4 }),
        lens({ lensId: "search_ai_visibility", findingCount: 3 }),
        lens({
          lensId: "demand_competition",
          coverageState: "no_data",
          findingCount: 0,
        }),
      ],
    });

    expect(mix?.lenses[2]).toEqual({
      lensId: "demand_competition",
      coverageState: "no_data",
      findingCount: null,
    });
  });

  it("withholds the total when any lens count is unknown", () => {
    const mix = selectProjectOpportunityMix({
      lenses: [
        lens({ lensId: "site_health", findingCount: 4 }),
        lens({ lensId: "search_ai_visibility", findingCount: 3 }),
        lens({
          lensId: "demand_competition",
          coverageState: "no_data",
          findingCount: 0,
        }),
      ],
    });

    expect(mix?.total).toBeNull();
  });

  it("keeps a real zero from a covered lens as zero", () => {
    const mix = selectProjectOpportunityMix({
      lenses: [
        lens({ lensId: "site_health", findingCount: 0 }),
        lens({ lensId: "search_ai_visibility", findingCount: 0 }),
        lens({
          lensId: "demand_competition",
          coverageState: "partial",
          findingCount: 0,
        }),
      ],
    });

    expect(mix?.lenses.map((item) => item.findingCount)).toEqual([0, 0, 0]);
    expect(mix?.total).toBe(0);
  });

  it("returns null for an absent or empty lens list", () => {
    expect(selectProjectOpportunityMix(null)).toBeNull();
    expect(selectProjectOpportunityMix(undefined)).toBeNull();
    expect(selectProjectOpportunityMix({})).toBeNull();
    expect(selectProjectOpportunityMix({ lenses: null })).toBeNull();
    expect(selectProjectOpportunityMix({ lenses: [] })).toBeNull();
  });

  it("returns null when the payload is not shaped like a lens list at all", () => {
    const malformed = {
      lenses: "site_health",
    } as unknown as ProjectOpportunityMixInput;

    expect(selectProjectOpportunityMix(malformed)).toBeNull();
  });

  it("returns null when every row is missing its identifying fields", () => {
    expect(
      selectProjectOpportunityMix({
        lenses: [{}, { lensId: "site_health" }, { coverageState: "available" }],
      }),
    ).toBeNull();
  });

  it("drops rows with an unknown lens id or coverage state", () => {
    const mix = selectProjectOpportunityMix({
      lenses: [
        lens({ lensId: "site_health", findingCount: 4 }),
        { lensId: "backlinks", coverageState: "available", findingCount: 9 },
        {
          lensId: "search_ai_visibility",
          coverageState: "computing",
          findingCount: 9,
        },
      ],
    });

    expect(mix?.lenses).toEqual([
      { lensId: "site_health", coverageState: "available", findingCount: 4 },
    ]);
    expect(mix?.total).toBeNull();
  });

  it("treats a missing or non-integer count as unknown rather than zero", () => {
    const mix = selectProjectOpportunityMix({
      lenses: [
        { lensId: "site_health", coverageState: "available" },
        {
          lensId: "search_ai_visibility",
          coverageState: "available",
          findingCount: "7",
        },
        {
          lensId: "demand_competition",
          coverageState: "available",
          findingCount: -1,
        },
      ],
    });

    expect(mix?.lenses.map((item) => item.findingCount)).toEqual([
      null,
      null,
      null,
    ]);
    expect(mix?.total).toBeNull();
  });

  it("keeps the first row when a lens id is duplicated", () => {
    const mix = selectProjectOpportunityMix({
      lenses: [
        lens({ lensId: "site_health", findingCount: 4 }),
        lens({ lensId: "site_health", findingCount: 99 }),
      ],
    });

    expect(mix?.lenses).toEqual([
      { lensId: "site_health", coverageState: "available", findingCount: 4 },
    ]);
  });

  it("marks the mix as project scoped so it cannot be read as page scoped", () => {
    expect(
      selectProjectOpportunityMix({ lenses: COMPLETE_LENSES })?.scope,
    ).toBe("project");
  });
});

describe("toProjectOpportunityMixResult", () => {
  it("terminates as data when the mix is usable", () => {
    expect(toProjectOpportunityMixResult({ lenses: COMPLETE_LENSES })).toEqual({
      state: "data",
      mix: {
        scope: "project",
        lenses: [
          {
            lensId: "site_health",
            coverageState: "available",
            findingCount: 4,
          },
          {
            lensId: "search_ai_visibility",
            coverageState: "available",
            findingCount: 3,
          },
          {
            lensId: "demand_competition",
            coverageState: "available",
            findingCount: 1,
          },
        ],
        total: 8,
      },
    });
  });

  it("distinguishes a missing audit run from an unusable lens list", () => {
    expect(toProjectOpportunityMixResult(null)).toEqual({
      state: "no_data",
      reason: "no_audit_run",
    });
    expect(toProjectOpportunityMixResult(undefined)).toEqual({
      state: "no_data",
      reason: "no_audit_run",
    });
    expect(toProjectOpportunityMixResult({ lenses: [] })).toEqual({
      state: "no_data",
      reason: "no_lens_coverage",
    });
  });
});

describe("isGrowthAuditAbsent", () => {
  it("recognizes the 404 that means no audit has been run", () => {
    const problem = new ApiError({
      type: "about:blank",
      requestId: "00000000-0000-4000-8000-0000000000ff",
      title: "Not Found",
      status: 404,
      code: "NOT_FOUND",
      detail: "No growth audit has been run for this project.",
    });

    expect(isGrowthAuditAbsent(problem)).toBe(true);
  });

  it("leaves every other failure as a problem state", () => {
    const problem = new ApiError({
      type: "about:blank",
      requestId: "00000000-0000-4000-8000-0000000000ff",
      title: "Dependency Unavailable",
      status: 503,
      code: "DEPENDENCY_UNAVAILABLE",
      detail: "unavailable",
    });

    expect(isGrowthAuditAbsent(problem)).toBe(false);
    expect(isGrowthAuditAbsent(new Error("network"))).toBe(false);
    expect(isGrowthAuditAbsent(null)).toBe(false);
  });
});
