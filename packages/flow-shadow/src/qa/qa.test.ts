import { describe, expect, it } from "vitest";
import { CLEAN_DRAFT } from "./__fixtures__/drafts.ts";
import {
  FIXTURE_OUTLINE,
  FIXTURE_STATS,
  fixturePack,
  qaInput,
} from "./__fixtures__/pack.ts";
import {
  clampVerdictToFailedClaims,
  evaluateDraftQa,
  qaClaimsToJson,
  QA_BRIEF_OUTLINE_CLAIM_ID,
  QA_RULE_ORDER,
  RED_LINE_CHECKS,
  STRUCTURE_CHECKS,
  claimIdForRule,
} from "./index.ts";

const input = qaInput(CLEAN_DRAFT);

describe("evaluateDraftQa", () => {
  it("emits one claim per rule plus the coverage claim", () => {
    const claims = evaluateDraftQa(input).claims;

    expect(claims).toHaveLength(QA_RULE_ORDER.length + 1);
    for (const ruleId of QA_RULE_ORDER) {
      expect(
        claims.some((claim) => claim.claimId === claimIdForRule(ruleId)),
      ).toBe(true);
    }
  });

  it("populates the ported check vocabularies", () => {
    expect(RED_LINE_CHECKS.length).toBeGreaterThan(0);
    expect(STRUCTURE_CHECKS.length).toBeGreaterThan(0);
    expect(
      new Set([
        ...RED_LINE_CHECKS.map((check) => check.id),
        ...STRUCTURE_CHECKS.map((check) => check.id),
      ]).size,
    ).toBe(RED_LINE_CHECKS.length + STRUCTURE_CHECKS.length);
  });

  it("scores citability without letting it reach the verdict", () => {
    const evaluation = evaluateDraftQa(input);

    expect(evaluation.citability.method).toBe("citability-geo-heuristic-v1");
    expect(evaluation.citability.caveat).toContain("not a measurement");
    expect(
      evaluation.claims.find(
        (claim) => claim.claimId === claimIdForRule("citability_geo"),
      )?.status,
    ).toBe("passed");
  });

  it("serializes claims to plain JSON for the jsonb column", () => {
    const claims = qaClaimsToJson(evaluateDraftQa(input).claims);

    expect(Array.isArray(claims)).toBe(true);
    for (const claim of claims) {
      expect(Object.keys(claim).sort()).toStrictEqual([
        "claimId",
        "detail",
        "kind",
        "status",
      ]);
      expect(String(claim["detail"]).length).toBeLessThanOrEqual(2000);
      expect(String(claim["claimId"]).length).toBeLessThanOrEqual(200);
    }
  });

  it("records the pinned adapter version that produced the judgement", () => {
    expect(evaluateDraftQa(input).adapterVersion).toBe(
      "content-shadow-adapter.0.3.0",
    );
  });
});

