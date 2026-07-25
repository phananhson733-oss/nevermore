/**
 * What a human review of one Content Shadow revision is allowed to be.
 *
 * Pure functions, because the screen has to be able to state without a browser
 * why a review is refused. Two properties are load-bearing:
 *
 * 1. **A review is bound to one revision.** A verdict that judged revision 3
 *    says nothing about the revision 4 in front of the reviewer, so a review is
 *    refused rather than silently applied to text nobody checked.
 * 2. **Every refusal has exactly one named reason.** A disabled control with no
 *    reason beside it teaches a reader that the product is broken; the reason
 *    returned here is what the screen renders next to the control, never in a
 *    tooltip.
 *
 * The client is not the guard. The route recomputes all of this before it
 * writes, so a reader that got this wrong cannot turn it into a bad record.
 */

import type { QaVerdict } from "./_qa-view.ts";

export type ArtifactLifecycle =
  | "generating"
  | "draft"
  | "ready"
  | "failed"
  | "archived";

export type ReviewBlockReason =
  | "no_verdict"
  | "verdict_stale"
  | "verdict_blocked"
  | "unsaved_edits"
  | "already_reviewed"
  | "not_reviewable";

export interface ReviewGateInput {
  readonly verdict: QaVerdict | null;
  readonly evaluatedRevision: number | null;
  readonly currentRevision: number | null;
  readonly artifactStatus: ArtifactLifecycle | null;
  readonly hasUnsavedEdits: boolean;
}

/** Statuses whose deliverable a person can be asked to review at all. */
const REVIEWABLE: ReadonlySet<ArtifactLifecycle> = new Set<ArtifactLifecycle>([
  "draft",
  "ready",
]);

/**
 * The single reason a review cannot be recorded, or `null` when it can.
 *
 * Order matters and is deliberate: a missing verdict outranks a stale one,
 * because "revision 4 has not been checked yet" implies a check once ran, and
 * saying that of a deliverable nothing has ever judged is a small lie in the
 * direction of reassurance.
 */
export function reviewBlockReason(
  input: ReviewGateInput,
): ReviewBlockReason | null {
  if (input.artifactStatus === null || !REVIEWABLE.has(input.artifactStatus)) {
    return "not_reviewable";
  }
  if (input.verdict === null || input.evaluatedRevision === null) {
    return "no_verdict";
  }
  if (
    input.currentRevision === null ||
    input.evaluatedRevision !== input.currentRevision
  ) {
    return "verdict_stale";
  }
  if (input.verdict === "blocked") return "verdict_blocked";
  if (input.hasUnsavedEdits) return "unsaved_edits";
  if (input.artifactStatus === "ready") return "already_reviewed";
  return null;
}

/**
 * Whether passing needs an explicit tick.
 *
 * `needs_review` means the gate found things only a person can settle. Letting
 * that pass on one click would make the verdict decorative.
 */
export function requiresAcknowledgement(verdict: QaVerdict | null): boolean {
  return verdict === "needs_review";
}

export type HumanReviewState = "passed" | "awaiting" | "unevaluated";

/**
 * The quality rail's human-review row.
 *
 * It returns to `awaiting` as soon as the current revision is not the reviewed
 * one — the third of the four things an edit must move together. A row that
 * stayed green would keep asserting a review of text nobody read.
 */
export function humanReviewState(input: ReviewGateInput): HumanReviewState {
  if (input.verdict === null || input.evaluatedRevision === null) {
    return "unevaluated";
  }
  const current =
    input.currentRevision !== null &&
    input.evaluatedRevision === input.currentRevision;
  return input.artifactStatus === "ready" && current ? "passed" : "awaiting";
}

const RECEIPT_HASH_CHARS = 8;

/**
 * A receipt number an auditor can recompute.
 *
 * Both halves are values the product already asks them to quote: the run's
 * frozen input fingerprint and the revision the review applied to. Nothing is
 * minted, so there is no identifier here that exists only inside a receipt.
 */
export function reviewReceiptId(
  contentHash: string | null,
  revision: number | null,
): string | null {
  if (contentHash === null || contentHash.length === 0) return null;
  if (revision === null) return null;
  const prefix = contentHash.slice(0, RECEIPT_HASH_CHARS).toUpperCase();
  return `RCP-REVIEW-${prefix}-R${revision}`;
}
