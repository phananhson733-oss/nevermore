// @input  -- per-call provider cost, the shared Supabase quota, and a clock
// @output -- a per-run cost ceiling, an account-level daily breaker, one cost log line
// @pos    -- the only place DataForSEO spend on the GEO Agent is counted and bounded

import {
  consumePublicToolQuota,
  DEFAULT_SHARED_QUOTA_DEPENDENCIES,
  type SharedQuotaDependencies,
} from "../tools/shared-rate-limit.ts";
import {
  GEO_QUESTIONS_PER_RUN,
  GEO_SAMPLES_PER_QUESTION,
} from "./geo-report-contract.ts";

/** Provider calls one full run issues: every question, sampled three times. */
export const GEO_CALLS_PER_RUN =
  GEO_QUESTIONS_PER_RUN * GEO_SAMPLES_PER_QUESTION;

/** Measured mean cost of one answer at the 4096-token ceiling (2026-08-17). */
export const GEO_CALL_P50_COST_USD = 0.0457;

/** Measured cost of one full run, at that mean. */
export const GEO_RUN_P50_COST_USD = GEO_CALL_P50_COST_USD * GEO_CALLS_PER_RUN;

/**
 * Hard ceiling on provider spend inside one run, in USD.
 *
 * 1.90 is about 1.7x the measured p50 of $1.10, deliberately tighter than the
 * 3x the keyword tool allows itself. The reason the keyword cap is loose is
 * that its call COUNT varies with how much data the provider holds; this run's
 * count is fixed at {@link GEO_CALLS_PER_RUN}, so the only variable is the
 * per-call price, measured across twelve calls at $0.035-$0.052. A worst case
 * of 24 x $0.052 is $1.25, and 1.90 leaves room for a provider price change
 * without leaving room for a runaway.
 *
 * Its precision has a floor set by concurrency. Reservations are the measured
 * mean, so if real prices land far above it one already-dispatched batch can
 * settle past the ceiling before the next call is refused; the overshoot is
 * bounded by the in-flight count rather than unbounded. This stops a runaway.
 * It is not an exact spending limit, and nothing cheaper is, short of refusing
 * to issue calls concurrently at all.
 */
export const GEO_MAX_PROVIDER_COST_USD = 1.9;

/**
 * Account-level exposure one day may create, in USD.
 *
 * Higher than the keyword tool's $5 because one GEO run costs more than twelve
 * keyword runs; $5 here would be four runs a day, which is a broken tool rather
 * than a budget. $15 bounds the blast radius of a bad day while leaving
 * {@link GEO_DAILY_RUN_MAX} runs, comfortably above plausible early demand on a
 * tool that requires a signed-in account.
 */
export const GEO_DAILY_BUDGET_USD = 15;

/**
 * The daily budget expressed as a run count.
 *
 * A count, not a dollar ledger, for the same reason the keyword tool uses one:
 * the durable store already counts hits inside a window, and a dollar-accurate
 * breaker would need its own table and its own failure mode. The per-run cap
 * above is what keeps the per-run estimate from drifting far enough to matter.
 */
export const GEO_DAILY_RUN_MAX = Math.floor(
  GEO_DAILY_BUDGET_USD / GEO_RUN_P50_COST_USD,
);

/** Window handed to the quota RPC; the bucket key already carries the date. */
export const GEO_DAILY_WINDOW_SECONDS = 24 * 60 * 60;

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export interface GeoCostAccumulator {
  /**
   * Reserve budget for one call, or refuse it.
   *
   * Reserved rather than merely checked because the calls run concurrently: a
   * guard that only compared settled spend would let all
   * {@link GEO_MAX_CONCURRENCY_HINT} in-flight calls pass while the total still
   * read zero, and the ceiling would bind a whole batch late instead of at the
   * call it should have stopped. The reservation is the measured mean; the
   * settlement below replaces it with what was actually billed.
   */
  readonly admit: () => boolean;
  /**
   * Settle one reservation with the real price.
   *
   * A cost that is not a finite, non-negative number releases the reservation
   * and is counted as unpriced rather than added: one NaN in the total would
   * silently switch the ceiling off, because every comparison against NaN is
   * false and `admit` would answer "yes" forever.
   */
  readonly settle: (costUsd: number | null) => void;
  readonly spent: () => number;
  readonly unpricedCalls: () => number;
  readonly capped: () => boolean;
}

/** Mirrors the collector's concurrency; kept here only for the doc above. */
export const GEO_MAX_CONCURRENCY_HINT = 8;

export function createGeoCostAccumulator(): GeoCostAccumulator {
  let settled = 0;
  let reserved = 0;
  let unpriced = 0;
  let capped = false;

  return {
    admit: () => {
      if (
        settled + reserved + GEO_CALL_P50_COST_USD >
        GEO_MAX_PROVIDER_COST_USD
      ) {
        capped = true;
        return false;
      }
      reserved += GEO_CALL_P50_COST_USD;
      return true;
    },
    settle: (costUsd) => {
      reserved = Math.max(0, reserved - GEO_CALL_P50_COST_USD);
      if (
        costUsd === null ||
        typeof costUsd !== "number" ||
        !Number.isFinite(costUsd) ||
        costUsd < 0
      ) {
        unpriced += 1;
        return;
      }
      settled += costUsd;
    },
    spent: () => roundUsd(settled),
    unpricedCalls: () => unpriced,
    capped: () => capped,
  };
}

/**
 * One bucket for the whole account, dated in UTC.
 *
 * Not keyed by user: this breaker protects the shared DataForSEO balance, and
 * per-visitor fairness is already the account gate's job. A per-user key would
 * mean N users x N budgets, which is not a budget.
 */
export function geoDailyBudgetBucket(nowMs: number): string {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return `agent-geo:budget:${day}`;
}

export type GeoBudgetOutcome =
  | { readonly kind: "allowed"; readonly runsToday: number }
  | { readonly kind: "exhausted"; readonly retryAfterSeconds: number }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface GeoBudgetDependencies {
  readonly quota: SharedQuotaDependencies;
  readonly now: () => number;
}

export const DEFAULT_GEO_BUDGET_DEPENDENCIES: GeoBudgetDependencies = {
  quota: DEFAULT_SHARED_QUOTA_DEPENDENCIES,
  now: Date.now,
};

/**
 * Claim one run against today's account budget.
 *
 * Consulted before the first paid call, so a refused run has spent nothing.
 */
export async function consumeGeoDailyBudget(
  dependencies: GeoBudgetDependencies = DEFAULT_GEO_BUDGET_DEPENDENCIES,
): Promise<GeoBudgetOutcome> {
  const outcome = await consumePublicToolQuota(
    geoDailyBudgetBucket(dependencies.now()),
    GEO_DAILY_RUN_MAX,
    GEO_DAILY_WINDOW_SECONDS,
    dependencies.quota,
    dependencies.now,
  );

  if (outcome.kind === "unavailable") {
    // Logged here rather than at the call site: the visitor gets a bare code,
    // and an operator still needs to know which dependency went down.
    console.error("[geo-cost-guard] budget store unavailable:", outcome.reason);
    return { kind: "unavailable", reason: outcome.reason };
  }
  if (outcome.kind === "limited") {
    console.warn(
      `[geo-cost-guard] daily run budget exhausted at ${GEO_DAILY_RUN_MAX} runs`,
    );
    return { kind: "exhausted", retryAfterSeconds: outcome.retryAfterSeconds };
  }
  return { kind: "allowed", runsToday: outcome.hits };
}
