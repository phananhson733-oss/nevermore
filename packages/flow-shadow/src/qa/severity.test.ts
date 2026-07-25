import { describe, expect, it } from "vitest";
import { QA_BRIEF_OUTLINE_CLAIM_ID } from "./coverage.ts";
import {
  claimIdForRule,
  QA_RULE_ORDER,
  QA_RULE_SEVERITY,
} from "./rule-types.ts";
import { qaSeverityForClaimId, QA_UNKNOWN_CLAIM_SEVERITY } from "./severity.ts";

describe("qaSeverityForClaimId", () => {
  it("agrees with QA_RULE_SEVERITY for every rule, one by one", () => {
    for (const ruleId of QA_RULE_ORDER) {
      expect(qaSeverityForClaimId(claimIdForRule(ruleId))).toBe(
        QA_RULE_SEVERITY[ruleId],
      );
    }
  });

  it("reports the three blocking rules and nothing else as blocking", () => {
    const blocking = QA_RULE_ORDER.filter(
      (ruleId) => qaSeverityForClaimId(claimIdForRule(ruleId)) === "blocking",
    );
    expect(blocking).toEqual([
      "rl8_unsupported_claim",
      "rl12_citation_integrity",
      "sc9b_sources_resolve_to_pack",
    ]);
  });

  it("grades the coverage claim `review`, matching what it does to a verdict", () => {
    expect(qaSeverityForClaimId(QA_BRIEF_OUTLINE_CLAIM_ID)).toBe("review");
  });

  it("sends an unknown claim to a human rather than hiding it as advisory", () => {
    expect(qaSeverityForClaimId("content-shadow.qa.not-a-rule")).toBe(
      QA_UNKNOWN_CLAIM_SEVERITY,
    );
    expect(QA_UNKNOWN_CLAIM_SEVERITY).toBe("review");
  });
});
