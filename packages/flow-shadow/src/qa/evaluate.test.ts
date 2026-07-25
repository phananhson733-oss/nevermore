import { describe, expect, it } from "vitest";
import {
  ADVISORY_ONLY_DRAFT,
  CLEAN_DRAFT,
  FENCED_CLAIM_DRAFT,
  NEGATED_CLAIM_DRAFT,
  PHANTOM_CITATION_DRAFT,
  PHANTOM_SOURCE_DRAFT,
  PHANTOM_SOURCE_LIST_DRAFT,
  PRODUCT_LINK_DRAFT,
  STRUCTURE_WEAK_DRAFT,
  UNSUPPORTED_CLAIM_DRAFT,
} from "./__fixtures__/drafts.ts";
import {
  FIXTURE_STATS,
  fixturePack,
  packWithCitableSources,
  qaInput,
} from "./__fixtures__/pack.ts";
import {
  BLOCKING_RULE_IDS,
  QA_BRIEF_OUTLINE_CLAIM_ID,
  QA_RULE_SEVERITY,
  claimIdForRule,
  clampVerdictToFailedClaims,
  evaluateDraftQa,
  evaluateQaRules,
  qaClaimsToJson,
} from "./index.ts";
import type { QaRuleId } from "./rule-types.ts";

function claim(markdown: string, ruleId: QaRuleId, pack = fixturePack()) {
  return evaluateDraftQa(qaInput(markdown, pack)).claims.find(
    (candidate) => candidate.claimId === claimIdForRule(ruleId),
  );
}

describe("P1 — an unsupported or fabricated claim is blocked", () => {
  it("blocks a research assertion carrying no attribution at all", () => {
    const evaluation = evaluateDraftQa(qaInput(UNSUPPORTED_CLAIM_DRAFT));

    expect(evaluation.verdict).toBe("blocked");
    expect(claim(UNSUPPORTED_CLAIM_DRAFT, "rl8_unsupported_claim")).toMatchObject(
      { status: "failed" },
    );
  });

  /**
   * The sibling repository's ALLOW list accepted any four-digit year and any
   * capitalized `by <Name>`; "According to the 2024 Forrester Digital
   * Experience Report" satisfies BOTH and would have passed there. It must be
   * blocked here, because "Forrester" resolves to nothing in the frozen pack.
   */
  it("blocks a formally attributed claim whose source is not in the pack", () => {
    const evaluation = evaluateDraftQa(qaInput(PHANTOM_SOURCE_DRAFT));

    expect(evaluation.verdict).toBe("blocked");
    const rl8 = claim(PHANTOM_SOURCE_DRAFT, "rl8_unsupported_claim");
    expect(rl8?.status).toBe("failed");
    expect(rl8?.detail).toContain("authority D");
    expect(rl8?.detail).toContain("line 5");
  });

  it("blocks a Sources entry that resolves to nothing in the pack", () => {
    const evaluation = evaluateDraftQa(qaInput(PHANTOM_SOURCE_LIST_DRAFT));

    expect(evaluation.verdict).toBe("blocked");
    expect(
      claim(PHANTOM_SOURCE_LIST_DRAFT, "sc9b_sources_resolve_to_pack")?.status,
    ).toBe("failed");
  });

  it("blocks a citation-shaped external URL", () => {
    const evaluation = evaluateDraftQa(qaInput(PHANTOM_CITATION_DRAFT));

    expect(evaluation.verdict).toBe("blocked");
    expect(
      claim(PHANTOM_CITATION_DRAFT, "rl12_citation_integrity")?.status,
    ).toBe("failed");
  });

  it("resolves the same attribution when the pack really carries the source", () => {
    const pack = packWithCitableSources(["forrester.example"]);
    const evaluation = evaluateDraftQa(qaInput(PHANTOM_SOURCE_DRAFT, pack));

    // The attribution still names Forrester, but nothing in the pack matches
    // "Forrester", so the phantom stays blocked: the chain resolves identities,
    // not vibes.
    expect(evaluation.verdict).toBe("blocked");

    const resolved = evaluateDraftQa(
      qaInput(
        PHANTOM_SOURCE_DRAFT,
        packWithCitableSources(["Forrester Digital Experience Report"]),
      ),
    );
    expect(
      resolved.claims.find(
        (candidate) =>
          candidate.claimId === claimIdForRule("rl8_unsupported_claim"),
      )?.status,
    ).toBe("passed");
  });
});

describe("honest exemptions", () => {
  it("does not treat a negated sentence as an assertion", () => {
    expect(claim(NEGATED_CLAIM_DRAFT, "rl8_unsupported_claim")?.status).toBe(
      "passed",
    );
  });

  it("does not read claims out of fenced code", () => {
    expect(claim(FENCED_CLAIM_DRAFT, "rl8_unsupported_claim")?.status).toBe(
      "passed",
    );
  });

  it("does not block a plain product link that is not a citation", () => {
    const evaluation = evaluateDraftQa(qaInput(PRODUCT_LINK_DRAFT));

    expect(evaluation.verdict).not.toBe("blocked");
    expect(
      claim(PRODUCT_LINK_DRAFT, "rl12_citation_integrity")?.status,
    ).toBe("passed");
  });
});

