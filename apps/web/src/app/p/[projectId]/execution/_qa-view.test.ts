import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  claimIdForRule,
  qaRuleKind,
  QA_BRIEF_OUTLINE_CLAIM_ID,
  QA_RULE_ORDER,
  QA_RULE_SEVERITY,
  qaSeverityForClaimId,
} from "@sf/flow-shadow";
import {
  advisoryClaimCount,
  blockingClaims,
  claimLabelKey,
  groupOpensByDefault,
  qaCounts,
  qaGroups,
  qaGroupState,
  unevaluatedClaims,
  verdictIsStale,
  verdictTone,
  type QaClaimView,
} from "./_qa-view.ts";

/** The shipped message catalogues, read as data so no bundler is involved. */
function claimLabels(locale: "en" | "zh-CN"): Record<string, string> {
  const messages = JSON.parse(
    readFileSync(
      new URL(
        `../../../../../../../packages/i18n/src/messages/${locale}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { studio: { qa: { claimLabels: Record<string, string> } } };
  return messages.studio.qa.claimLabels;
}

function claim(over: Partial<QaClaimView> = {}): QaClaimView {
  return {
    claimId: "content-shadow.qa.sc5_faq_section",
    kind: "structure",
    severity: "advisory",
    status: "passed",
    detail: "detail",
    ...over,
  };
}

/** Every claim the gate can mint, as the wire delivers it. */
const ALL_CLAIMS: readonly QaClaimView[] = [
  ...QA_RULE_ORDER.map((ruleId) =>
    claim({
      claimId: claimIdForRule(ruleId),
      kind: qaRuleKind(ruleId),
      severity: QA_RULE_SEVERITY[ruleId],
    }),
  ),
  claim({
    claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
    kind: "coverage",
    severity: qaSeverityForClaimId(QA_BRIEF_OUTLINE_CLAIM_ID),
  }),
];

describe("claim labels", () => {
  it("never lets a rule identifier stand in for a label", () => {
    expect(claimLabelKey("content-shadow.qa.rl8_unsupported_claim")).toBe(
      "rl8_unsupported_claim",
    );
    expect(claimLabelKey("rl8_unsupported_claim")).toBeNull();
    expect(claimLabelKey("content-shadow.qa.")).toBeNull();
    expect(claimLabelKey("content-shadow.qa.Not A Key")).toBeNull();
  });

  it("has a written name in both languages for every claim the gate can emit", () => {
    const en = claimLabels("en");
    const zh = claimLabels("zh-CN");

    for (const view of ALL_CLAIMS) {
      const key = claimLabelKey(view.claimId);
      expect(key, view.claimId).not.toBeNull();
      expect(en[key!], `en label for ${view.claimId}`).toBeTruthy();
      expect(zh[key!], `zh label for ${view.claimId}`).toBeTruthy();
    }
    // A label that leaked a rule identifier would defeat the point of having
    // labels at all.
    for (const label of [...Object.values(en), ...Object.values(zh)]) {
      expect(label).not.toMatch(/\b(?:rl\d|sc\d|scdup|citability_geo)\b/iu);
    }
  });
});

describe("counts and groups", () => {
  it("counts the three claim states separately and never rounds one up", () => {
    const counts = qaCounts([
      claim({ status: "passed" }),
      claim({ status: "failed", severity: "review" }),
      claim({ status: "unevaluated", severity: "review" }),
      claim({ status: "unevaluated", severity: "advisory" }),
    ]);
    expect(counts).toEqual({
      passed: 1,
      failed: 1,
      unevaluated: 2,
      total: 4,
    });
  });

  it("reads a group with an unjudged check as partial, not as passed", () => {
    expect(
      qaGroupState([
        claim({ status: "passed" }),
        claim({ status: "unevaluated", severity: "review" }),
      ]),
    ).toBe("partial");
  });

  it("reads a group nobody could judge as unevaluated", () => {
    expect(
      qaGroupState([
        claim({ status: "unevaluated" }),
        claim({ status: "unevaluated", severity: "review" }),
      ]),
    ).toBe("unevaluated");
  });

  it("lets one failure decide the group, whatever else passed", () => {
    expect(
      qaGroupState([
        claim({ status: "passed" }),
        claim({ status: "failed", severity: "blocking" }),
        claim({ status: "unevaluated", severity: "review" }),
      ]),
    ).toBe("failed");
  });

  it("keeps an advisory hit out of the failed state entirely", () => {
    // The gate records advisory rules as passed, so an advisory can only ever
    // arrive as passed or unevaluated. A group of them is never a defect.
    expect(
      qaGroupState([
        claim({ severity: "advisory", status: "passed" }),
        claim({ severity: "advisory", status: "passed" }),
      ]),
    ).toBe("passed");
  });

  it("groups by the gate's own kind and keeps gate order", () => {
    const groups = qaGroups(ALL_CLAIMS);
    expect(groups.map((group) => group.kind)).toEqual([
      "red_line",
      "structure",
      "citability",
      "coverage",
    ]);
    expect(
      groups.reduce((total, group) => total + group.claims.length, 0),
    ).toBe(ALL_CLAIMS.length);
  });

  it("opens the groups holding something unresolved and collapses the clean ones", () => {
    const [failed, partial, clean] = qaGroups([
      claim({ kind: "red_line", status: "failed", severity: "blocking" }),
      claim({ kind: "structure", status: "unevaluated", severity: "review" }),
      claim({ kind: "structure", status: "passed" }),
      claim({ kind: "citability", status: "passed" }),
    ]);
    expect(groupOpensByDefault(failed!)).toBe(true);
    expect(groupOpensByDefault(partial!)).toBe(false); // partial: shown, not forced open
    expect(groupOpensByDefault(clean!)).toBe(false);
    expect(failed!.reasonClaim?.status).toBe("failed");
    expect(partial!.reasonClaim?.status).toBe("unevaluated");
    expect(clean!.reasonClaim).toBeNull();
  });
});

describe("severity is read, never re-derived", () => {
  it("takes the blocking set from the wire", () => {
    const blocked = blockingClaims([
      claim({ severity: "blocking", status: "failed" }),
      claim({ severity: "blocking", status: "passed" }),
      claim({ severity: "review", status: "failed" }),
      claim({ severity: "advisory", status: "passed" }),
    ]);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.severity).toBe("blocking");
  });

  it("carries no local list of blocking rule ids", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("./_qa-view.ts", import.meta.url).pathname,
        "utf8",
      ),
    );
    // A copy of the backend's blocking set here is the drift this module
    // exists to avoid; the guard is structural rather than remembered.
    expect(source).not.toMatch(/rl8_unsupported_claim|sc9b_sources/u);
  });

  it("counts the advisory checks so a pass tally cannot overstate itself", () => {
    expect(advisoryClaimCount(ALL_CLAIMS)).toBe(
      QA_RULE_ORDER.filter((id) => QA_RULE_SEVERITY[id] === "advisory").length,
    );
    expect(advisoryClaimCount(ALL_CLAIMS)).toBeGreaterThan(0);
  });

  it("keeps unjudged checks reachable so a reviewer can read why", () => {
    const claims = [
      claim({ status: "unevaluated", severity: "blocking", detail: "why" }),
      claim({ status: "passed" }),
    ];
    expect(unevaluatedClaims(claims)).toHaveLength(1);
    expect(unevaluatedClaims(claims)[0]?.detail).toBe("why");
  });
});

describe("verdict presentation", () => {
  it("never paints `blocked` as a failure", () => {
    // The run completed and the draft exists; what happened is that the gate
    // held back citations it could not check. `danger` would read as a fault.
    expect(verdictTone("blocked")).toBe("warning");
    expect(verdictTone("needs_review")).toBe("warning");
    expect(verdictTone("passed")).toBe("success");
    expect(verdictTone(null)).toBe("neutral");
  });

  it("knows when a verdict stopped describing the current revision", () => {
    expect(verdictIsStale(1, 2)).toBe(true);
    expect(verdictIsStale(2, 2)).toBe(false);
    expect(verdictIsStale(null, 2)).toBe(false);
    expect(verdictIsStale(1, null)).toBe(false);
  });
});
