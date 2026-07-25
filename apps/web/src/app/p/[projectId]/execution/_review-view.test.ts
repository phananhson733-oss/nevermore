import { describe, expect, it } from "vitest";
import {
  humanReviewState,
  requiresAcknowledgement,
  reviewBlockReason,
  reviewReceiptId,
  type ReviewGateInput,
} from "./_review-view.ts";

function gate(overrides: Partial<ReviewGateInput> = {}): ReviewGateInput {
  return {
    verdict: "passed",
    evaluatedRevision: 3,
    currentRevision: 3,
    artifactStatus: "draft",
    hasUnsavedEdits: false,
    ...overrides,
  };
}

describe("reviewBlockReason", () => {
  it("lets a clean, current, unedited draft through", () => {
    expect(reviewBlockReason(gate())).toBeNull();
  });

  it("refuses when no automated verdict exists yet", () => {
    expect(reviewBlockReason(gate({ verdict: null }))).toBe("no_verdict");
    // Even with a revision in hand: nothing was judged, so nothing can pass.
    expect(
      reviewBlockReason(gate({ verdict: null, evaluatedRevision: null })),
    ).toBe("no_verdict");
  });

  it("refuses when the verdict describes a different revision", () => {
    // The whole point of binding a review to a revision: a verdict for
    // revision 3 says nothing about the revision 4 a reviewer is reading.
    expect(
      reviewBlockReason(gate({ evaluatedRevision: 3, currentRevision: 4 })),
    ).toBe("verdict_stale");
  });

  it("refuses a blocked verdict", () => {
    expect(reviewBlockReason(gate({ verdict: "blocked" }))).toBe(
      "verdict_blocked",
    );
  });

  it("refuses while edits are unsaved", () => {
    expect(reviewBlockReason(gate({ hasUnsavedEdits: true }))).toBe(
      "unsaved_edits",
    );
  });

  it("reports an already reviewed revision instead of offering to review it again", () => {
    expect(reviewBlockReason(gate({ artifactStatus: "ready" }))).toBe(
      "already_reviewed",
    );
  });

  it("reports the missing verdict before the stale one", () => {
    // "Revision 4 has not been checked yet" would be a guess when no check has
    // ever run against this deliverable at all.
    expect(
      reviewBlockReason(
        gate({ verdict: null, evaluatedRevision: null, currentRevision: 4 }),
      ),
    ).toBe("no_verdict");
  });

  it("refuses a deliverable that is not in a reviewable state", () => {
    expect(reviewBlockReason(gate({ artifactStatus: "generating" }))).toBe(
      "not_reviewable",
    );
    expect(reviewBlockReason(gate({ artifactStatus: "failed" }))).toBe(
      "not_reviewable",
    );
    expect(reviewBlockReason(gate({ artifactStatus: null }))).toBe(
      "not_reviewable",
    );
  });
});

describe("requiresAcknowledgement", () => {
  it("asks for an explicit tick only when a person has to confirm findings", () => {
    expect(requiresAcknowledgement("needs_review")).toBe(true);
    expect(requiresAcknowledgement("passed")).toBe(false);
    expect(requiresAcknowledgement("blocked")).toBe(false);
    expect(requiresAcknowledgement(null)).toBe(false);
  });
});

describe("humanReviewState", () => {
  it("is unevaluated before any automated verdict exists", () => {
    expect(humanReviewState(gate({ verdict: null }))).toBe("unevaluated");
  });

  it("is passed once the deliverable is marked reviewed", () => {
    expect(humanReviewState(gate({ artifactStatus: "ready" }))).toBe("passed");
  });

  it("returns to awaiting the moment a new revision exists", () => {
    // This is the third of the four things that must move together when an
    // edit lands; a group that stayed green here would keep asserting a
    // review of text nobody reviewed.
    expect(
      humanReviewState(
        gate({
          artifactStatus: "draft",
          evaluatedRevision: 3,
          currentRevision: 4,
        }),
      ),
    ).toBe("awaiting");
  });

  it("is awaiting for a judged but unreviewed draft", () => {
    expect(humanReviewState(gate())).toBe("awaiting");
  });
});

describe("reviewReceiptId", () => {
  it("is derived from the frozen inputs and the revision it describes", () => {
    // Both halves are values the product already asks an auditor to quote, so
    // the receipt number can be recomputed from the record rather than trusted.
    expect(
      reviewReceiptId(
        "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
        4,
      ),
    ).toBe("RCP-REVIEW-A1B2C3D4-R4");
  });

  it("has no id at all rather than an invented one", () => {
    expect(reviewReceiptId(null, 4)).toBeNull();
    expect(reviewReceiptId("", 4)).toBeNull();
    expect(reviewReceiptId("a1b2c3d4e5f6", null)).toBeNull();
  });
});
