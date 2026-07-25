/**
 * The QA claim fixtures the three Content Shadow mock E2Es share.
 *
 * One module, for two reasons the specs kept getting wrong on their own.
 *
 * 1. **`severity` is derived, not chosen.** The wire severity of a claim comes
 *    from the gate package's own table (`qaSeverityForClaimId`); a fixture that
 *    writes it by hand is a second copy of a backend invariant. It had already
 *    drifted — `sc9_sources_section` was written `review` in two files while the
 *    table says `advisory` — and it drifted INSIDE the specs that exist to prove
 *    the wire severity is derived.
 *
 * 2. **A fixture must describe a state the gate can actually reach.** The review
 *    spec paired `verdict: "passed"` with a `failed` coverage claim, which
 *    `clampVerdictToFailedClaims` makes impossible: the real gate returns
 *    `needs_review` for that claim set. The one-click pass path, the receipt and
 *    the comparison panel were therefore only ever proven against a state no run
 *    can produce.
 *
 * So the verdict is computed here by `expectedVerdict` rather than declared, and
 * `content-shadow-claims.vitest.ts` checks both properties against the gate
 * package itself — severity and kind against its tables, and `expectedVerdict`
 * against `evaluateQaRules` + `clampVerdictToFailedClaims` composed as the
 * runner composes them.
 */

export type QaClaimKindFixture =
  | "red_line"
  | "structure"
  | "citability"
  | "coverage";
export type QaSeverityFixture = "blocking" | "review" | "advisory";
export type QaClaimStatusFixture = "passed" | "failed" | "unevaluated";
export type QaVerdictFixture = "passed" | "needs_review" | "blocked";

export interface QaClaimFixture {
  readonly claimId: string;
  readonly kind: QaClaimKindFixture;
  readonly severity: QaSeverityFixture;
  readonly status: QaClaimStatusFixture;
  readonly detail: string;
}

/**
 * The verdict the gate would return for a claim set.
 *
 * Mirrors `evaluateQaRules` (a `blocking` rule that FAILED blocks; any other
 * non-advisory rule that failed or could not be judged needs review; advisory
 * rules are skipped entirely) composed with `clampVerdictToFailedClaims` (a
 * verdict may never read `passed` while any claim is `failed`). The vitest guard
 * beside this file runs the real functions and compares, so this mirror cannot
 * drift out of agreement in silence.
 */
export function expectedVerdict(
  claims: readonly QaClaimFixture[],
): QaVerdictFixture {
  if (
    claims.some(
      (claim) => claim.severity === "blocking" && claim.status === "failed",
    )
  ) {
    return "blocked";
  }
  const needsReview = claims.some(
    (claim) =>
      claim.status === "failed" ||
      (claim.severity !== "advisory" && claim.status === "unevaluated"),
  );
  return needsReview ? "needs_review" : "passed";
}

// ---------------------------------------------------------------------------
// Individual claims, named so a spec reads as the state it is setting up.
// ---------------------------------------------------------------------------

const RL13_JARGON_PASSED: QaClaimFixture = {
  claimId: "content-shadow.qa.rl13_banned_jargon",
  kind: "red_line",
  severity: "advisory",
  status: "passed",
  detail: "No banned jargon was found.",
};

const SC9_SOURCES_SECTION_PASSED: QaClaimFixture = {
  claimId: "content-shadow.qa.sc9_sources_section",
  kind: "structure",
  severity: "advisory",
  status: "passed",
  detail: "A sources section is present.",
};

const COVERAGE_COMPLETE: QaClaimFixture = {
  claimId: "content-shadow.qa.brief-outline",
  kind: "coverage",
  severity: "review",
  status: "passed",
  detail:
    "The draft covers all 2 frozen target keyword(s) this cluster committed to.",
};

/** One committed topic the gate reports as not visibly covered, quoted. */
const COVERAGE_GAP: QaClaimFixture = {
  claimId: "content-shadow.qa.brief-outline",
  kind: "coverage",
  severity: "review",
  status: "failed",
  detail:
    'The draft does not visibly cover 1 of the 2 frozen target keyword(s) this cluster committed to: "activation drop-off".',
};

const RL8_UNSUPPORTED_FAILED: QaClaimFixture = {
  claimId: "content-shadow.qa.rl8_unsupported_claim",
  kind: "red_line",
  severity: "blocking",
  status: "failed",
  detail:
    'The assertion "a 2024 industry study reports a 38% activation gap" names no source this run holds.',
};

