// @input  -- per-call provider cost, the shared Supabase quota, and a clock
// @output -- actual provider-cost telemetry plus legacy opt-in admission helpers
// @pos    -- the only place DataForSEO spend on the keyword tool is counted; v2 does not cap it
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createPublicToolError } from "@sf/public-tools";
import {
  EMPTY_KEYWORD_LLM_USAGE,
  type KeywordLlmUsage,
} from "./keyword-llm-client.ts";
import {
  consumePublicToolQuota,
  DEFAULT_SHARED_QUOTA_DEPENDENCIES,
  type SharedQuotaDependencies,
} from "./shared-rate-limit.ts";

/**
 * The four billed endpoints the Keyword Opportunity Map touches.
 *
 * Grouped by endpoint rather than summed flat because candidate pricing,
 * all-candidate SERP reads, rank lookup and traffic lookup have different cost
 * shapes. A run that came in expensive is only diagnosable if the total can be
 * split back apart. Search Console is absent on purpose: it is the one stage
 * that costs nothing, and listing it at 0 would read as "measured zero".
 */
export const KEYWORD_COST_ENDPOINTS = [
  "keyword_overview",
  "serp_organic",
  "bulk_ranks",
  "bulk_traffic",
] as const;

export type KeywordCostEndpoint = (typeof KEYWORD_COST_ENDPOINTS)[number];

/**
 * Legacy opt-in ceiling on provider spend inside one run, in USD.
 *
 * 0.25 is three times the measured p50 of $0.088 (2026-08-10 calibration: 150
 * candidates, 20 SERP samples, single market). Three times, not 1.2x, because
 * the p50 is dominated by how many candidates the provider actually holds data
 * for — 25% return rate in the spike — and a legitimate run against a
 * well-covered market can return four times as many billed rows without
 * anything being wrong. A ceiling set near the median would fire on the good
 * runs and teach everyone to raise it. At 3x it can only fire on a shape the
 * calibration never saw, which is the only case worth stopping.
 *
 * The v2 handler deliberately does not call `admitStage`; it records actual
 * spend only. This value remains for older callers and compatibility tests.
 */
export const KEYWORD_MAX_PROVIDER_COST_USD = 0.25;

/** Measured p50 of one full run (2026-08-10 calibration). */
export const KEYWORD_RUN_P50_COST_USD = 0.088;

/**
 * Legacy account-level exposure a single day may create, in USD.
 *
 * The dormant breaker exists to bound the blast radius of one bad day, not to pace the
 * month: monthly pacing is already enforced outside our code by the prepaid
 * balance and DataForSEO's own account cost limit (error 40203). $5 buys
 * {@link KEYWORD_DAILY_RUN_MAX} runs at the p50, comfortably above any plausible
 * day of real traffic on a tool that requires a Google sign-in plus a Search
 * Console grant.
 *
 * Honest ceiling when a caller opts into both guards: a pathological day where every
 * run rides the per-run cap costs KEYWORD_DAILY_RUN_MAX x $0.25, not $5. The
 * count is a budget only as long as the p50 holds; it is a run cap always.
 */
export const KEYWORD_DAILY_BUDGET_USD = 5;

/**
 * The daily budget expressed as a run count.
 *
 * Deliberately a count and not a dollar ledger. The durable store we already
 * operate (`consume_public_tool_quota`) counts hits inside a window, and a
 * dollar-accurate breaker would need a new table, a migration and a second
 * failure mode to reason about. A count of runs is the same control to within
 * the accuracy of the per-run estimate, and the per-run cap above is what keeps
 * that estimate from drifting far.
 */
export const KEYWORD_DAILY_RUN_MAX = Math.floor(
  KEYWORD_DAILY_BUDGET_USD / KEYWORD_RUN_P50_COST_USD,
);

/**
 * Window length handed to the quota RPC.
 *
 * The bucket key already carries the UTC date, so the window is a row lifetime
 * rather than the thing that defines "a day". Without the date in the key the
 * window would instead roll from whenever the first run of a quiet period
 * landed, which makes "today's budget" mean a different 24 hours every week.
 */
export const KEYWORD_DAILY_WINDOW_SECONDS = 24 * 60 * 60;

/** Cents are the smallest unit that is ever billed; six places is well past it. */
function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function emptyTotals(): Readonly<Record<KeywordCostEndpoint, number>> {
  return {
    keyword_overview: 0,
    serp_organic: 0,
    bulk_ranks: 0,
    bulk_traffic: 0,
  };
}

