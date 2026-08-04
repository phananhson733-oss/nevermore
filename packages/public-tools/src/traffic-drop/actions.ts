import { manualActionRuledOutByVisitor } from "./self-checks.ts";
import type {
  TrafficAction,
  TrafficActionKind,
  TrafficFinding,
  TrafficFindingId,
  TrafficSiteSignalId,
  TrafficSiteSignals,
} from "./types.ts";

interface TrafficActionRule {
  readonly id: string;
  readonly kind: TrafficActionKind;
  /** All of these must be present for the action to fire. */
  readonly requires: readonly TrafficFindingId[];
  /** Present ones join the basis; absent ones do not hold the action back. */
  readonly supports: readonly TrafficFindingId[];
}

/**
 * What the reader should do, and what it rests on.
 *
 * Every rule is keyed off findings, so an action can never appear without the
 * evidence that justifies it, and the UI can always show the reader which
 * observation put it there.
 *
 * Two of these deliberately do not tell anyone to change a page:
 * `pull_deploy_logs` sends them to data this tool cannot see, and
 * `avoid_rank_recovery` tells them not to act on a number that a composition
 * shift moved. Naming the wrong move is as useful as naming the right one, and
 * it is the recommendation a tool built on evidence can uniquely make.
 */
const TRAFFIC_ACTION_RULES: readonly TrafficActionRule[] = [
  {
    id: "split_cohorts",
    kind: "do",
    requires: ["decline_concentration"],
    supports: ["two_stage_decline", "sustained_decline"],
  },
  {
    id: "isolate_stage_one_ctr",
    kind: "do",
    requires: ["two_stage_decline"],
    supports: ["high_impression_low_click_day"],
  },
  {
    id: "pull_deploy_logs",
    kind: "external_data",
    requires: ["transient_visibility_anomaly"],
    supports: [],
  },
  {
    id: "avoid_rank_recovery",
    kind: "avoid",
    requires: ["two_stage_decline"],
    supports: ["transient_visibility_anomaly"],
  },
  // Same advice, reached from a single-stage decline: average position moves
  // with the query mix there too.
  {
    id: "avoid_rank_recovery",
    kind: "avoid",
    requires: ["sustained_decline"],
    supports: ["transient_visibility_anomaly"],
  },
];

/**
 * Actions that rest on the site-signal group rather than on a finding.
 *
 * The self-check ones come first in the returned list on purpose. A visitor
 * with a live manual action or an active security issue has exactly one useful
 * next step, and every other recommendation competes with it for attention.
 */
function siteSignalActions(
  signals: TrafficSiteSignals,
): readonly TrafficAction[] {
  const actions: TrafficAction[] = [];
  const signal = (id: TrafficSiteSignalId) => ({
    basis: [] as readonly TrafficFindingId[],
    signalBasis: [id] as readonly TrafficSiteSignalId[],
  });

  const selfChecks = signals.selfChecks;

  if (selfChecks.path === "issue_reported") {
    // Nothing else is added on this path. The algorithm-side observations are
    // still in the result for the UI to fold away, but pushing them forward as
    // ACTIONS would have someone with a live manual action rewriting titles.
    //
    // Both are listed when both were reported. They have different procedures
    // — a reconsideration request against a quality notice, a security review
    // after the compromise is cleaned up — and neither substitutes for the
    // other, so choosing one to lead with would leave the other looking
    // optional.
    return selfChecks.issues.map((id) =>
      id === "manual_action"
        ? {
            id: "resolve_manual_action",
            kind: "do",
            ...signal("manual_action"),
          }
        : {
            id: "resolve_security_issue",
            kind: "do",
            ...signal("security_issue"),
          },
    );
  }

  // Ten seconds of the visitor's time buys the fact that decides the rest of
  // the report, and the ask names the page that is actually still open rather
  // than sending them back to both.
  for (const id of selfChecks.unresolved) {
    actions.push(
      id === "manual_action"
        ? {
            id: "check_manual_actions",
            kind: "external_data",
            ...signal("manual_action"),
          }
        : {
            id: "check_security_issues",
            kind: "external_data",
            ...signal("security_issue"),
          },
    );
  }

  // Safe on both remaining paths: on `unconfirmed` it is advice about what not
  // to do before checking, which is not a claim about their penalty status.
  actions.push({
    id: "avoid_assuming_penalty",
    kind: "avoid",
    ...signal("manual_action"),
  });

  if (manualActionRuledOutByVisitor(selfChecks)) {
    // Disavow is only indicated by a manual action that names links. Having
    // established there is none, saying so is the whole value of this entry:
    // "traffic fell, therefore the backlinks are toxic" is the most common
    // wrong reflex in this situation, and an expensive one.
    //
    // Gated on the manual-action answer specifically, NOT on the path. A
    // visitor who could not settle that page is on `unconfirmed` and has told
    // us nothing that would justify this.
    actions.push({
      id: "avoid_disavow",
      kind: "avoid",
      ...signal("manual_action"),
    });
  }

  // A lopsided split points at the cheap technical checks FIRST. A `noindex`,
  // a robots rule or a rendering regression on one template hits non-brand
  // landing pages and leaves the homepage alone — the same shape a content
  // story would produce, but fixable this afternoon.
  if (
    signals.brandSplit.kind === "slice" &&
    signals.brandSplit.shape === "non_brand_declined_more"
  ) {
    actions.push({
      id: "check_landing_page_indexability",
      kind: "do",
      ...signal("brand_non_brand_split"),
    });
  }

  return actions;
}

/**
 * Actions supported by the evidence, in rule order, one per id.
 *
 * A rule whose `requires` are not all present is dropped rather than softened:
 * an action with no evidence behind it is the thing this tool exists not to do.
 */
export function buildTrafficActions(
  findings: readonly TrafficFinding[],
  signals: TrafficSiteSignals,
): readonly TrafficAction[] {
  const present = new Set(findings.map((finding) => finding.id));
  const actions = new Map<string, TrafficAction>();

  for (const action of siteSignalActions(signals)) {
    actions.set(action.id, action);
  }

  // On the issue path the report leads with that and nothing else, so the
  // finding-driven recommendations are withheld rather than ranked below it.
  // They are all about where traffic went; the answer to that question is not
  // actionable until the reported issue is resolved.
  if (signals.selfChecks.path === "issue_reported") {
    return [...actions.values()];
  }

  for (const rule of TRAFFIC_ACTION_RULES) {
    if (actions.has(rule.id)) continue;
    if (!rule.requires.every((id) => present.has(id))) continue;

    actions.set(rule.id, {
      id: rule.id,
      kind: rule.kind,
      basis: [
        ...rule.requires,
        ...rule.supports.filter((id) => present.has(id)),
      ],
      signalBasis: [],
    });
  }

  return [...actions.values()];
}
