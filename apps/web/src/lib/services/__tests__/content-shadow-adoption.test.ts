import { describe, expect, it } from "vitest";
import { ProblemError } from "@sf/observability";
import {
  adoptionBlockingClaimIds,
  contentShadowAdoptionBlocked,
  verdictForbidsAdoption,
} from "@/lib/services/content-shadow-adoption";

/**
 * The one judgement both doors into `ready` consult.
 *
 * These are the properties that make sharing the module worth anything: if the
 * two call sites could produce different problem codes or different reasons,
 * the module would be a shared import with two behaviours, which is the drift
 * it exists to prevent — only harder to spot.
 */
describe("content shadow adoption", () => {
  it("forbids adoption on exactly the blocked verdict", () => {
    expect(verdictForbidsAdoption("blocked")).toBe(true);
    expect(verdictForbidsAdoption("needs_review")).toBe(false);
    expect(verdictForbidsAdoption("passed")).toBe(false);
    // No gate row, and an unknown verdict from a future adapter: neither is a
    // refusal. "We have not judged this" must never be reported as "we judged
    // it and it failed".
    expect(verdictForbidsAdoption(null)).toBe(false);
    expect(verdictForbidsAdoption(undefined)).toBe(false);
    expect(verdictForbidsAdoption("something_else")).toBe(false);
  });

  it("raises one refusal, differing only in the field it points at", () => {
    const review = contentShadowAdoptionBlocked("/baseRevision");
    const patch = contentShadowAdoptionBlocked("/status");

    for (const error of [review, patch]) {
      expect(error).toBeInstanceOf(ProblemError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.status).toBe(422);
      expect(error.fieldErrors).toHaveLength(1);
      expect(error.fieldErrors?.[0]?.code).toBe("verdict_blocked");
      // Not an error message: it names the boundary and the way forward.
      expect(error.message).toContain("frozen research records cannot verify");
      expect(error.message).toContain("Revise it and check it again.");
      expect(error.message).not.toMatch(/error|failed/i);
    }

    expect(patch.message).toBe(review.message);
    expect(patch.fieldErrors?.[0]?.message).toBe(
      review.fieldErrors?.[0]?.message,
    );
    expect(review.fieldErrors?.[0]?.pointer).toBe("/baseRevision");
    expect(patch.fieldErrors?.[0]?.pointer).toBe("/status");
  });
});

/**
 * The reason the read model carries, derived from the same records the refusal
 * is derived from.
 *
 * The Studio "Mark ready" control has to be able to say WHY before it is
 * clicked, and the only honest source for that sentence is the gate row the
 * server already consults. What the control must never do is re-derive which
 * checks block — `@sf/flow-shadow` owns that table, and a second copy in a
 * reader drifts in the expensive direction: a blocking check believed advisory
 * reads to an operator as safe to adopt.
 */
describe("content shadow adoption reasons", () => {
  it("names exactly the blocking checks that did not pass, in gate order", () => {
    expect(
      adoptionBlockingClaimIds([
        {
          claimId: "content-shadow.qa.rl12_citation_integrity",
          kind: "red_line",
          status: "failed",
          detail: "A citation resolves to nothing in the frozen pack.",
        },
        // `review` severity in `QA_RULE_SEVERITY`, so it can never be the
        // reason a verdict is `blocked` — asserted here so a future severity
        // change is visible rather than silent.
        {
          claimId: "content-shadow.qa.rl12b_unresolved_link",
          kind: "red_line",
          status: "failed",
          detail: "A link points somewhere the pack cannot confirm.",
        },
        {
          claimId: "content-shadow.qa.rl8_unsupported_claim",
          kind: "red_line",
          status: "failed",
          detail: "A statement carries no traceable source.",
        },
        // Blocking, but it passed.
        {
          claimId: "content-shadow.qa.sc9b_sources_resolve_to_pack",
          kind: "structure",
          status: "passed",
          detail: "Every listed source resolves.",
        },
      ]),
    ).toEqual([
      "content-shadow.qa.rl12_citation_integrity",
      "content-shadow.qa.rl8_unsupported_claim",
    ]);
  });

  it("reports no reason rather than a guessed one when the claims are unreadable", () => {
    // The verdict is a column and stays authoritative; only the itemised
    // reasons are lost. Inventing one here would be the substitution the gate
    // exists to prevent, in the reader instead of the writer.
    expect(adoptionBlockingClaimIds([{ nonsense: true }])).toEqual([]);
    expect(adoptionBlockingClaimIds([])).toEqual([]);
  });
});