export interface KeywordCostAccumulator {
  /**
   * Book one provider response against its endpoint.
   *
   * A cost that is not a finite, non-negative number is refused rather than
   * added, because a single NaN in the total would silently switch the cap off
   * — every comparison against NaN is false, so `wouldExceed` would answer
   * "no" forever. Refused calls are counted and surfaced in the report so the
   * gap between "cheap run" and "unpriced run" stays visible.
   */
  readonly record: (endpoint: KeywordCostEndpoint, costUsd: number) => void;
  /** Total booked so far, rounded for display and comparison in logs. */
  readonly spent: () => number;
  readonly byEndpoint: () => Readonly<Record<KeywordCostEndpoint, number>>;
  /** Responses whose `cost` field could not be read. */
  readonly unpricedCalls: () => number;
  /**
   * Would spending `nextCostUsd` more cross the per-run ceiling?
   *
   * A question, never an exception. The caller is an orchestrator that can
   * answer "then skip this stage and report the run as partial", and a throw
   * from inside the cost layer would take the already-paid-for earlier stages
   * down with it — the worst possible outcome, since that work is billed
   * whether or not anyone sees it.
   */
  readonly wouldExceed: (nextCostUsd: number) => boolean;
  /**
   * `wouldExceed` plus the bookkeeping, for the common call site.
   *
   * Returns false and records the stage as cut when the estimate does not fit,
   * so the cap can never fire without the report saying so.
   */
  readonly admitStage: (stage: string, estimatedCostUsd: number) => boolean;
  readonly capped: () => boolean;
  /** Stage names the ceiling cut, in the order they were refused. */
  readonly cappedStages: () => readonly string[];
}

export function createKeywordCostAccumulator(
  maxCostUsd: number = KEYWORD_MAX_PROVIDER_COST_USD,
): KeywordCostAccumulator {
  // Replaced, never mutated: every update builds a fresh record so a caller
  // holding an earlier `byEndpoint()` snapshot keeps reading what it saw.
  let totals: Readonly<Record<KeywordCostEndpoint, number>> = emptyTotals();
  let unpriced = 0;
  let cut: readonly string[] = [];

  const rawTotal = (): number =>
    KEYWORD_COST_ENDPOINTS.reduce((sum, endpoint) => sum + totals[endpoint], 0);

  const wouldExceed = (nextCostUsd: number): boolean => {
    // An unusable estimate is treated as "does not fit". Guessing zero would
    // let an unpriced stage walk straight through the ceiling.
    if (!Number.isFinite(nextCostUsd) || nextCostUsd < 0) return true;
    return rawTotal() + nextCostUsd > maxCostUsd;
  };

  return {
    record(endpoint, costUsd) {
      if (!Number.isFinite(costUsd) || costUsd < 0) {
        unpriced += 1;
        return;
      }
      totals = { ...totals, [endpoint]: totals[endpoint] + costUsd };
    },
    spent: () => roundUsd(rawTotal()),
    byEndpoint: () => totals,
    unpricedCalls: () => unpriced,
    wouldExceed,
    admitStage(stage, estimatedCostUsd) {
      if (!wouldExceed(estimatedCostUsd)) return true;
      cut = [...cut, stage];
      return false;
    },
    capped: () => cut.length > 0,
    cappedStages: () => cut,
  };
}

/**
 * Fitted prices, not list prices.
 *
 * Every formula below is a regression over the `cost` field of real responses
 * from the 2026-08-10 spike; DataForSEO's published rate card does not predict
 * these totals. They exist so a stage can be priced BEFORE it is requested,
 * which is the only moment the per-run ceiling can still prevent a charge.
 * They drift when the provider reprices — the accumulator always books the
 * real returned cost, so drift shows up as an estimate that was wrong, never
 * as a total that was wrong.
 */
export function estimateKeywordOverviewCostUsd(rowCount: number): number {
  // Billed per RETURNED row, not per requested keyword. The spike asked for
  // 1,522 terms and was billed for 382, because terms the provider holds no
  // data for come back as silence and cost nothing.
  return roundUsd(0.01205 + 0.00012 * Math.max(0, rowCount));
}

export function estimateSerpSampleCostUsd(keywordCount: number): number {
  return roundUsd(0.002 * Math.max(0, keywordCount));
}

export function estimateBulkRanksCostUsd(targetCount: number): number {
  return roundUsd(0.024 + 0.0000323 * Math.max(0, targetCount));
}

export type KeywordBudgetOutcome =
  | { readonly kind: "allowed"; readonly runsToday: number }
  /** Today's run budget is spent. Nothing billable may start. */
  | { readonly kind: "exhausted"; readonly retryAfterSeconds: number }
  /**
   * The counter could not answer. Treated exactly like exhausted: a paid
   * endpoint with no working limiter is an open tap on a prepaid balance
   * shared with the analysis pipeline, and a tool that is briefly unavailable
   * is the cheaper failure.
   */
  | { readonly kind: "unavailable"; readonly reason: string };

export interface KeywordBudgetDependencies {
  readonly quota: SharedQuotaDependencies;
  /** Offline test seam. Fixes both the bucket's date and the retry hint. */
  readonly now: () => number;
}

export const DEFAULT_KEYWORD_BUDGET_DEPENDENCIES: KeywordBudgetDependencies = {
  quota: DEFAULT_SHARED_QUOTA_DEPENDENCIES,
  now: Date.now,
};

/**
 * One bucket for the whole account, dated in UTC.
 *
 * Not keyed by IP or by user: this breaker protects the shared DataForSEO
 * balance, and per-caller fairness is already handled by the per-IP gates the
 * two stages open. A per-caller key here would mean N callers x N budgets,
 * which is not a budget.
 */
