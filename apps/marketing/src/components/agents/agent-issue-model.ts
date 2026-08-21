// @input  -- evaluated checks for one Agent plus the neutral audit records behind them
// @output -- issue-first lanes, displayed severity, and affected targets per issue
// @pos    -- pure projection; owns no rendering, no copy text, and no network access

import type { SeoAuditRecord } from "@sf/public-tools";
import type {
  AgentAuditEngineState,
  AgentAuditEvaluatedCheck,
  AgentAuditResultState,
  AgentAuditTruthState,
} from "@sf/public-tools/agent-audit";

import type { AgentKind } from "./agent-types";
import { analyzeAgentRecommendations } from "./agent-result-helpers";

/**
 * How many affected URLs one issue shows, and hands to an assistant, before the
 * rest become a counted remainder.
 *
 * A bounded list keeps the handoff prompt reviewable; the remainder is stated
 * rather than dropped, because a silently truncated list reads as the whole
 * population.
 */
export const AGENT_ISSUE_URL_DISPLAY_LIMIT = 10;

/**
 * Severity as this surface says it out loud.
 *
 * The contract's `tip` is displayed as a suggestion; no numeric priority tier
 * is introduced, because order already carries that and a second scale would
 * have to be kept true against the first.
 */
export type AgentIssueSeverity = "blocker" | "warning" | "suggestion";

/**
 * Which list an issue belongs to.
 *
 * `investigation` is deliberately separate from `actionable`: a source-gated
 * check reached no verdict, so it can be worked on but must never be counted or
 * coloured as an observed failure.
 */
export type AgentIssueLane =
  | "actionable"
  | "investigation"
  | "passed"
  | "excluded";

export type AgentIssueCopyMode = "repair" | "investigation";

/**
 * What this issue affects.
 *
 * `unavailable` exists so a gated check never borrows the shape of a measured
 * one: its count is null, not 0, and it names no URL. `site-scope` is the other
 * honest absence — the observation is about the site, and inventing a URL for it
 * would be a fabrication.
 */
export interface AgentIssueAffectedTargets {
  readonly mode: "urls" | "site-scope" | "unavailable";
  /** Bounded display list; empty for site-scope and unavailable. */
  readonly urls: readonly string[];
  /** Full affected count, or null when the run could not measure it. */
  readonly totalCount: number | null;
  readonly overflowCount: number;
}

export interface AgentIssue {
  readonly id: string;
  readonly agent: AgentKind;
  readonly check: AgentAuditEvaluatedCheck;
  readonly lane: AgentIssueLane;
  /** Null whenever the run reached no failure verdict for this check. */
  readonly severity: AgentIssueSeverity | null;
  /**
   * Whether every axis of this check is a state this build knows how to say.
   * A false here means the row is quarantined rather than guessed at.
   */
  readonly recognized: boolean;
  readonly affected: AgentIssueAffectedTargets;
  readonly evidenceRecords: readonly SeoAuditRecord[];
  readonly copyMode: AgentIssueCopyMode;
}

export interface AgentIssueCounts {
  readonly blocker: number;
  readonly warning: number;
  readonly suggestion: number;
  readonly investigation: number;
  readonly passed: number;
  readonly excluded: number;
}

export interface AgentIssueModel {
  /** Observed failures first, then investigation rows. */
  readonly actionable: readonly AgentIssue[];
  readonly passed: readonly AgentIssue[];
  readonly excluded: readonly AgentIssue[];
  readonly counts: AgentIssueCounts;
  /** No actionable row at all — stated, so the surface can say it in words. */
  readonly isClean: boolean;
}

/**
 * Result state to lane and displayed severity.
 *
 * Total over the contract union on purpose: a new result state added upstream
 * breaks this build instead of silently landing in whichever branch happens to
 * catch it.
 */
const RESULT_LANE: Readonly<
  Record<
    AgentAuditResultState,
    { readonly lane: AgentIssueLane; readonly severity: AgentIssueSeverity | null }
  >
> = {
  blocker: { lane: "actionable", severity: "blocker" },
  warning: { lane: "actionable", severity: "warning" },
  tip: { lane: "actionable", severity: "suggestion" },
  pass: { lane: "passed", severity: null },
  excluded: { lane: "excluded", severity: null },
};

/**
 * Truth states a row's evidence badge can state.
 *
 * `documented`, `inferred`, and `illustrative` are false because no branch of
 * the evaluator returns them for a check: `illustrative` describes a drafted
 * solution preview, not an observation, and rendering it beside observed
 * evidence would present a draft as a finding.
 */
const ROW_TRUTH_RENDERABLE: Readonly<Record<AgentAuditTruthState, boolean>> = {
  observed: true,
  "not-observed": true,
  partial: true,
  "source-gated": true,
  unavailable: true,
  documented: false,
  inferred: false,
  illustrative: false,
};

/**
 * Engine states this build can name. All of them are renderable: engine
 * readiness describes whether a source can answer, which never changes whether
 * an observed finding is true.
 */
const ENGINE_RENDERABLE: Readonly<Record<AgentAuditEngineState, boolean>> = {
  ready: true,
  "needs-integration": true,
  "needs-supplement": true,
  "not-integrated": true,
  "access-required": true,
};

function known<State extends string>(
  table: Readonly<Record<State, unknown>>,
  value: string,
): boolean {
  return Object.hasOwn(table, value);
}

/**
 * Whether every axis carries a state this build knows.
 *
 * Checked at runtime rather than trusted from the type: these values arrive
 * from an evaluated payload, so the compile-time union is a claim about the
 * producer, not a guarantee about this input.
 */
