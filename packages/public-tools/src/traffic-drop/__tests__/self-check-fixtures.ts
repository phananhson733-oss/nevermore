import type { SelfCheckAnswers } from "../self-checks.ts";

/**
 * Self-check answers for tests that are about something else.
 *
 * `BOTH_CLEAR` is the default for those: it puts the report on the
 * `no_issue_reported` path, which is the one where every other observation is
 * actually rendered. A test about window arithmetic should not have to think
 * about penalties, but it must still SAY which answers it assumed — the input
 * is required precisely so that no caller can leave it implicit.
 */
export const BOTH_CLEAR: SelfCheckAnswers = {
  manualAction: "reports_none",
  securityIssue: "reports_none",
};

export const BOTH_UNCERTAIN: SelfCheckAnswers = {
  manualAction: "uncertain",
  securityIssue: "uncertain",
};

export const MANUAL_ACTION_REPORTED: SelfCheckAnswers = {
  manualAction: "reports_issue",
  securityIssue: "reports_none",
};

export const SECURITY_ISSUE_REPORTED: SelfCheckAnswers = {
  manualAction: "reports_none",
  securityIssue: "reports_issue",
};
