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

import type { AgentKeyPageReach } from "./agent-key-page-aggregate";
import type { AgentKind } from "./agent-types";
import {
  analyzeAgentRecommendations,
  RESULT_PRIORITY,
} from "./agent-result-helpers";
import type { AgentRecommendationPriority } from "./agent-result-helpers";

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
  /** Measured and published, deliberately not graded. See the contract state. */
  | "observed-only"
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
  /**
   * `not-captured` is distinct from a measured zero: the run kept no
   * observation that resolves to this issue's target, which is missing
   * evidence rather than a clean population.
   */
  readonly mode: "urls" | "site-scope" | "unavailable" | "not-captured";
  /** Bounded display list; empty for every mode but `urls`. */
  readonly urls: readonly string[];
  /** Full affected count, or null when the run could not measure it. */
  readonly totalCount: number | null;
  readonly overflowCount: number;
  /**
   * Whether the affected population is fully enumerated by its observations.
   *
   * A record publishes `affected` and `observations` separately and does not
   * promise they match, so a population of 25 can arrive with 10 observations.
   * False here means the count is a floor and the surface has to say so.
   */
  readonly enumerated: boolean;
  /**
   * How much of the key page set this issue was judged on.
   *
   * Separate from `totalCount`, which counts the whole crawl. A row that says
   * "3 of 12 key pages" beside "another 44 pages" is stating two different
   * populations on purpose: the pages this Profile pointed at, and everywhere
   * else the same problem was seen.
   *
   * Null for a site-wide check, which has no page reach to state, and for a
   * run that selected no key pages at all.
   */
  readonly keyPages: AgentIssueKeyPageReach | null;
}

export interface AgentIssueKeyPageReach {
  /** Key pages this run selected. */
  readonly total: number;
  /** Key pages this check reached any conclusion on. */
  readonly evaluated: number;
  /** Key pages the problem was found on. Never truncated. */
  readonly hits: number;
  /** Hit pages in selection order, bounded for display. */
  readonly urls: readonly string[];
}

export interface AgentIssue {
  readonly id: string;
  readonly agent: AgentKind;
  readonly check: AgentAuditEvaluatedCheck;
  readonly lane: AgentIssueLane;
  /** Null whenever the run reached no failure verdict for this check. */
  readonly severity: AgentIssueSeverity | null;
  /**
   * The priority label this row prints, from the same table the ranking sorts
   * by. Null whenever no verdict was reached OR the row is quarantined -- the
   * upstream lookup falls back to P2, and a state this build cannot read must
   * not arrive dressed as an ordinary suggestion.
   */
  readonly priority: AgentRecommendationPriority | null;
  /**
   * Whether every axis of this check is a state this build knows how to say.
   * A false here means the row is quarantined rather than guessed at.
   */
  readonly recognized: boolean;
  readonly affected: AgentIssueAffectedTargets;
  readonly evidenceRecords: readonly SeoAuditRecord[];
  readonly copyMode: AgentIssueCopyMode;
  /**
   * The one key page this row is about, when the row is about one page.
   *
   * A check that fails on four key pages produces four rows rather than one
   * row and a list inside it. Reading a list meant holding "which of these is
   * the verdict about" in your head, and the answer was "the worst one" --
   * which is not a question a reader should have to ask. One row, one page,
   * one verdict, and the repair beneath it is written for that page.
   *
   * Null for a site-wide check, for a run with no key pages, and for a check
   * that reached its verdict on exactly one page (which needs no splitting).
   */
  readonly keyPage: AgentIssueKeyPageSubject | null;
}

export interface AgentIssueKeyPageSubject {
  readonly url: string;
  /** Position among this check's hit pages, 1-based, for a stable label. */
  readonly index: number;
  readonly total: number;
  /** Whether this is the page the visitor submitted, whose text was captured. */
  readonly isTarget: boolean;
}

