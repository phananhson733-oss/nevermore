import { describe, expect, it } from "vitest";
import { FINDING_REGISTRY, RULE_SET_VERSION } from "../registry.ts";
import {
  ALL_RULES,
  CONTEXTUAL_ALL_RULES,
  CONTEXTUAL_RULE_SET_VERSION,
  GOVERNED_LEGACY_RULE_SET_VERSION,
  LEGACY_RULE_SET_VERSION,
  LINKGRAPH_LEGACY_ALL_RULES,
  LINKGRAPH_LEGACY_RULE_SET_VERSION,
  rulesForRuleSetVersion,
} from "./index.ts";

describe("versioned diagnostic rule registry", () => {
  it("resolves the historical 0.2.1 executor with CONTENT-GAP-011@1", () => {
    const rules = rulesForRuleSetVersion(LEGACY_RULE_SET_VERSION);

    expect(LEGACY_RULE_SET_VERSION).toBe("mvp.rules.0.2.1");
    expect(rules).not.toBeNull();
    expect(rules?.find((rule) => rule.id === "CONTENT-GAP-011")).toMatchObject({
      id: "CONTENT-GAP-011",
      version: 1,
    });
    expect(rules?.find((rule) => rule.id === "TECH-LINKGRAPH-005")).toMatchObject({
      version: 2,
    });
    expect(rules).toHaveLength(11);
    expect(rules?.some((rule) => rule.id === "TECH-INDEXABILITY-006")).toBe(
      false,
    );
  });

  it("keeps the governed 0.2.2 executor replayable", () => {
    const rules = rulesForRuleSetVersion(GOVERNED_LEGACY_RULE_SET_VERSION);

    expect(GOVERNED_LEGACY_RULE_SET_VERSION).toBe("mvp.rules.0.2.2");
    expect(rules?.find((rule) => rule.id === "CONTENT-GAP-011")).toMatchObject({
      version: 2,
    });
    expect(rules?.find((rule) => rule.id === "TECH-LINKGRAPH-005")).toMatchObject({
      version: 2,
    });
    expect(rules).toHaveLength(11);
    expect(rules?.some((rule) => rule.id === "TECH-INDEXABILITY-006")).toBe(
      false,
    );
  });

  it("keeps the 11-rule 0.2.3 executor replayable after current promotion", () => {
    const rules = rulesForRuleSetVersion(LINKGRAPH_LEGACY_RULE_SET_VERSION);

    expect(LINKGRAPH_LEGACY_RULE_SET_VERSION).toBe("mvp.rules.0.2.3");
    expect(rules).toBe(LINKGRAPH_LEGACY_ALL_RULES);
    expect(rules).toHaveLength(11);
    expect(rules?.find((rule) => rule.id === "CONTENT-GAP-011")).toMatchObject({
      id: "CONTENT-GAP-011",
      version: 2,
    });
    expect(rules?.find((rule) => rule.id === "TECH-LINKGRAPH-005")).toMatchObject({
      version: 3,
    });
    expect(rules?.some((rule) => rule.id === "TECH-INDEXABILITY-006")).toBe(
      false,
    );
  });

  it("activates the explicit 12-rule 0.2.4 executor as current", () => {
    const rules = rulesForRuleSetVersion(RULE_SET_VERSION);

    expect(RULE_SET_VERSION).toBe("mvp.rules.0.2.4");
    expect(RULE_SET_VERSION).toBe(CONTEXTUAL_RULE_SET_VERSION);
    expect(CONTEXTUAL_RULE_SET_VERSION).toBe("mvp.rules.0.2.4");
    expect(ALL_RULES).toBe(CONTEXTUAL_ALL_RULES);
    expect(rules).toBe(CONTEXTUAL_ALL_RULES);
    expect(rules).toHaveLength(12);
    expect(rules?.find((rule) => rule.id === "TECH-INDEXABILITY-006")).toMatchObject(
      {
        id: "TECH-INDEXABILITY-006",
        version: 1,
      },
    );
    expect(rules?.find((rule) => rule.id === "CONTENT-GAP-011")).toMatchObject({
      version: 2,
    });
    expect(rules?.find((rule) => rule.id === "TECH-LINKGRAPH-005")).toMatchObject({
      version: 3,
    });
    expect(FINDING_REGISTRY["TECH-INDEXABILITY-006"]).toEqual({
      ruleFamily: "sitemap-indexability",
      intent: "resolve_sitemap_indexability_conflict",
      domain: "technical_seo",
      titleKey: "finding.indexability",
    });
  });

  it("fails closed for an unknown rule-set version", () => {
    expect(rulesForRuleSetVersion("mvp.rules.2099.0.0")).toBeNull();
  });

  it("refuses to disguise governance-aware evaluation as CONTENT-GAP-011@1", () => {
    const legacyRule = rulesForRuleSetVersion(
      LEGACY_RULE_SET_VERSION,
    )?.find((rule) => rule.id === "CONTENT-GAP-011");

    expect(() =>
      legacyRule?.evaluate({ governance: {} } as never),
    ).toThrow("CONTENT-GAP-011@1 cannot evaluate a governance-bearing context");
  });
});