export function keywordDailyBudgetBucket(nowMs: number): string {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return `public-keyword:budget:${day}`;
}

/**
 * Claim one run against today's account budget.
 *
 * Must be consulted before candidate expansion, not after: the refusal path
 * has to be reachable while there is still nothing to leak. Guardrail 2 of the
 * cost model is that a budget-refused run emits no unvalidated candidates, and
 * the only robust way to honour that is to never have produced any.
 */
export async function consumeKeywordDailyBudget(
  dependencies: KeywordBudgetDependencies = DEFAULT_KEYWORD_BUDGET_DEPENDENCIES,
): Promise<KeywordBudgetOutcome> {
  const outcome = await consumePublicToolQuota(
    keywordDailyBudgetBucket(dependencies.now()),
    KEYWORD_DAILY_RUN_MAX,
    KEYWORD_DAILY_WINDOW_SECONDS,
    dependencies.quota,
    dependencies.now,
  );

  if (outcome.kind === "unavailable") {
    // Logged HERE rather than at the call site, because the one time this was
    // left to callers the reason was captured and dropped, and "the tool is
    // down" took days to trace back to a misconfigured URL. The message is
    // server-side only; the visitor still gets a bare code.
    console.error(
      "[keyword-cost-guard] budget store unavailable:",
      outcome.reason,
    );
    return { kind: "unavailable", reason: outcome.reason };
  }
  if (outcome.kind === "limited") {
    // A tripped breaker is an operational event, not a visitor error: someone
    // has to know the day's budget went before deciding whether it was abuse
    // or demand.
    console.warn(
      `[keyword-cost-guard] daily run budget exhausted at ${KEYWORD_DAILY_RUN_MAX} runs`,
    );
    return { kind: "exhausted", retryAfterSeconds: outcome.retryAfterSeconds };
  }
  return { kind: "allowed", runsToday: outcome.hits };
}

/**
 * The response a refused run must return, or null when the run may proceed.
 *
 * Both refusals are 503 `keyword_source_unavailable`. Exhausted and
 * unavailable are different causes but the same true statement to the visitor:
 * the priced source cannot be reached for this run, and retrying later is the
 * only useful action. The body carries an error envelope and nothing else —
 * no partial payload, no candidate list — because candidates that never
 * reached the provider have not been validated, and shipping them would turn a
 * cost control into a quality regression.
 */
export function keywordBudgetRefusal(
  outcome: KeywordBudgetOutcome,
): Response | null {
  if (outcome.kind === "allowed") return null;
  const retryAfter =
    outcome.kind === "exhausted" ? outcome.retryAfterSeconds : 60;
  return Response.json(createPublicToolError("keyword_source_unavailable"), {
    status: 503,
    headers: {
      "Cache-Control": "no-store, private",
      "Retry-After": String(retryAfter),
    },
  });
}

export interface KeywordCostReport {
  readonly tool: "keyword_opportunity";
  readonly runCostUsd: number;
  readonly byEndpoint: Readonly<Record<KeywordCostEndpoint, number>>;
  readonly candidateCount: number;
  readonly serpSampled: number;
  /** True when the per-run ceiling cut a stage. */
  readonly capped: boolean;
  readonly cappedStages: readonly string[];
  readonly unpricedCalls: number;
  /**
   * What the run spent on the model, in requests rather than dollars.
   *
   * The provider bills tokens on an account we do not itemise per tool, so a
   * dollar figure here would be invented. Counts are not: `retryCount` is the
   * number of replies this run threw away and paid for, and it is the only
   * signal that says whether the model is answering reliably today. It read
   * zero on every run until 2026-08-11 because nothing was wired to `onUsage`.
   */
  readonly llm: KeywordLlmUsage;
}

export interface KeywordCostReportInput {
  readonly costs: KeywordCostAccumulator;
  readonly candidateCount: number;
  readonly serpSampled: number;
  /** Absent only in tests that predate the model being counted. */
  readonly llm?: KeywordLlmUsage;
}

/**
 * The run's only cost record.
 *
 * Nothing else writes spend anywhere — there is no ledger table and no
 * provider-side per-tool breakdown, so if this line is missing the run is
 * invisible in the invoice. `capped` is part of it for the same reason the
 * report exists at all: a run that came in under budget because a stage was
 * cut looks identical in the totals to a genuinely cheap run, and the two
 * demand opposite responses.
 */
export function reportKeywordRunCost(
  input: KeywordCostReportInput,
  emit: (line: string) => void = console.info,
): KeywordCostReport {
  const report: KeywordCostReport = {
    tool: "keyword_opportunity",
    runCostUsd: input.costs.spent(),
    byEndpoint: input.costs.byEndpoint(),
    candidateCount: input.candidateCount,
    serpSampled: input.serpSampled,
    capped: input.costs.capped(),
    cappedStages: input.costs.cappedStages(),
    unpricedCalls: input.costs.unpricedCalls(),
    llm: input.llm ?? EMPTY_KEYWORD_LLM_USAGE,
  };
  emit(JSON.stringify(report));
  return report;
}