describe("P2 — strict determinism", () => {
  it("returns a deeply equal evaluation for the same input", () => {
    const first = evaluateDraftQa(qaInput(PHANTOM_SOURCE_DRAFT));
    const second = evaluateDraftQa(qaInput(PHANTOM_SOURCE_DRAFT));

    expect(second).toStrictEqual(first);
    expect(JSON.stringify(qaClaimsToJson(second.claims))).toBe(
      JSON.stringify(qaClaimsToJson(first.claims)),
    );
  });

  it("emits claims in a stable rule order", () => {
    const ids = evaluateDraftQa(qaInput(CLEAN_DRAFT)).claims.map(
      (candidate) => candidate.claimId,
    );

    expect(ids).toStrictEqual([...ids].filter((id, index, all) => all.indexOf(id) === index));
    expect(ids[ids.length - 1]).toBe(QA_BRIEF_OUTLINE_CLAIM_ID);
  });
});

describe("P4 — advisory rules never gate", () => {
  it("keeps an advisory-only draft off `blocked`", () => {
    const evaluation = evaluateDraftQa(qaInput(ADVISORY_ONLY_DRAFT));

    expect(evaluation.verdict).not.toBe("blocked");
  });

  it("never reports a failed claim for an advisory rule", () => {
    const evaluation = evaluateDraftQa(qaInput(ADVISORY_ONLY_DRAFT));
    const advisoryFailures = evaluation.rules.filter(
      (rule) => QA_RULE_SEVERITY[rule.ruleId] === "advisory" && !rule.pass,
    );

    expect(advisoryFailures.length).toBeGreaterThan(0);
    for (const rule of advisoryFailures) {
      const persisted = evaluation.claims.find(
        (candidate) => candidate.claimId === claimIdForRule(rule.ruleId),
      );
      expect(persisted?.status).not.toBe("failed");
    }
  });
});

describe("P3 — citability never gates", () => {
  it("computes the verdict from rules alone", () => {
    const evaluation = evaluateDraftQa(qaInput(CLEAN_DRAFT));

    expect(evaluation.citability.score).toBeGreaterThanOrEqual(0);
    expect(evaluateQaRules(evaluation.rules)).toBe(
      clampVerdictToFailedClaims(evaluation.verdict, []),
    );
  });
});

describe("P6 — fail to human, never fail open", () => {
  it("reviews an empty draft instead of passing it", () => {
    const evaluation = evaluateDraftQa(qaInput(""));

    expect(evaluation.verdict).toBe("needs_review");
    expect(evaluation.claims.some((c) => c.status === "unevaluated")).toBe(true);
  });

  it("reviews a non-English draft with an explicit reason", () => {
    const evaluation = evaluateDraftQa(
      qaInput(CLEAN_DRAFT, fixturePack({ outputLocale: "zh-CN" })),
    );

    expect(evaluation.verdict).toBe("needs_review");
    expect(
      evaluation.rules.some(
        (rule) =>
          !rule.evaluable &&
          rule.detail.includes("locale not supported by deterministic"),
      ),
    ).toBe(true);
  });

  it("keeps a structurally weak but factually empty draft at needs_review", () => {
    expect(evaluateDraftQa(qaInput(STRUCTURE_WEAK_DRAFT)).verdict).toBe(
      "needs_review",
    );
  });
});

describe("verdict floor", () => {
  it("passes a clean draft", () => {
    expect(evaluateDraftQa(qaInput(CLEAN_DRAFT)).verdict).toBe("passed");
  });

  it("keeps the blocking set at exactly three rules", () => {
    expect([...BLOCKING_RULE_IDS].sort()).toStrictEqual([
      "rl12_citation_integrity",
      "rl8_unsupported_claim",
      "sc9b_sources_resolve_to_pack",
    ]);
  });

  /**
   * `clampVerdictToFailedClaims` was a no-op while the verdict was hard-coded to
   * `needs_review`. Now that a real judgement can return `passed`, it has to
   * still bite: a broken brief -> draft chain (decision O-4) may never read as a
   * clean pass even when every ported rule is green.
   */
  it("still clamps a would-be pass off a broken brief -> draft chain", () => {
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

    expect(
      evaluation.claims.find((c) => c.claimId === QA_BRIEF_OUTLINE_CLAIM_ID)
        ?.status,
    ).toBe("failed");
    expect(evaluation.verdict).toBe("needs_review");
    expect(
      clampVerdictToFailedClaims("passed", evaluation.claims),
    ).toBe("needs_review");
  });
});