export interface AgentIssueCounts {
  readonly blocker: number;
  readonly warning: number;
  readonly suggestion: number;
  readonly investigation: number;
  readonly passed: number;
  readonly observedOnly: number;
  readonly excluded: number;
  /** Checks quarantined because this build could not read one of their states. */
  readonly quarantined: number;
}

export interface AgentIssueModel {
  /** Observed failures first, then investigation rows. */
  readonly actionable: readonly AgentIssue[];
  readonly passed: readonly AgentIssue[];
  /** Measured and published, deliberately not graded. */
  readonly observedOnly: readonly AgentIssue[];
  readonly excluded: readonly AgentIssue[];
  readonly counts: AgentIssueCounts;
  /** No actionable row at all — stated, so the surface can say it in words. */
  readonly isClean: boolean;
  /**
   * The run reached no conclusion at all: nothing actionable and nothing
   * passed. Distinct from clean, which requires something to have been judged.
   */
  readonly evaluatedNothing: boolean;
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
    {
      readonly lane: AgentIssueLane;
      readonly severity: AgentIssueSeverity | null;
    }
  >
> = {
  blocker: { lane: "actionable", severity: "blocker" },
  warning: { lane: "actionable", severity: "warning" },
  tip: { lane: "actionable", severity: "suggestion" },
  pass: { lane: "passed", severity: null },
  // Its own lane, beside the passed list rather than inside it. A measured
  // density is not a page that passed a density check, because there is no
  // density check to pass.
  "observed-only": { lane: "observed-only", severity: null },
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
  if (
    !known(RESULT_LANE, String(check.result)) ||
    !known(ROW_TRUTH_RENDERABLE, String(check.truth)) ||
    ROW_TRUTH_RENDERABLE[check.truth] !== true ||
    !known(ENGINE_RENDERABLE, String(check.engine))
  ) {
    return false;
  }
  // Each axis can be individually valid and still describe an impossible
  // check. A failure verdict reached without observing anything is the case
  // that matters: publishing it as actionable would turn "no data" into a
  // finding and hand the reader a repair order for it.
  const verdictReached = RESULT_LANE[check.result].severity !== null;
  const nothingObserved =
    String(check.truth) === "source-gated" ||
    String(check.truth) === "unavailable";
  return !(verdictReached && nothingObserved);
}

function isSourceGated(check: AgentAuditEvaluatedCheck): boolean {
  return (
    String(check.result) === "excluded" &&
    String(check.truth) === "source-gated"
  );
}

function issueId(agent: AgentKind, check: AgentAuditEvaluatedCheck): string {
  return `${agent}:${check.check.scope}:${check.check.id}`;
}

/** The results that mean "this page has the problem", and so earn their own row. */
const SPLIT_RESULTS: ReadonlySet<string> = new Set(["blocker", "warning", "tip"]);

function comparable(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return value;
  }
}

const UNAVAILABLE_TARGETS: AgentIssueAffectedTargets = {
  mode: "unavailable",
  urls: [],
  totalCount: null,
  overflowCount: 0,
  enumerated: false,
  keyPages: null,
};

/** No observation resolved to this issue — missing evidence, not a clean zero. */
const NOT_CAPTURED_TARGETS: AgentIssueAffectedTargets = {
  mode: "not-captured",
  urls: [],
  totalCount: null,
  overflowCount: 0,
  enumerated: false,
  keyPages: null,
};

/**
 * Affected targets for an observed issue.
 *
 * Sibling records observe the same population, so one URL seen in several
 * records is still one affected URL. An observation carrying no URL is a
 * site-level fact and is reported as scope, never expanded into a URL.
 *
 * The record's own `affected` is the authoritative population; its
 * observations are what the run published about that population and may be
 * fewer. Reporting the observation count as the total would silently shrink
 * the finding, so the larger of the two is reported and `enumerated` says
 * whether the list actually accounts for it.
 */
function keyPageReachOf(
  reach: AgentKeyPageReach | undefined,
): AgentIssueKeyPageReach | null {
  return reach === undefined || reach.keyPageTotal === 0
    ? null
    : {
        total: reach.keyPageTotal,
        evaluated: reach.keyPageEvaluatedCount,
        hits: reach.keyPageHitCount,
        urls: reach.hitUrls.slice(0, AGENT_ISSUE_URL_DISPLAY_LIMIT),
      };
}

