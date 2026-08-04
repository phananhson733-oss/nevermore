/**
 * The two things about a possible penalty this tool cannot look up, and the
 * visitor can.
 *
 * The Search Console API exposes four resources — Sites, Sitemaps, Search
 * Analytics and URL Inspection. Neither the Manual Actions report nor the
 * Security Issues report is among them, and no other Google API publishes
 * them either. So both statuses arrive the only honest way they can: the
 * visitor opens Search Console, looks at each page, and tells us.
 *
 * That makes them *visitor-reported* facts, not observations of ours, and the
 * distinction is carried through every consumer. A report that prints "no
 * manual action" in the same voice it prints a measured click count is
 * claiming to have checked something it cannot check.
 *
 * Both are asked BEFORE the run, not after. A report built while the answers
 * are unknown has to hedge every sentence in it, and the visitor reads that
 * hedged version first — which is the version they remember.
 */

/**
 * What the visitor saw on one of the two pages.
 *
 * Three answers, not two. A binary [has one] / [does not] forces a visitor who
 * opened the page and could not tell — the two reports look much alike when
 * they are empty, and Search Console shows one property at a time — to assert
 * something they do not know. `uncertain` is not a missing answer; it is an
 * answer, and it is the one that stops the report from concluding anything.
 *
 * There is deliberately no `not_checked`. Answering is a precondition for
 * running, so "never asked" is a state the UI holds before submission, not a
 * state a report can be built in.
 */
export type SelfCheckAnswer = "reports_issue" | "reports_none" | "uncertain";

export const SELF_CHECK_ANSWERS: readonly SelfCheckAnswer[] = [
  "reports_issue",
  "reports_none",
  "uncertain",
];

export function isSelfCheckAnswer(value: unknown): value is SelfCheckAnswer {
  return (
    typeof value === "string" &&
    (SELF_CHECK_ANSWERS as readonly string[]).includes(value)
  );
}

/**
 * Which Search Console page the answer is about.
 *
 * They are separate reports with separate causes and separate recovery
 * procedures, and conflating them is the specific mistake this pair exists to
 * prevent: a security issue is Safe Browsing detecting malware or a deceptive
 * page, which puts a browser interstitial in front of the result and takes
 * clicks to near zero without touching rankings at all.
 */
export type SelfCheckId = "manual_action" | "security_issue";

export const SELF_CHECK_IDS: readonly SelfCheckId[] = [
  "manual_action",
  "security_issue",
];

/**
 * Where the answer came from.
 *
 * There is deliberately only one member. If a future Google API ever makes
 * `tool_observed` possible, adding it is a contract change every consumer has
 * to acknowledge — which is the point.
 */
export type SelfCheckLineage = "visitor_reported";

export interface SelfCheckObservation {
  readonly id: SelfCheckId;
  readonly answer: SelfCheckAnswer;
  readonly lineage: SelfCheckLineage;
}

/**
 * Which output path the report takes.
 *
 * `issue_reported` outranks everything else: a visitor with a live manual
 * action or an active security issue has one useful next step, and burying it
 * under change-point arithmetic costs them the only recovery procedure that is
 * actually defined.
 *
 * `unconfirmed` is a real path, not a degenerate case of `no_issue_reported`.
 * While either answer is `uncertain`, the report must not say anything about
 * penalties — including that there is no evidence of one, which reads as
 * reassurance we have no standing to give.
 */
export type DiagnosisPath =
  | "issue_reported"
  | "no_issue_reported"
  | "unconfirmed";

export interface SelfCheckObservations {
  readonly manualAction: SelfCheckObservation;
  readonly securityIssue: SelfCheckObservation;
  readonly path: DiagnosisPath;
  /**
   * The checks the visitor reported an issue on, in `SELF_CHECK_IDS` order.
   *
   * Both can be present at once, and when they are the report names both:
   * picking one to lead with would leave the other looking optional, and they
   * have different fixes.
   */
  readonly issues: readonly SelfCheckId[];
  /**
   * The checks the visitor could not settle, in `SELF_CHECK_IDS` order.
   *
   * Kept separate from `issues` so the report can ask about exactly the page
   * that is still open rather than sending them back to both.
   */
  readonly unresolved: readonly SelfCheckId[];
}

export interface SelfCheckAnswers {
  readonly manualAction: SelfCheckAnswer;
  readonly securityIssue: SelfCheckAnswer;
}

function observe(id: SelfCheckId, answer: SelfCheckAnswer): SelfCheckObservation {
  return { id, answer, lineage: "visitor_reported" };
}

export function observeSelfChecks(
  answers: SelfCheckAnswers,
): SelfCheckObservations {
  const manualAction = observe("manual_action", answers.manualAction);
  const securityIssue = observe("security_issue", answers.securityIssue);
  const all = [manualAction, securityIssue] as const;

  const issues = all
    .filter((check) => check.answer === "reports_issue")
    .map((check) => check.id);
  const unresolved = all
    .filter((check) => check.answer === "uncertain")
    .map((check) => check.id);

  // A confirmed issue is actionable even while the other page is unsettled —
  // the visitor has something concrete to fix, and withholding it because a
  // different question is open would be pedantry at their expense. It does NOT
  // license anything about the unsettled page; that stays gated per-check,
  // which is why `mayDiscussManualAction` reads the answer and not the path.
  const path: DiagnosisPath =
    issues.length > 0
      ? "issue_reported"
      : unresolved.length > 0
        ? "unconfirmed"
        : "no_issue_reported";

  return { manualAction, securityIssue, path, issues, unresolved };
}

/**
 * Whether the report may say anything at all about penalties in general.
 *
 * Both directions are gated. "We found no evidence of a penalty" is a claim
 * about a question we cannot answer without the visitor's half of it, and a
 * reader who has not settled it will take it as an all-clear.
 */
export function mayDiscussPenalty(
  observations: SelfCheckObservations,
): boolean {
  return observations.path !== "unconfirmed";
}

/**
 * Whether the report may state that there is no manual action specifically.
 *
 * Deliberately NOT derived from `path`. A visitor who reported a security
 * issue but could not settle the manual-action page is on the
 * `issue_reported` path, and advice that rests on there being no manual action
 * — the disavow warning, above all — would then be given on the strength of an
 * answer they never gave.
 */
export function manualActionRuledOutByVisitor(
  observations: SelfCheckObservations,
): boolean {
  return observations.manualAction.answer === "reports_none";
}
