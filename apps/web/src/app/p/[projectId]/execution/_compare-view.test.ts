import { describe, expect, it } from "vitest";
import {
  coverageClaimOf,
  coverageVerdict,
  uncoveredTopics,
} from "./_compare-view.ts";
import type { QaClaimView } from "./_qa-view.ts";

function claim(
  status: QaClaimView["status"],
  detail: string,
  claimId = "content-shadow.qa.brief-outline",
): QaClaimView {
  return { claimId, kind: "coverage", severity: "review", status, detail };
}

const COMMITTED = [
  "onboarding analytics",
  "activation drop-off",
  "product qualified leads",
] as const;

describe("coverageClaimOf", () => {
  it("finds the brief coverage claim among the others", () => {
    const claims = [
      claim("passed", "No banned jargon.", "content-shadow.qa.rl13"),
      claim("failed", "…"),
    ];
    expect(coverageClaimOf(claims)?.claimId).toBe(
      "content-shadow.qa.brief-outline",
    );
  });

  it("is null when the run carries no coverage judgement", () => {
    expect(coverageClaimOf([])).toBeNull();
  });
});

describe("uncoveredTopics", () => {
  it("marks exactly the topics the gate named, verbatim", () => {
    const detail =
      'The draft does not visibly cover 2 of the 3 frozen target keyword(s) this cluster committed to: "activation drop-off", "product qualified leads".';
    expect(uncoveredTopics(claim("failed", detail), COMMITTED)).toEqual([
      "activation drop-off",
      "product qualified leads",
    ]);
  });

  it("marks nothing when coverage passed", () => {
    expect(
      uncoveredTopics(
        claim("passed", 'The draft covers all 3 … "activation drop-off".'),
        COMMITTED,
      ),
    ).toEqual([]);
  });

  it("marks nothing when coverage was not judged", () => {
    // D2: a non-English draft is not a draft that failed coverage. Painting
    // topics red here would report a judgement that was never made.
    const detail =
      'Coverage was NOT judged: this draft is "de-DE" and topic matching is an English-language heuristic.';
    expect(uncoveredTopics(claim("unevaluated", detail), COMMITTED)).toEqual([]);
  });

  it("ignores a quoted string that is not one of the committed topics", () => {
    // Rather under-mark than mis-mark: a quotation the frozen checklist does
    // not contain cannot be pinned to a row a reviewer would then act on.
    const detail = 'does not visibly cover: "something else entirely".';
    expect(uncoveredTopics(claim("failed", detail), COMMITTED)).toEqual([]);
  });

  it("marks nothing when there is no claim at all", () => {
    expect(uncoveredTopics(null, COMMITTED)).toEqual([]);
  });
});

describe("coverageVerdict", () => {
  it("separates 'not covered' from 'not judged' from 'covered'", () => {
    expect(coverageVerdict(claim("failed", 'a "activation drop-off" b"'))).toBe(
      "missing",
    );
    expect(coverageVerdict(claim("unevaluated", "x"))).toBe("unevaluated");
    expect(coverageVerdict(claim("passed", "x"))).toBe("covered");
    expect(coverageVerdict(null)).toBe("unevaluated");
  });
});