/**
 * The blocking claim whose LABEL reads as the property when satisfied
 * ("Listed sources match the frozen records"), which is why the blocker block
 * has to state a status word beside every row it lists.
 */
const SC9B_SOURCES_UNRESOLVED_FAILED: QaClaimFixture = {
  claimId: "content-shadow.qa.sc9b_sources_resolve_to_pack",
  kind: "structure",
  severity: "blocking",
  status: "failed",
  detail:
    "A listed source resolves to nothing in the frozen research records for this run.",
};

// ---------------------------------------------------------------------------
// The sets each spec uses.
// ---------------------------------------------------------------------------

/** Nothing outstanding: the one claim set from which `passed` is reachable. */
export const REVIEW_PASSING_CLAIMS: readonly QaClaimFixture[] = [
  RL13_JARGON_PASSED,
  SC9_SOURCES_SECTION_PASSED,
  COVERAGE_COMPLETE,
];

/** One uncovered committed topic: `needs_review`, and an acknowledgement. */
export const REVIEW_COVERAGE_GAP_CLAIMS: readonly QaClaimFixture[] = [
  RL13_JARGON_PASSED,
  SC9_SOURCES_SECTION_PASSED,
  COVERAGE_GAP,
];

/** A fabricated citation, plus the pass-shaped blocking label. */
export const REVIEW_BLOCKING_CLAIMS: readonly QaClaimFixture[] = [
  RL8_UNSUPPORTED_FAILED,
  SC9B_SOURCES_UNRESOLVED_FAILED,
  ...REVIEW_PASSING_CLAIMS,
];

/**
 * The content vertical's gate: what an honest Slice 2 run looks like. No
 * fabricated outside citation to block on, one named reference the gate refuses
 * to guess about, and one committed topic it reports as not visibly covered.
 */
export const VERTICAL_CLAIMS: readonly QaClaimFixture[] = [
  {
    claimId: "content-shadow.qa.rl8_unsupported_claim",
    kind: "red_line",
    severity: "blocking",
    status: "passed",
    detail: "Every research-shaped assertion resolves to a frozen record.",
  },
  RL13_JARGON_PASSED,
  SC9_SOURCES_SECTION_PASSED,
  {
    claimId: "content-shadow.qa.rl12_citation_integrity",
    kind: "red_line",
    severity: "blocking",
    status: "unevaluated",
    detail:
      'This name may be a product, a feature or a section title; a reviewer has to decide. "Activation Milestones" carries no second signal in this draft.',
  },
  COVERAGE_GAP,
];

/** The Execution reading surface's gate: blocked, with advisories beside it. */
export const EXECUTION_CLAIMS: readonly QaClaimFixture[] = [
  RL8_UNSUPPORTED_FAILED,
  {
    claimId: "content-shadow.qa.rl12_citation_integrity",
    kind: "red_line",
    severity: "blocking",
    status: "unevaluated",
    detail:
      'This name may be a product, a feature or a section title; a reviewer has to decide. "Forrester" carries no second signal in this draft.',
  },
  RL13_JARGON_PASSED,
  {
    claimId: "content-shadow.qa.sc5_faq_section",
    kind: "structure",
    severity: "advisory",
    status: "passed",
    detail: "No questions-and-answers section was found.",
  },
  SC9B_SOURCES_UNRESOLVED_FAILED,
  {
    claimId: "content-shadow.qa.citability_geo",
    kind: "citability",
    severity: "advisory",
    status: "passed",
    detail: "Scored 61 out of 100 on the deterministic citability heuristic.",
  },
  {
    claimId: "content-shadow.qa.brief-outline",
    kind: "coverage",
    severity: "review",
    status: "unevaluated",
    detail:
      'Coverage was NOT judged: this draft is "de-DE" and topic matching is an English-language heuristic — locale not supported by deterministic segmentation.',
  },
];

/** The three-way tally a claim set produces, for a receipt fixture. */
export function claimCounts(claims: readonly QaClaimFixture[]): {
  readonly passed: number;
  readonly failed: number;
  readonly unevaluated: number;
} {
  return {
    passed: claims.filter((claim) => claim.status === "passed").length,
    failed: claims.filter((claim) => claim.status === "failed").length,
    unevaluated: claims.filter((claim) => claim.status === "unevaluated").length,
  };
}
