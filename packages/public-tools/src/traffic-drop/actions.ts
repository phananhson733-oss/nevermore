import type {
  TrafficAction,
  TrafficActionKind,
  TrafficFinding,
  TrafficFindingId,
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
 * Actions supported by the findings, in rule order, one per id.
 *
 * A rule whose `requires` are not all present is dropped rather than softened:
 * an action with no evidence behind it is the thing this tool exists not to do.
 */
export function buildTrafficActions(
  findings: readonly TrafficFinding[],
): readonly TrafficAction[] {
  const present = new Set(findings.map((finding) => finding.id));
  const actions = new Map<string, TrafficAction>();

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
    });
  }

  return [...actions.values()];
}