function isRecognized(check: AgentAuditEvaluatedCheck): boolean {
  return (
    known(RESULT_LANE, String(check.result)) &&
    known(ROW_TRUTH_RENDERABLE, String(check.truth)) &&
    ROW_TRUTH_RENDERABLE[check.truth] === true &&
    known(ENGINE_RENDERABLE, String(check.engine))
  );
}

function isSourceGated(check: AgentAuditEvaluatedCheck): boolean {
  return (
    String(check.result) === "excluded" && String(check.truth) === "source-gated"
  );
}

function issueId(agent: AgentKind, check: AgentAuditEvaluatedCheck): string {
  return `${agent}:${check.check.scope}:${check.check.id}`;
}

const UNAVAILABLE_TARGETS: AgentIssueAffectedTargets = {
  mode: "unavailable",
  urls: [],
  totalCount: null,
  overflowCount: 0,
};

/**
 * Affected targets for an observed issue.
 *
 * Sibling records observe the same population, so one URL seen in several
 * records is still one affected URL. An observation carrying no URL is a
 * site-level fact and is reported as scope, never expanded into a URL.
 */
function affectedTargets(
  records: readonly SeoAuditRecord[],
): AgentIssueAffectedTargets {
  const urls: string[] = [];
  const seen = new Set<string>();
  let siteLevel = 0;

  for (const record of records) {
    for (const observation of record.observations) {
      if (observation.url === null) {
        siteLevel += 1;
        continue;
      }
      if (seen.has(observation.url)) continue;
      seen.add(observation.url);
      urls.push(observation.url);
    }
  }

  if (urls.length === 0) {
    return siteLevel > 0
      ? { mode: "site-scope", urls: [], totalCount: siteLevel, overflowCount: 0 }
      : { mode: "urls", urls: [], totalCount: 0, overflowCount: 0 };
  }

  const shown = urls.slice(0, AGENT_ISSUE_URL_DISPLAY_LIMIT);
  return {
    mode: "urls",
    urls: shown,
    totalCount: urls.length,
    overflowCount: urls.length - shown.length,
  };
}

export interface BuildAgentIssueModelInput {
  readonly agent: AgentKind;
  readonly checks: readonly AgentAuditEvaluatedCheck[];
  readonly records: readonly SeoAuditRecord[];
  /** Normalized crawl entry URL, when one page is the subject of this run. */
  readonly targetUrl?: string;
}

/**
 * Project evaluated checks into issue-first lanes.
 *
 * Ordering inside the actionable lane is the ranking the recommendation
 * surface already established — severity, then collected evidence, then Agent
 * ownership, then observed reach — so both surfaces agree on what matters most.
 * Investigation rows follow every observed issue, because a check that reached
 * no verdict cannot outrank one that did.
 */
export function buildAgentIssueModel({
  agent,
  checks,
  records,
  targetUrl,
}: BuildAgentIssueModelInput): AgentIssueModel {
  const analysis = analyzeAgentRecommendations(agent, checks, records, {
    ...(targetUrl === undefined ? {} : { targetUrl }),
    limit: Number.POSITIVE_INFINITY,
  });
  const rankedById = new Map(
    analysis.ranked.map((recommendation) => [recommendation.id, recommendation]),
  );

  const actionable: AgentIssue[] = [];
  const investigation: AgentIssue[] = [];
  const passed: AgentIssue[] = [];
  const excluded: AgentIssue[] = [];

  const quarantine = (check: AgentAuditEvaluatedCheck): AgentIssue => ({
    id: issueId(agent, check),
    agent,
    check,
    lane: "excluded",
    severity: null,
    recognized: false,
    affected: UNAVAILABLE_TARGETS,
    evidenceRecords: [],
    copyMode: "investigation",
  });

  // Ranked order first, so the actionable lane keeps the established ordering.
  for (const recommendation of analysis.ranked) {
    const check = recommendation.check;
    if (!isRecognized(check)) {
      excluded.push(quarantine(check));
      continue;
    }
    actionable.push({
      id: recommendation.id,
      agent,
      check,
      lane: "actionable",
      severity: RESULT_LANE[check.result].severity,
      recognized: true,
      affected: affectedTargets(recommendation.evidenceRecords),
      evidenceRecords: recommendation.evidenceRecords,
      copyMode: "repair",
    });
  }

  for (const check of checks) {
    const id = issueId(agent, check);
    if (rankedById.has(id)) continue;

    if (!isRecognized(check)) {
      excluded.push(quarantine(check));
      continue;
    }

    if (isSourceGated(check)) {
      investigation.push({
        id,
        agent,
        check,
        lane: "investigation",
        // No verdict was reached, so no severity is claimed.
        severity: null,
        recognized: true,
        affected: UNAVAILABLE_TARGETS,
        evidenceRecords: [],
        copyMode: "investigation",
      });
      continue;
    }

    const lane = RESULT_LANE[check.result].lane;
    const issue: AgentIssue = {
      id,
      agent,
      check,
      lane,
      severity: null,
      recognized: true,
      affected: UNAVAILABLE_TARGETS,
      evidenceRecords: [],
      copyMode: "repair",
    };
    if (lane === "passed") passed.push(issue);
    else excluded.push(issue);
  }

  const severityCount = (severity: AgentIssueSeverity): number =>
    actionable.filter((issue) => issue.severity === severity).length;

  return {
    actionable: [...actionable, ...investigation],
    passed,
    excluded,
    counts: {
      blocker: severityCount("blocker"),
      warning: severityCount("warning"),
      suggestion: severityCount("suggestion"),
      investigation: investigation.length,
      passed: passed.length,
      excluded: excluded.length,
    },
    isClean: actionable.length + investigation.length === 0,
  };
}
