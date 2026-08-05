import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuditLensSummary,
  AuditModuleId,
  AuditModuleSummary,
  FrontstageLensId,
} from "@sf/contracts";
import {
  AuditRunsRepository,
  GROWTH_AUDIT_PROJECTION_VERSION,
  ProjectsRepository,
  type AuditModuleResultRow,
  type Executor,
} from "@sf/db";
import {
  auditModulesFromRows,
  auditProjectionCopy,
  deriveAuditLenses,
  getProjectAudit,
  noDataModule,
  parseAuditModuleSummary,
  type AuditLensFindingInput,
} from "./audit-projection";

const auditRunId = "20000000-0000-4000-8000-000000000001";
const workspaceId = "20000000-0000-4000-8000-000000000002";
const projectId = "20000000-0000-4000-8000-000000000003";
const readExecutor = { kind: "audit-projection-test" } as unknown as Executor;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("current audit projection selection", () => {
  it("does not fall back to a legacy audit when no current projection exists", async () => {
    vi.spyOn(ProjectsRepository.prototype, "findById").mockResolvedValue({
      id: projectId,
    } as never);
    const latestRead = vi
      .spyOn(AuditRunsRepository.prototype, "findLatestByProjectionVersion")
      .mockResolvedValue(null);

    await expect(
      getProjectAudit(
        { workspaceId, uiLocale: "en" },
        projectId,
        readExecutor,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(GROWTH_AUDIT_PROJECTION_VERSION).toBe("growth-audit.0.3.1");
    expect(latestRead).toHaveBeenCalledWith(
      { workspaceId, projectId },
      GROWTH_AUDIT_PROJECTION_VERSION,
    );
  });
});

function observedSummary(
  moduleId: (typeof AuditModuleId.options)[number],
  overrides: Record<string, unknown> = {},
): AuditModuleResultRow {
  const summary = {
    moduleId,
    coverageState: "available",
    evidenceCount: 3,
    findingCount: 2,
    sourceProviders: ["crawl", "gsc"],
    latestObservedAt: "2026-07-21T08:00:00.000Z",
    limitations: [],
    ...overrides,
  };
  return {
    audit_run_id: auditRunId,
    module_id: moduleId,
    coverage_state: summary.coverageState as string,
    summary,
    created_at: "2026-07-21T08:00:00.000Z",
  };
}

function noDataSummaryRow(
  moduleId: (typeof AuditModuleId.options)[number],
): AuditModuleResultRow {
  return {
    audit_run_id: auditRunId,
    module_id: moduleId,
    coverage_state: "no_data",
    summary: {
      moduleId,
      coverageState: "no_data",
      evidenceCount: 0,
      findingCount: 0,
      sourceProviders: [],
      latestObservedAt: null,
      limitations: ["This module is outside the current growth audit's data scope."],
    },
    created_at: "2026-07-21T08:00:00.000Z",
  };
}

describe("audit projection module summaries", () => {
  it("parses a persisted observed module summary into the contract shape", () => {
    const summary = parseAuditModuleSummary(observedSummary("technical_search"));
    expect(AuditModuleSummary.parse(summary)).toEqual(summary);
    expect(summary.moduleId).toBe("technical_search");
    expect(summary.evidenceCount).toBe(3);
  });

  it("rejects a persisted summary whose moduleId disagrees with its row", () => {
    const row = observedSummary("technical_search", { moduleId: "ai_geo" });
    expect(() => parseAuditModuleSummary(row)).toThrow();
  });

  it("rejects a persisted summary whose coverage disagrees with its row", () => {
    const row: AuditModuleResultRow = {
      ...observedSummary("technical_search"),
      coverage_state: "no_data",
    };
    expect(() => parseAuditModuleSummary(row)).toThrow();
  });

  it("projects every canonical module in taxonomy order", () => {
    const rows = AuditModuleId.options.map((moduleId) =>
      moduleId === "technical_search"
        ? observedSummary(moduleId)
        : noDataSummaryRow(moduleId),
    );
    const modules = auditModulesFromRows(rows);
    expect(modules.map((module) => module.moduleId)).toEqual(
      AuditModuleId.options,
    );
  });

  it("rejects an incomplete set of module rows", () => {
    const rows = AuditModuleId.options
      .slice(0, 7)
      .map((moduleId) => noDataSummaryRow(moduleId));
    expect(() => auditModulesFromRows(rows)).toThrow();
  });

  it("builds a contract-valid no_data module with a mandatory limitation", () => {
    const module = noDataModule("performance", "still running");
    expect(AuditModuleSummary.parse(module)).toEqual(module);
    expect(module.limitations).toEqual(["still running"]);
  });
});

describe("audit projection lens rollups", () => {
  const copy = auditProjectionCopy("en");

  it("derives all three lenses at rule granularity across modules", () => {
    const findings: AuditLensFindingInput[] = [
      { ruleId: "TECH-HTTP-001", evidenceCount: 2 }, // technical_search -> site_health
      { ruleId: "SEARCH-CTR-004", evidenceCount: 1 }, // technical_search -> search_ai_visibility
      { ruleId: "CONTENT-COVERAGE-001", evidenceCount: 4 }, // content_intent -> demand_competition
    ];
    const lenses = deriveAuditLenses(findings, { partial: false, copy });
    const byId = new Map(lenses.map((lens) => [lens.lensId, lens]));
    expect(lenses.map((lens) => lens.lensId).sort()).toEqual(
      [...FrontstageLensId.options].sort(),
    );
    expect(byId.get("site_health")).toMatchObject({
      coverageState: "available",
      findingCount: 1,
      evidenceCount: 2,
    });
    expect(byId.get("search_ai_visibility")).toMatchObject({
      findingCount: 1,
      evidenceCount: 1,
    });
    expect(byId.get("demand_competition")).toMatchObject({
      findingCount: 1,
      evidenceCount: 4,
    });
    for (const lens of lenses) expect(AuditLensSummary.parse(lens)).toEqual(lens);
  });

  it("marks a lens with no evidence-bearing findings as no_data", () => {
    const lenses = deriveAuditLenses(
      [{ ruleId: "TECH-HTTP-001", evidenceCount: 3 }],
      { partial: false, copy },
    );
    const demand = lenses.find((lens) => lens.lensId === "demand_competition");
    expect(demand).toMatchObject({
      coverageState: "no_data",
      evidenceCount: 0,
      findingCount: 0,
    });
    expect(demand?.limitations.length).toBeGreaterThan(0);
  });

  it("excludes zero-evidence findings so no_data stays internally consistent", () => {
    const lenses = deriveAuditLenses(
      [{ ruleId: "GEO-ENTITY-001", evidenceCount: 0 }],
      { partial: false, copy },
    );
    const visibility = lenses.find(
      (lens) => lens.lensId === "search_ai_visibility",
    );
    expect(visibility?.coverageState).toBe("no_data");
    expect(visibility?.findingCount).toBe(0);
  });

  it("downgrades observed lenses to partial with a limitation on a partial run", () => {
    const lenses = deriveAuditLenses(
      [{ ruleId: "TECH-HTTP-001", evidenceCount: 2 }],
      { partial: true, copy },
    );
    const health = lenses.find((lens) => lens.lensId === "site_health");
    expect(health?.coverageState).toBe("partial");
    expect(health?.limitations.length).toBeGreaterThan(0);
    expect(AuditLensSummary.parse(health)).toEqual(health);
  });
});
