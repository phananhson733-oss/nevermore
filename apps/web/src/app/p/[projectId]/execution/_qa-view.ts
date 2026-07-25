/**
 * How one Content Shadow QA gate reads on screen.
 *
 * Pure functions only — the screen has to be able to state, without a browser,
 * what it will say about a verdict. Three properties are load-bearing and each
 * is asserted in `_qa-view.test.ts`:
 *
 * 1. **`unevaluated` is never folded into "passed".** The gate's third state
 *    means "we did not judge this", and a screen that rounds it up to a tick
 *    performs exactly the substitution the gate was written to prevent.
 * 2. **Severity comes from the wire, never from a local list.** There is no
 *    literal set of blocking claim ids in this file, and there must never be
 *    one: the server derives severity from the gate package's own table.
 * 3. **A rule identifier is never a label.** `claimLabelKey` yields an i18n key
 *    segment; a claim whose id has no translation falls back to a written
 *    phrase, never to a raw rule identifier.
 */

export type QaClaimSeverity = "blocking" | "review" | "advisory";
export type QaClaimStatus = "passed" | "failed" | "unevaluated";
export type QaClaimKind = "red_line" | "structure" | "citability" | "coverage";
export type QaVerdict = "passed" | "needs_review" | "blocked";

export interface QaClaimView {
  readonly claimId: string;
  readonly kind: QaClaimKind;
  readonly severity: QaClaimSeverity;
  readonly status: QaClaimStatus;
  readonly detail: string;
}

/** The claim-id namespace the gate mints. Never shown to anyone. */
const CLAIM_ID_PREFIX = "content-shadow.qa.";

/**
 * The i18n key segment for one claim id, or `null` when the id is not one this
 * build can name. Callers must render a written fallback for `null` — showing
 * the raw id would put a rule identifier in front of a customer.
 */
export function claimLabelKey(claimId: string): string | null {
  if (!claimId.startsWith(CLAIM_ID_PREFIX)) return null;
  const key = claimId.slice(CLAIM_ID_PREFIX.length);
  return /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/u.test(key) ? key : null;
}

/**
 * Group order. Grouping follows the gate's own `kind`, not a hand-written map
 * from 26 checks to five customer-facing buckets: such a map lives in the
 * reader, so it drifts silently as the rule set moves, and a drifted map files
 * a finding under the wrong heading without anything going red.
 */
export const QA_GROUP_ORDER: readonly QaClaimKind[] = [
  "red_line",
  "structure",
  "citability",
  "coverage",
];

export type QaGroupState = "passed" | "failed" | "partial" | "unevaluated";

export interface QaGroup {
  readonly kind: QaClaimKind;
  readonly claims: readonly QaClaimView[];
  readonly state: QaGroupState;
  /** Claims that carry the reason worth putting on the collapsed row. */
  readonly reasonClaim: QaClaimView | null;
  readonly failedCount: number;
  readonly unevaluatedCount: number;
}

export interface QaCounts {
  readonly passed: number;
  readonly failed: number;
  readonly unevaluated: number;
  readonly total: number;
}

export function qaCounts(claims: readonly QaClaimView[]): QaCounts {
  let passed = 0;
  let failed = 0;
  let unevaluated = 0;
  for (const claim of claims) {
    if (claim.status === "passed") passed += 1;
    else if (claim.status === "failed") failed += 1;
    else unevaluated += 1;
  }
  return { passed, failed, unevaluated, total: claims.length };
}

/**
 * The state of one group.
 *
 * `failed` wins over everything; a group nobody could judge reads
 * `unevaluated`; a group with any unjudged check reads `partial` even when the
 * rest passed. An advisory check can never be `failed` — the gate records it as
 * passed by construction — so advisory never turns a row into a defect. It can
 * still be `unevaluated`, and that is reported: "we did not look" is a fact
 * about the run, not a style note to swallow.
 */
export function qaGroupState(claims: readonly QaClaimView[]): QaGroupState {
  const counts = qaCounts(claims);
  if (counts.failed > 0) return "failed";
  if (counts.total > 0 && counts.unevaluated === counts.total) {
    return "unevaluated";
  }
  if (counts.unevaluated > 0) return "partial";
  return "passed";
}

/** The claim whose detail explains a collapsed group row, or `null`. */
function reasonClaimFor(
  claims: readonly QaClaimView[],
  state: QaGroupState,
): QaClaimView | null {
  if (state === "failed") {
    return claims.find((claim) => claim.status === "failed") ?? null;
  }
  if (state === "partial" || state === "unevaluated") {
    return claims.find((claim) => claim.status === "unevaluated") ?? null;
  }
  return null;
}

/** Group the claims by the gate's own `kind`, dropping empty groups. */
export function qaGroups(claims: readonly QaClaimView[]): readonly QaGroup[] {
  return QA_GROUP_ORDER.map((kind) => {
    const inKind = claims.filter((claim) => claim.kind === kind);
    const state = qaGroupState(inKind);
    const counts = qaCounts(inKind);
    return {
      kind,
      claims: inKind,
      state,
      reasonClaim: reasonClaimFor(inKind, state),
      failedCount: counts.failed,
      unevaluatedCount: counts.unevaluated,
    };
  }).filter((group) => group.claims.length > 0);
}

/** Groups that hold something unresolved open themselves; clean ones collapse. */
export function groupOpensByDefault(group: QaGroup): boolean {
  return group.state === "failed" || group.state === "unevaluated";
}

/**
 * The checks that stop a draft, in gate order.
 *
 * Read straight off the wire severity. A local list of "the blocking three"
 * would be a copy of a backend invariant, and the direction it drifts is the
 * expensive one: a blocking check believed advisory reads as safe to accept.
 */
export function blockingClaims(
  claims: readonly QaClaimView[],
): readonly QaClaimView[] {
  return claims.filter(
    (claim) => claim.severity === "blocking" && claim.status === "failed",
  );
}

/**
 * How many checks are recorded as passed no matter what they found.
 *
 * Advisory rules are forced to `passed` by the gate, so "23 passed" without
 * this number beside it overstates what was actually cleared. The screen says
 * the number out loud rather than quietly inflating the tally.
 */
export function advisoryClaimCount(claims: readonly QaClaimView[]): number {
  return claims.filter((claim) => claim.severity === "advisory").length;
}

/**
 * Checks that were looked at but could not be decided — including Task 6's
 * low-confidence calibration, where a named reference with no second signal is
 * reported unjudged rather than guessed either way.
 */
export function unevaluatedClaims(
  claims: readonly QaClaimView[],
): readonly QaClaimView[] {
  return claims.filter((claim) => claim.status === "unevaluated");
}

export type QaVerdictTone = "success" | "warning" | "danger" | "neutral";

/**
 * The tone of a verdict pill.
 *
 * `blocked` is deliberately NOT `danger`. The run completed, the draft exists
 * and the research records exist; what happened is that the gate held back
 * citations it could not check against them. Painting that as a failure teaches
 * a reviewer that the product is broken, when the truthful reading is that it
 * did its job.
 */
export function verdictTone(verdict: QaVerdict | null): QaVerdictTone {
  switch (verdict) {
    case "passed":
      return "success";
    case "needs_review":
      return "warning";
    case "blocked":
      return "warning";
    default:
      return "neutral";
  }
}

/** `true` when the gate's judgement no longer describes the current revision. */
export function verdictIsStale(
  evaluatedRevision: number | null,
  currentRevision: number | null,
): boolean {
  if (evaluatedRevision === null || currentRevision === null) return false;
  return evaluatedRevision !== currentRevision;
}
