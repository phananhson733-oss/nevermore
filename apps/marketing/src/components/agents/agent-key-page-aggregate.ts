// @input  -- one site-wide evaluation plus one evaluation per selected key page
// @output -- one row per check, merged across pages, with the reach it was judged on
// @pos    -- pure projection; owns no rendering and reaches no network

import type {
  AgentAuditEvaluatedCheck,
  AgentAuditEvaluation,
  AgentAuditResultState,
  AgentAuditTruthState,
} from "@sf/public-tools/agent-audit";

import type { AgentKeyPage } from "./agent-key-pages.ts";

/** What a check turned out to be on one key page. */
export interface AgentKeyPageOutcome {
  readonly page: AgentKeyPage;
  readonly result: AgentAuditResultState;
  readonly measurement: AgentAuditEvaluatedCheck["measurement"];
}

/** How much of the key page set one check was actually judged on. */
export interface AgentKeyPageReach {
  /** Key pages this run selected, whether or not this check could judge them. */
  readonly keyPageTotal: number;
  /** Key pages this check reached a conclusion on. */
  readonly keyPageEvaluatedCount: number;
  /** Key pages this check found the problem on. Never truncated. */
  readonly keyPageHitCount: number;
  /** Hit pages in selection order. The surface truncates; this does not. */
  readonly hitUrls: readonly string[];
  readonly outcomes: readonly AgentKeyPageOutcome[];
}

export interface AgentKeyPageAggregate {
  readonly checks: readonly AgentAuditEvaluatedCheck[];
  /** Keyed by check id. Absent for a site-wide check, which has no page reach. */
  readonly reach: ReadonlyMap<string, AgentKeyPageReach>;
}

/**
 * How bad a result is. Order decides what a merged row says out loud.
 *
 * Total over the contract union on purpose. When a state is added upstream --
 * `observed-only` is the one already designed -- this table stops compiling
 * and someone has to decide where it belongs, rather than letting it fall into
 * whichever branch happens to catch it.
 */
const RESULT_RANK: Readonly<Record<AgentAuditResultState, number>> = {
  blocker: 0,
  warning: 1,
  tip: 2,
  pass: 3,
  // Ahead of excluded: a page that published a measurement said more than one
  // that could not be judged at all, and the merged row should say the more.
  "observed-only": 4,
  excluded: 5,
};

/**
 * How much a truth state claims. The strongest claim any page made wins.
 *
 * `not-observed` and `unavailable` are last and tie to `unavailable`: with no
 * page claiming more, the honest reading is that this run could not see, not
 * that it looked and found nothing.
 */
const TRUTH_RANK: Readonly<Record<AgentAuditTruthState, number>> = {
  observed: 0,
  partial: 1,
  "source-gated": 2,
  "not-observed": 3,
  unavailable: 4,
  documented: 5,
  inferred: 5,
  illustrative: 5,
};

function rankOf<State extends string>(
  table: Readonly<Record<State, number>>,
  value: string,
): number | null {
  return Object.hasOwn(table, value)
    ? table[value as State]
    : null;
}

/**
 * Merge one check across the pages it was evaluated on.
 *
 * Returns the page whose outcome the row states. A state this build cannot
 * rank returns that page unchanged, so the issue model's existing quarantine
 * catches it -- the guard lives in one place rather than two that can disagree.
 */
function worstOutcome(
  entries: readonly { readonly check: AgentAuditEvaluatedCheck }[],
): AgentAuditEvaluatedCheck {
  let worst = entries[0]!.check;
  let worstRank = rankOf(RESULT_RANK, worst.result);
  if (worstRank === null) return worst;

  for (const entry of entries.slice(1)) {
    const rank = rankOf(RESULT_RANK, entry.check.result);
    // Unrankable wins immediately: the row must be quarantined, not merged.
    if (rank === null) return entry.check;
    if (rank < worstRank) {
      worst = entry.check;
      worstRank = rank;
    }
  }
  return worst;
}

/**
 * The strongest truth any page claimed.
 *
 * A state this build cannot rank is returned as-is rather than skipped. Skipping
 * it would drop the one page whose state is unreadable and publish the row under
 * a truth the reader can trust, which is the opposite of what an unknown state
 * means; returned, it reaches the issue model's quarantine.
 */
function mergedTruth(
  entries: readonly { readonly check: AgentAuditEvaluatedCheck }[],
): AgentAuditTruthState {
  let best = entries[0]!.check.truth;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const rank = rankOf(TRUTH_RANK, entry.check.truth);
    if (rank === null) return entry.check.truth;
    if (rank < bestRank) {
      bestRank = rank;
      best = entry.check.truth;
    }
  }
  return best;
}

export interface AggregateKeyPageInput {
  readonly site: AgentAuditEvaluation;
  readonly pages: readonly {
    readonly page: AgentKeyPage;
    readonly evaluation: AgentAuditEvaluation;
  }[];
}

/**
 * One list of checks, judged over one site and a handful of its pages.
 *
 * Site-wide checks pass through: they were evaluated once, against the whole
 * crawl, and re-stating them per page would invent a page-level claim the
 * evidence never made.
 *
 * Page-level checks are merged worst-first, so a blocker on any key page is
 * what the row says. The reach beside it is what keeps that honest: a row that
 * says "blocker" also says how many of the selected pages it was able to look
 * at, because on a page that is not the submitted one many checks can report a
 * hit but never a pass.
 */
export function aggregateKeyPageEvaluations({
  site,
  pages,
}: AggregateKeyPageInput): AgentKeyPageAggregate {
  const checks: AgentAuditEvaluatedCheck[] = [...site.checks];
  const reach = new Map<string, AgentKeyPageReach>();

  const byCheckId = new Map<
    string,
    { readonly page: AgentKeyPage; readonly check: AgentAuditEvaluatedCheck }[]
  >();
  for (const { page, evaluation } of pages) {
    for (const check of evaluation.checks) {
      const entries = byCheckId.get(check.check.id) ?? [];
      entries.push({ page, check });
      byCheckId.set(check.check.id, entries);
    }
  }

  for (const [checkId, entries] of byCheckId) {
    const merged = worstOutcome(entries);
    checks.push({ ...merged, truth: mergedTruth(entries) });

    const outcomes = entries.map(({ page, check }) => ({
      page,
      result: check.result,
      measurement: check.measurement,
    }));
    const hits = entries.filter(
      ({ check }) =>
        check.result === "blocker" ||
        check.result === "warning" ||
        check.result === "tip",
    );
    reach.set(checkId, {
      keyPageTotal: pages.length,
      keyPageEvaluatedCount: entries.filter(
        ({ check }) => check.result !== "excluded",
      ).length,
      keyPageHitCount: hits.length,
      hitUrls: hits.map(({ page }) => page.url),
      outcomes,
    });
  }

  return { checks, reach };
}
