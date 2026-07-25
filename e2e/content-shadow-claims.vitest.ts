import { describe, expect, it } from "vitest";
import {
  clampVerdictToFailedClaims,
  evaluateQaRules,
  QA_RULE_SEVERITY,
  qaRuleKind,
  qaSeverityForClaimId,
  type QaRuleId,
  type QaRuleResult,
} from "../packages/flow-shadow/src/qa/index.ts";
import {
  EXECUTION_CLAIMS,
  expectedVerdict,
  REVIEW_BLOCKING_CLAIMS,
  REVIEW_COVERAGE_GAP_CLAIMS,
  REVIEW_PASSING_CLAIMS,
  VERTICAL_CLAIMS,
  type QaClaimFixture,
} from "./content-shadow-claims-fixture.ts";

/**
 * The mock E2E claim fixtures, checked against the gate package that produces
 * the real thing.
 *
 * A mock E2E can only ever prove what the SURFACE does with a response, so the
 * response has to be one the server could actually send. Two ways it was not:
 * a severity written by hand had drifted from the gate's table, and a verdict
 * was paired with a claim set that verdict cannot accompany. Neither could go
 * red, because nothing compared the fixtures to the source they imitate.
 *
 * This file is collected by the `unit` project (`e2e/**\/*.vitest.ts`), not by
 * Playwright, so it runs in `pnpm test` alongside everything else.
 */

const CLAIM_ID_PREFIX = "content-shadow.qa.";
const COVERAGE_CLAIM_ID = "content-shadow.qa.brief-outline";

const ALL_SETS: readonly (readonly [string, readonly QaClaimFixture[]])[] = [
  ["EXECUTION_CLAIMS", EXECUTION_CLAIMS],
  ["VERTICAL_CLAIMS", VERTICAL_CLAIMS],
  ["REVIEW_PASSING_CLAIMS", REVIEW_PASSING_CLAIMS],
  ["REVIEW_COVERAGE_GAP_CLAIMS", REVIEW_COVERAGE_GAP_CLAIMS],
  ["REVIEW_BLOCKING_CLAIMS", REVIEW_BLOCKING_CLAIMS],
];

function ruleIdOf(claimId: string): QaRuleId | null {
  if (claimId === COVERAGE_CLAIM_ID) return null;
  return claimId.slice(CLAIM_ID_PREFIX.length) as QaRuleId;
}

describe("content shadow mock E2E claim fixtures", () => {
  it("carries the severity the gate package derives, for every claim", () => {
    for (const [name, claims] of ALL_SETS) {
      for (const claim of claims) {
        expect(
          claim.severity,
          `${name} / ${claim.claimId}`,
        ).toBe(qaSeverityForClaimId(claim.claimId));
      }
    }
  });

  it("carries the kind the gate package derives, for every rule-backed claim", () => {
    for (const [name, claims] of ALL_SETS) {
      for (const claim of claims) {
        const ruleId = ruleIdOf(claim.claimId);
        if (ruleId === null) {
          expect(claim.kind, `${name} / ${claim.claimId}`).toBe("coverage");
          continue;
        }
        expect(QA_RULE_SEVERITY[ruleId], `${name} / ${claim.claimId}`).toBe(
          claim.severity,
        );
        expect(claim.kind, `${name} / ${claim.claimId}`).toBe(
          qaRuleKind(ruleId),
        );
      }
    }
  });

  it("declares only claim ids this build of the gate can mint", () => {
    for (const [name, claims] of ALL_SETS) {
      for (const claim of claims) {
        const ruleId = ruleIdOf(claim.claimId);
        if (ruleId === null) continue;
        expect(
          Object.hasOwn(QA_RULE_SEVERITY, ruleId),
          `${name} declares unknown rule ${ruleId}`,
        ).toBe(true);
      }
    }
  });

  /**
   * `expectedVerdict` mirrors the runner's composition; this runs the real
   * functions over rule results that reproduce each fixture's claim statuses and
   * checks the mirror agrees. Advisory rules are reconstructed as evaluable
   * passes because the gate forces an advisory claim to `passed` and skips the
   * rule in the verdict either way.
   */
  it("agrees with evaluateQaRules + clampVerdictToFailedClaims", () => {
    for (const [name, claims] of ALL_SETS) {
      const rules: QaRuleResult[] = [];
      for (const claim of claims) {
        const ruleId = ruleIdOf(claim.claimId);
        if (ruleId === null) continue;
        rules.push({
          ruleId,
          evaluable: claim.status !== "unevaluated",
          pass: claim.status !== "failed",
        } as QaRuleResult);
      }
      const real = clampVerdictToFailedClaims(
        evaluateQaRules(rules),
        claims.map((claim) => ({
          claimId: claim.claimId,
          kind: claim.kind,
          status: claim.status,
          detail: claim.detail,
        })),
      );
      expect(expectedVerdict(claims), name).toBe(real);
    }
  });

  /**
   * The states each spec relies on, named so a reader of this file can see what
   * the E2Es are actually exercising without opening them.
   */
  it("gives each spec a reachable, distinct state", () => {
    expect(expectedVerdict(REVIEW_PASSING_CLAIMS)).toBe("passed");
    expect(expectedVerdict(REVIEW_COVERAGE_GAP_CLAIMS)).toBe("needs_review");
    expect(expectedVerdict(REVIEW_BLOCKING_CLAIMS)).toBe("blocked");
    expect(expectedVerdict(VERTICAL_CLAIMS)).toBe("needs_review");
    expect(expectedVerdict(EXECUTION_CLAIMS)).toBe("blocked");
  });
});
