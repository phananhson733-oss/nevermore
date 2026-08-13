import { describe, expect, it } from "vitest";
import type { SeoAuditRecord } from "../seo-audit/types.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

function record(id: string, state: SeoAuditRecord["state"], affected = 0): SeoAuditRecord {
  return {
    id,
    category:
      id === "title_duplicate" || id === "meta_description_duplicate"
        ? "metadata"
        : "crawl",
    state,
    unit: "pages",
    tested: 4,
    affected,
    observations: affected > 0 ? [{ url: "https://example.com", values: [] }] : [],
    limitation: null,
  };
}

describe("v2 Agent audit evaluator", () => {
  it("keeps unavailable checks excluded instead of zero or pass", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "unavailable",
      records: [],
    });
    expect(result.checks).toHaveLength(50);
    expect(result.evaluated).toBe(0);
    expect(result.health).toBeNull();
    expect(result.checks.every((check) => check.result === "excluded")).toBe(true);
  });

  it("counts page blockers separately and dims health in the view model", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/",
      records: [record("non_2xx_final_status", "observed", 1)],
    });
    expect(result.blockers).toBeGreaterThan(0);
    expect(result.checks.find((check) => check.check.id === "1.1")?.result).toBe("blocker");
  });

  it("does not turn a fetched robots resource into proof of robots allowance", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      records: [record("robots_resource", "observed", 1)],
    });
    const allowance = result.checks.find((check) => check.check.id === "1.2");

    expect(allowance?.result).toBe("excluded");
    expect(allowance?.truth).not.toBe("observed");
  });

  it("does not turn missing-field detectors into Title or description length measurements", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/",
      records: [
        record("title_missing", "not_observed"),
        record("meta_description_missing", "not_observed"),
      ],
    });

    expect(result.checks.find((check) => check.check.id === "2.1")?.result).toBe(
      "excluded",
    );
    expect(result.checks.find((check) => check.check.id === "2.4")?.result).toBe(
      "excluded",
    );
  });

  it("does not infer redirect destinations returning 404 from generic redirect or status records", () => {
    const result = evaluateAgentAuditScope("site", {
      availability: "available",
      records: [
        record("redirect_chain", "observed", 1),
        record("non_2xx_final_status", "observed", 1),
      ],
    });

    expect(result.checks.find((check) => check.check.id === "A6")?.result).toBe(
      "excluded",
    );
  });

  it("does not attribute an issue observed on another URL to the target page", () => {
    const otherPage = record("title_duplicate", "observed", 1);
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com/target",
      records: [otherPage],
    });
    const uniqueness = result.checks.find((check) => check.check.id === "2.2");

    expect(uniqueness?.result).toBe("excluded");
    expect(uniqueness?.truth).toBe("partial");
    expect(uniqueness?.measurement).toBeNull();
  });

  it("keeps target-specific observations available to the matching page check", () => {
    const result = evaluateAgentAuditScope("page", {
      availability: "available",
      targetUrl: "https://example.com",
      records: [record("title_duplicate", "observed", 1)],
    });
    const uniqueness = result.checks.find((check) => check.check.id === "2.2");

    expect(uniqueness?.result).toBe("warning");
    expect(uniqueness?.evidenceRecordIds).toEqual(["title_duplicate"]);
  });

  it("keeps the D1 false-positive detector excluded until the P6 gate is fixed", () => {
    const result = evaluateAgentAuditScope("site", {
      availability: "available",
      records: [record("title_duplicate", "observed", 2)],
    });
    const duplicateTitles = result.checks.find((check) => check.check.id === "D1");

    expect(duplicateTitles?.result).toBe("excluded");
    expect(duplicateTitles?.evidenceRecordIds).toEqual([]);
  });

  it("renormalizes evaluated weights and caps an incomplete perfect score at 99", () => {
    const result = evaluateAgentAuditScope("site", {
      availability: "available",
      records: [record("meta_description_duplicate", "not_observed")],
    });
    expect(result.health).toBe(99);
    expect(result.excluded).toBeGreaterThan(0);
  });
});
