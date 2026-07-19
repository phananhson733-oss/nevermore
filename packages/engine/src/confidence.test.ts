import { describe, expect, it } from "vitest";
import { autoReviewState, deriveConfidence } from "./confidence.ts";
import type { EvidenceDraft } from "./rule.ts";

/** Minimal evidence builder for confidence tests (spec §8.7). */
function ev(overrides: Partial<EvidenceDraft>): EvidenceDraft {
  return {
    sourceProvider: "crawl",
    origin: "direct_public",
    method: "observed",
    grade: "B",
    availability: "available",
    support: "supports",
    subjectRefs: ["https://x/1"],
    claim: "c",
    observedAt: "2026-07-18T00:00:00Z",
    limitation: "l",
    ...overrides,
  };
}

describe("deriveConfidence (spec §8.7)", () => {
  it("A/B observed supporting, no contradiction, not inferred → high", () => {
    expect(deriveConfidence([ev({ grade: "A" })])).toBe("high");
    expect(deriveConfidence([ev({ grade: "B" })])).toBe("high");
  });

  it("a contradiction routes to low (→ needs_more_data), never high/medium", () => {
    const evidence = [ev({ grade: "A" }), ev({ support: "contradicts" })];
    expect(deriveConfidence(evidence)).toBe("low");
  });

  it("a key supporting fact that is unavailable routes to low", () => {
    expect(deriveConfidence([ev({ availability: "unavailable" })])).toBe("low");
  });

  it("a single C-grade support → low", () => {
    expect(deriveConfidence([ev({ grade: "C", method: "inferred" })])).toBe("low");
  });

  it("inferred / C-grade among the key evidence → medium (not high)", () => {
    const evidence = [ev({ grade: "A" }), ev({ grade: "C", method: "inferred" })];
    expect(deriveConfidence(evidence)).toBe("medium");
  });

  it("an overlapping provider discrepancy caps otherwise-high confidence at medium", () => {
    expect(deriveConfidence([ev({ grade: "A" })], { hasDiscrepancy: true })).toBe(
      "medium",
    );
    expect(
      deriveConfidence([ev({ grade: "C", method: "inferred" })], {
        hasDiscrepancy: true,
      }),
    ).toBe("low");
  });

  it("only generated support → low", () => {
    expect(
      deriveConfidence([ev({ origin: "generated", method: "generated", grade: "C" })]),
    ).toBe("low");
  });

  it("low confidence auto-routes to needs_more_data", () => {
    expect(autoReviewState("low")).toBe("needs_more_data");
    expect(autoReviewState("medium")).toBe("unreviewed");
    expect(autoReviewState("high")).toBe("unreviewed");
  });
});
