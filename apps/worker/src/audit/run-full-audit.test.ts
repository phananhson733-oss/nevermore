import { describe, expect, it } from "vitest";
import { AuditModuleId, AuditModuleSummary } from "@sf/contracts";
import type { DatasetAvailability, DiagnosticDomain } from "@sf/engine";
import {
  projectAuditModuleResults,
  type AuditModuleProjectionInput,
} from "./run-full-audit.ts";

const ALL_AVAILABLE: Record<DiagnosticDomain, DatasetAvailability> = {
  technical_seo: "available",
  search_performance: "available",
  content_intent: "available",
  conversion_journey: "available",
  geo_ai: "available",
};

const CRAWL_ONLY: Record<DiagnosticDomain, DatasetAvailability> = {
  technical_seo: "available",
  search_performance: "unavailable",
  content_intent: "unavailable",
  conversion_journey: "unavailable",
  geo_ai: "unavailable",
};

function evidence(observedAt: string, sourceProvider = "crawl") {
  return { sourceProvider, observedAt };
}

describe("projectAuditModuleResults", () => {
  it("always returns the eight modules in canonical taxonomy order", () => {
    const results = projectAuditModuleResults({
      findings: [],
      coverage: { domains: ALL_AVAILABLE },
    });
    expect(results.map((r) => r.moduleId)).toEqual(AuditModuleId.options);
  });

  it("marks every module no_data when the run produced no findings", () => {
    const results = projectAuditModuleResults({
      findings: [],
      coverage: { domains: ALL_AVAILABLE },
    });
    for (const result of results) {
      expect(result.coverageState).toBe("no_data");
      const parsed = AuditModuleSummary.parse(result.summary);
      expect(parsed.evidenceCount).toBe(0);
      expect(parsed.findingCount).toBe(0);
      expect(parsed.sourceProviders).toEqual([]);
      expect(parsed.latestObservedAt).toBeNull();
      expect(parsed.limitations.length).toBeGreaterThan(0);
    }
  });

  it("keeps the four out-of-scope modules no_data even under full coverage", () => {
    const results = projectAuditModuleResults({
      findings: [
        { ruleId: "TECH-HTTP-001", evidence: [evidence("2026-07-24T00:00:00.000Z")] },
      ],
      coverage: { domains: ALL_AVAILABLE },
    });
    const byId = new Map(results.map((r) => [r.moduleId, r]));
    for (const moduleId of [
      "performance",
      "accessibility",
      "best_practices_security",
      "compliance_measurement",
    ] as const) {
      expect(byId.get(moduleId)?.coverageState).toBe("no_data");
    }
  });

  it("reports available coverage with evidence lineage for a fully covered module", () => {
    const results = projectAuditModuleResults({
      findings: [
        {
          ruleId: "TECH-HTTP-001",
          evidence: [
            evidence("2026-07-20T00:00:00.000Z"),
            evidence("2026-07-24T12:00:00.000Z", "gsc"),
          ],
        },
        { ruleId: "SEARCH-CTR-004", evidence: [evidence("2026-07-22T00:00:00.000Z")] },
      ],
      coverage: { domains: ALL_AVAILABLE },
    });
    const technicalSearch = results.find((r) => r.moduleId === "technical_search");
    expect(technicalSearch?.coverageState).toBe("available");
    const parsed = AuditModuleSummary.parse(technicalSearch?.summary);
    expect(parsed.evidenceCount).toBe(3);
    expect(parsed.findingCount).toBe(2);
    expect(parsed.sourceProviders).toEqual(["crawl", "gsc"]);
    expect(parsed.latestObservedAt).toBe("2026-07-24T12:00:00.000Z");
  });

  it("downgrades to partial when a contributing domain is unavailable", () => {
    const results = projectAuditModuleResults({
      findings: [
        { ruleId: "TECH-HTTP-001", evidence: [evidence("2026-07-24T00:00:00.000Z")] },
      ],
      coverage: { domains: CRAWL_ONLY },
    });
    const technicalSearch = results.find((r) => r.moduleId === "technical_search");
    expect(technicalSearch?.coverageState).toBe("partial");
    const parsed = AuditModuleSummary.parse(technicalSearch?.summary);
    expect(parsed.limitations.length).toBeGreaterThan(0);
    expect(parsed.evidenceCount).toBe(1);
  });

  it("routes each finding to the rule's canonical module", () => {
    const results = projectAuditModuleResults({
      findings: [
        { ruleId: "GEO-ENTITY-001", evidence: [evidence("2026-07-24T00:00:00.000Z")] },
        { ruleId: "CRO-PATH-001", evidence: [evidence("2026-07-24T00:00:00.000Z")] },
        { ruleId: "CONTENT-GAP-011", evidence: [evidence("2026-07-24T00:00:00.000Z")] },
      ],
      coverage: { domains: ALL_AVAILABLE },
    });
    const byId = new Map(results.map((r) => [r.moduleId, r.coverageState]));
    expect(byId.get("ai_geo")).toBe("available");
    expect(byId.get("links_architecture")).toBe("available");
    expect(byId.get("content_intent")).toBe("available");
  });

  it("emits contract-valid summaries for every module", () => {
    const results = projectAuditModuleResults({
      findings: [
        { ruleId: "TECH-LINKGRAPH-005", evidence: [evidence("2026-07-24T00:00:00.000Z")] },
      ],
      coverage: { domains: CRAWL_ONLY },
    });
    for (const result of results) {
      expect(() => AuditModuleSummary.parse(result.summary)).not.toThrow();
    }
  });
});

// Exercised so the exported projection input type stays wired to the pipeline.
const _typecheck: AuditModuleProjectionInput = {
  findings: [],
  coverage: { domains: ALL_AVAILABLE },
};
void _typecheck;
