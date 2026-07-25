import { describe, expect, it } from "vitest";
import { ProblemError } from "@sf/observability";
import {
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
