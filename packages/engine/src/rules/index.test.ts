import { describe, expect, it } from "vitest";
import { RULE_SET_VERSION } from "../registry.ts";
import {
  ALL_RULES,
  GOVERNED_LEGACY_RULE_SET_VERSION,
  LEGACY_RULE_SET_VERSION,
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
    expect(rules?.map((rule) => rule.id)).toEqual(
      ALL_RULES.map((rule) => rule.id),
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
  });

  it("uses TECH-LINKGRAPH-005@3 in the current 0.2.3 executor", () => {
    const rules = rulesForRuleSetVersion(RULE_SET_VERSION);

    expect(RULE_SET_VERSION).toBe("mvp.rules.0.2.3");
    expect(rules).toBe(ALL_RULES);
    expect(rules?.find((rule) => rule.id === "CONTENT-GAP-011")).toMatchObject({
      id: "CONTENT-GAP-011",
      version: 2,
    });
    expect(rules?.find((rule) => rule.id === "TECH-LINKGRAPH-005")).toMatchObject({
      version: 3,
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
