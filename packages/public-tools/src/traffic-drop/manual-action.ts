/**
 * The one thing about a possible penalty this tool can actually establish.
 *
 * Google publishes no Manual Actions endpoint — `webmasters v3` covers sites,
 * sitemaps and searchanalytics, and `searchconsole v1` covers URL inspection.
 * Neither exposes whether a property has a manual action against it. So the
 * status arrives the only honest way it can: the visitor opens Search Console,
 * looks, and tells us.
 *
 * That makes it a *visitor-reported* fact, not an observation of ours, and the
 * distinction is carried through every consumer. A report that prints "no
 * manual action" in the same voice it prints a measured click count is
 * claiming to have checked something it cannot check.
 */

/**
 * What the visitor told us about their Manual Actions report.
 *
 * Four states, not two. A binary [has one] / [does not] forces a visitor who
 * has not looked — or who looked at the Security Issues report, which is a
 * different page, or who has several properties and is not sure which one they
 * opened — to assert something they do not know. The default is that they have
 * not answered, and the report must be able to say so.
 */
export type ManualActionStatus =
  | "not_checked"
  | "user_reports_manual_action"
  | "user_reports_none"
  | "uncertain";

export const MANUAL_ACTION_STATUSES: readonly ManualActionStatus[] = [
  "not_checked",
  "user_reports_manual_action",
  "user_reports_none",
  "uncertain",
];

export const DEFAULT_MANUAL_ACTION_STATUS: ManualActionStatus = "not_checked";

export function isManualActionStatus(
  value: unknown,
): value is ManualActionStatus {
  return (
    typeof value === "string" &&
    (MANUAL_ACTION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Which output path the report takes.
 *
 * `manual_action` outranks everything else in the report: a visitor with a
 * live manual action needs to act on that, and burying it under change-point
 * arithmetic costs them the one recovery step that is actually available.
 *
 * `unconfirmed` is a real path, not a degenerate case of `no_manual_action`.
 * Until the visitor has looked, the report must not say anything about
 * penalties — including that there is no evidence of one, which reads as
 * reassurance we have no standing to give.
 */
export type DiagnosisPath = "manual_action" | "no_manual_action" | "unconfirmed";

export function diagnosisPathFor(status: ManualActionStatus): DiagnosisPath {
  switch (status) {
    case "user_reports_manual_action":
      return "manual_action";
    case "user_reports_none":
      return "no_manual_action";
    case "not_checked":
    case "uncertain":
      return "unconfirmed";
  }
}

/**
 * Where the status came from.
 *
 * There is deliberately no `tool_observed` member. If a future Google API ever
 * makes one possible, adding it is a contract change that every consumer has
 * to acknowledge — which is the point.
 */
export type ManualActionLineage = "visitor_reported" | "not_reported";

export interface ManualActionObservation {
  readonly status: ManualActionStatus;
  readonly path: DiagnosisPath;
  readonly lineage: ManualActionLineage;
}

export function observeManualAction(
  status: ManualActionStatus,
): ManualActionObservation {
  return {
    status,
    path: diagnosisPathFor(status),
    lineage: status === "not_checked" ? "not_reported" : "visitor_reported",
  };
}

/**
 * Whether the report may say anything at all about penalties.
 *
 * Both directions are gated. "We found no evidence of a penalty" is a claim
 * about a question we cannot answer without the visitor's half of it, and a
 * reader who has not opened Search Console will take it as an all-clear.
 */
export function mayDiscussPenalty(
  observation: ManualActionObservation,
): boolean {
  return observation.path !== "unconfirmed";
}