function affectedTargets(
  records: readonly SeoAuditRecord[],
  reach: AgentKeyPageReach | undefined,
): AgentIssueAffectedTargets {
  const keyPages = keyPageReachOf(reach);
  if (records.length === 0) return { ...NOT_CAPTURED_TARGETS, keyPages };

  const urls: string[] = [];
  const seen = new Set<string>();
  let siteLevel = 0;
  let claimedAffected = 0;

  for (const record of records) {
    claimedAffected = Math.max(claimedAffected, record.affected);
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
    if (siteLevel > 0) {
      return {
        mode: "site-scope",
        urls: [],
        totalCount: Math.max(siteLevel, claimedAffected),
        overflowCount: 0,
        enumerated: claimedAffected <= siteLevel,
        keyPages,
      };
    }
    // Records exist but published no observation at all. Reporting 0 here
    // would state a measured clean population the run never established.
    return { ...NOT_CAPTURED_TARGETS, keyPages };
  }

  const shown = urls.slice(0, AGENT_ISSUE_URL_DISPLAY_LIMIT);
  const total = Math.max(urls.length, claimedAffected);
  return {
    mode: "urls",
    urls: shown,
    totalCount: total,
    overflowCount: total - shown.length,
    enumerated: claimedAffected <= urls.length,
    keyPages,
  };
}