describe("brief -> draft causal chain claim (decision O-4)", () => {
  it("fails the claim, not silently, when the brief produced no outline", () => {
    const evaluation = evaluateDraftQa(
      qaInput(
        CLEAN_DRAFT,
        fixturePack({
          outline: {
            briefSections: [],
            targetKeywords: [],
            pageAssignment: "unassigned",
          },
        }),
        { ...FIXTURE_STATS, briefSectionCount: 0, projectedSectionCount: 0 },
      ),
    );
    const claim = evaluation.claims.find(
      (candidate) => candidate.claimId === QA_BRIEF_OUTLINE_CLAIM_ID,
    );

    expect(claim?.status).toBe("failed");
    expect(evaluation.verdict).not.toBe("passed");
  });

  /**
   * The claim used to report "the brief contributed 12 coverage topic(s)" over a
   * brief that carried 19 — a true sentence that reads as a complete one. The
   * shortfall has to appear in the claim a reviewer actually reads, and it still
   * has to appear now that the claim also reports the coverage judgement.
   */
  it("states how many brief sections the cap dropped, never just the survivors", () => {
    const claim = evaluateDraftQa(
      qaInput(CLEAN_DRAFT, fixturePack({ outline: FIXTURE_OUTLINE }), {
        ...FIXTURE_STATS,
        briefSectionCount: 19,
        projectedSectionCount: 2,
      }),
    ).claims.find(
      (candidate) => candidate.claimId === QA_BRIEF_OUTLINE_CLAIM_ID,
    );

    expect(claim?.detail).toContain(
      "The pinned brief carried 19 distinct section heading(s); 17 were dropped by the outline cap and never reached the prompt.",
    );
  });

  it("says nothing about dropped sections when the brief fit under the cap", () => {
    const claim = evaluateDraftQa(input).claims.find(
      (candidate) => candidate.claimId === QA_BRIEF_OUTLINE_CLAIM_ID,
    );

    expect(claim?.status).toBe("passed");
    expect(claim?.detail).not.toContain("dropped");
  });

  it("fails the claim when the draft never covers a committed topic", () => {
    const evaluation = evaluateDraftQa(
      qaInput(
        CLEAN_DRAFT,
        fixturePack({
          outline: {
            ...FIXTURE_OUTLINE,
            targetKeywords: [
              "onboarding analytics",
              "procurement approval workflow",
            ],
          },
        }),
      ),
    );

    expect(
      evaluation.claims.find((c) => c.claimId === QA_BRIEF_OUTLINE_CLAIM_ID)
        ?.detail,
    ).toContain("procurement approval workflow");
    expect(evaluation.verdict).toBe("needs_review");
  });

  /**
   * The correction to O-6.
   *
   * Coverage was judged against `briefSections`, but Task 4b's injection
   * hardening rewrites every heading that matches the §10.1 alias table into
   * one of nine English canonical constants — and the brief validator REQUIRES
   * all nine. So for every spec-conformant brief `briefSections` is exactly
   * that fixed list of document-structure labels, and a blog post about
   * onboarding analytics contains none of the words `objective`, `outline`,
   * `acceptance` or `requirements`. The check reported 8 of 9 topics uncovered
   * on a clean draft and pinned the verdict at `needs_review` forever.
   *
   * The keywords come from the frozen search cluster and are real
   * subject-matter terms, so they are what coverage is judged against now.
   */
  it("judges coverage on frozen keywords, not on canonicalised section labels", () => {
    const evaluation = evaluateDraftQa(
      qaInput(
        CLEAN_DRAFT,
        fixturePack({
          outline: {
            briefSections: [
              "Objective",
              "Audience",
              "Search Intent",
              "Target Topics & Queries",
              "Outline",
              "Evidence",
              "Conversion Path",
              "Proof & Source Requirements",
              "Acceptance Checklist",
            ],
            targetKeywords: ["onboarding analytics"],
            pageAssignment: "existing_page",
          },
        }),
        { ...FIXTURE_STATS, briefSectionCount: 9, projectedSectionCount: 9 },
      ),
    );

    expect(
      evaluation.claims.find((c) => c.claimId === QA_BRIEF_OUTLINE_CLAIM_ID)
        ?.status,
    ).toBe("passed");
    expect(evaluation.verdict).toBe("passed");
  });

  /**
   * "We did not look" may never be written down as "there is nothing to find".
   */
  it("reports coverage as unevaluated, never failed, when no keyword is judgeable", () => {
    for (const targetKeywords of [[], ["seo", "how to"]]) {
      const claim = evaluateDraftQa(
        qaInput(
          CLEAN_DRAFT,
          fixturePack({ outline: { ...FIXTURE_OUTLINE, targetKeywords } }),
        ),
      ).claims.find(
        (candidate) => candidate.claimId === QA_BRIEF_OUTLINE_CLAIM_ID,
      );

      expect(claim?.status, JSON.stringify(targetKeywords)).toBe("unevaluated");
      expect(claim?.detail).toContain("NOT judged");
    }
  });

  it("clamps a would-be `passed` verdict off `passed` while any claim failed", () => {
    expect(
      clampVerdictToFailedClaims("passed", [
        {
          claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
          kind: "coverage",
          status: "failed",
          detail: "no outline",
        },
      ]),
    ).toBe("needs_review");
    expect(
      clampVerdictToFailedClaims("passed", [
        {
          claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
          kind: "coverage",
          status: "unevaluated",
          detail: "pending",
        },
      ]),
    ).toBe("passed");
    expect(clampVerdictToFailedClaims("blocked", [])).toBe("blocked");
  });

  /**
   * The clamp is a backstop, so it must keep working against the REAL claim
   * shapes the judgement now emits, not only against a hand-built claim: every
   * `failed` claim the gate can produce has to be able to move a `passed`.
   */
  it("still clamps against the real judgement's own failed claims", () => {
    const failing = evaluateDraftQa(
      qaInput(
        CLEAN_DRAFT,
        fixturePack({
          outline: {
            briefSections: [],
            targetKeywords: [],
            pageAssignment: "unassigned",
          },
        }),
        { ...FIXTURE_STATS, briefSectionCount: 0, projectedSectionCount: 0 },
      ),
    );

    expect(failing.claims.some((claim) => claim.status === "failed")).toBe(
      true,
    );
    expect(clampVerdictToFailedClaims("passed", failing.claims)).toBe(
      "needs_review",
    );
  });
});