export interface BuildAgentIssueModelInput {
  readonly agent: AgentKind;
  readonly checks: readonly AgentAuditEvaluatedCheck[];
  readonly records: readonly SeoAuditRecord[];
  /** Normalized crawl entry URL, when one page is the subject of this run. */
  readonly targetUrl?: string;
  /** The URL the crawl inspected. The form observations carry. */
  readonly inspectedTargetUrl?: string | undefined;
  /** Per-check key page reach, keyed by check id. Absent for a single-page run. */
  readonly keyPageReach?: ReadonlyMap<string, AgentKeyPageReach>;
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
  inspectedTargetUrl,
  keyPageReach,
}: BuildAgentIssueModelInput): AgentIssueModel {
  const reachOf = (check: AgentAuditEvaluatedCheck) =>
    keyPageReach?.get(check.check.id);
  const analysis = analyzeAgentRecommendations(agent, checks, records, {
    ...(targetUrl === undefined ? {} : { targetUrl }),
    ...(inspectedTargetUrl === undefined ? {} : { inspectedTargetUrl }),
    limit: Number.POSITIVE_INFINITY,
  });
  const rankedById = new Map(
    analysis.ranked.map((recommendation) => [
      recommendation.id,
      recommendation,
    ]),
  );

  const actionable: AgentIssue[] = [];
  const investigation: AgentIssue[] = [];
  const passed: AgentIssue[] = [];
  const observedOnly: AgentIssue[] = [];
  const excluded: AgentIssue[] = [];

  const quarantine = (check: AgentAuditEvaluatedCheck): AgentIssue => ({
    id: issueId(agent, check),
    agent,
    check,
    lane: "excluded",
    severity: null,
    priority: null,
    recognized: false,
    affected: UNAVAILABLE_TARGETS,
    evidenceRecords: [],
    copyMode: "investigation",
    keyPage: null,
  });

  // Ranked order first, so the actionable lane keeps the established ordering.
  for (const recommendation of analysis.ranked) {
    const check = recommendation.check;
    if (!isRecognized(check)) {
      excluded.push(quarantine(check));
      continue;
    }
    const reach = reachOf(check);
    /*
      One row per page this check actually failed on.

      The aggregate took its verdict from the worst key page and listed the
      rest inside, which left the reader holding "which of these is this
      verdict about". Split, each row carries its own page, its own result and
      its own measurement, so the repair below it is written for a page that
      really has the problem -- and the row can be handed to the checker on its
      own. Splitting only above one hit: a single-page failure is already one
      row, and giving it a page label would add a word without adding a fact.
    */
    const hits = (reach?.outcomes ?? []).filter((outcome) =>
      SPLIT_RESULTS.has(String(outcome.result)),
    );
    if (hits.length > 1) {
      hits.forEach((outcome, index) => {
        const perPageCheck: AgentAuditEvaluatedCheck = {
          ...check,
          result: outcome.result,
          measurement: outcome.measurement,
        };
        actionable.push({
          id: `${recommendation.id}@${outcome.page.url}`,
          agent,
          check: perPageCheck,
          lane: "actionable",
          severity: RESULT_LANE[outcome.result].severity,
          priority: RESULT_PRIORITY[outcome.result] ?? null,
          recognized: true,
          affected: {
            ...affectedTargets(recommendation.evidenceRecords, reach),
            keyPages: {
              total: reach?.keyPageTotal ?? 0,
              evaluated: reach?.keyPageEvaluatedCount ?? 0,
              hits: hits.length,
              urls: [outcome.page.url],
            },
          },
          evidenceRecords: recommendation.evidenceRecords,
          copyMode: "repair",
          keyPage: {
            url: outcome.page.url,
            index: index + 1,
            total: hits.length,
            isTarget:
              inspectedTargetUrl !== undefined &&
              inspectedTargetUrl !== null &&
              comparable(outcome.page.url) === comparable(inspectedTargetUrl),
          },
        });
      });
      continue;
    }

    actionable.push({
      id: recommendation.id,
      agent,
      check,
      lane: "actionable",
      severity: RESULT_LANE[check.result].severity,
      priority: RESULT_PRIORITY[check.result] ?? null,
      recognized: true,
      affected: affectedTargets(recommendation.evidenceRecords, reach),
      evidenceRecords: recommendation.evidenceRecords,
      copyMode: "repair",
      keyPage: null,
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
        priority: null,
        recognized: true,
        affected: UNAVAILABLE_TARGETS,
        evidenceRecords: [],
        copyMode: "investigation",
        keyPage: null,
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
      // Passed and excluded rows carry no verdict to prioritise.
      priority: null,
      recognized: true,
      // No affected URLs, but the reach still matters: a check that passed on
      // four of twelve key pages has not passed on twelve, and the fail-closed
      // ruling makes that the common case rather than an edge one.
      affected: {
        ...UNAVAILABLE_TARGETS,
        keyPages: keyPageReachOf(reachOf(check)),
      },
      evidenceRecords: [],
      copyMode: "repair",
      keyPage: null,
    };
    if (lane === "passed") passed.push(issue);
    else if (lane === "observed-only") observedOnly.push(issue);
    else excluded.push(issue);
  }

  const severityCount = (severity: AgentIssueSeverity): number =>
    actionable.filter((issue) => issue.severity === severity).length;
  const quarantined = excluded.filter((issue) => !issue.recognized).length;

  return {
    actionable: [...actionable, ...investigation],
    passed,
    observedOnly,
    excluded,
    counts: {
      blocker: severityCount("blocker"),
      warning: severityCount("warning"),
      suggestion: severityCount("suggestion"),
      investigation: investigation.length,
      passed: passed.length,
      observedOnly: observedOnly.length,
      excluded: excluded.length,
      quarantined,
    },
    /**
     * A quarantined check is a check this build could not read, which is not
     * the same as a check that came back clean. Calling such a run clean would
     * put a green pass over evidence nobody has looked at.
     *
     * `passed > 0` carries the other half: a run where every check was excluded
     * for want of a source reached no conclusion either, and "nothing
     * actionable" over zero evaluated checks reads as a clean bill of health.
     */
    isClean:
      actionable.length + investigation.length === 0 &&
      quarantined === 0 &&
      passed.length > 0,
    /** Nothing was actionable and nothing passed: the run concluded nothing. */
    evaluatedNothing:
      actionable.length + investigation.length === 0 && passed.length === 0,
  };
}
