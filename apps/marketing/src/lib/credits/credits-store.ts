// @input  -- a Supabase user id, plus the service-role client for the credits tables
// @output -- account snapshots, daily grants, referral verdicts and ledger pages
// @pos    -- the only module that reads or writes the credits tables

import { createAdminSupabaseClient } from "../supabase/admin.ts";

/**
 * Three outcomes, not two.
 *
 * "missing" means the ledger answered and the account is not there — a real
 * state for a visitor who has never loaded the badge. "unavailable" means the
 * ledger could not answer at all: unconfigured, unreachable, or the owner has
 * not applied the migration yet. Collapsing them would make a first visit look
 * like an outage, and an outage look like a new user with no credits.
 */
export type CreditsResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "missing" }
  | { readonly kind: "unavailable"; readonly reason: string };

export type RpcOutcome =
  | { readonly kind: "ok"; readonly data: unknown }
  | {
      readonly kind: "error";
      readonly code: string | null;
      readonly message: string;
    };

export interface LedgerCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface CreditsStoreDependencies {
  readonly callRpc: (
    name: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<RpcOutcome>;
  readonly selectLedger: (input: {
    readonly userId: string;
    readonly limit: number;
    readonly cursor: LedgerCursor | null;
  }) => Promise<RpcOutcome>;
}

export interface CreditAccountSnapshot {
  readonly userId: string;
  readonly status: "active" | "frozen";
  readonly dailyBalance: number;
  readonly permanentBalance: number;
  readonly totalBalance: number;
  readonly dailyGrantedOn: string | null;
  readonly dailyAccruedTotal: number;
  readonly referralCode: string;
  readonly referredBy: string | null;
  readonly referralRewardedCount: number;
  readonly firstToolRunAt: string | null;
  readonly created: boolean;
  /** True only when THIS call attached the referrer, not merely that one exists. */
  readonly attributed: boolean;
}

export interface DailyTouch {
  readonly mode: string;
  readonly granted: number;
  readonly dailyBalance: number;
  readonly permanentBalance: number;
  readonly totalBalance: number;
  readonly dailyAccruedTotal: number;
  readonly dailyAmount: number;
  readonly welfareAccrualCap: number;
  readonly welfareRemaining: number;
  readonly dailyGrantedOn: string | null;
  /** Read from credit_settings, so the page cannot advertise a stale cap. */
  readonly referralInviterCap: number;
}

export interface ReferralVerdict {
  readonly rewarded: boolean;
  readonly reason: string;
}

export interface LedgerEntry {
  readonly id: string;
  readonly type: string;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly toolSlug: string | null;
  readonly createdAt: string;
}

export interface LedgerPage {
  readonly entries: readonly LedgerEntry[];
  readonly nextCursor: string | null;
}

/**
 * PostgREST reports an unapplied migration as PGRST205 (schema cache) or 42P01
 * (relation does not exist). Marketing migrations are applied by hand, so this
 * is a deployment state worth naming rather than an anonymous failure.
 */
const MISSING_STORE_CODES = new Set(["PGRST205", "42P01"]);

const LEDGER_COLUMNS =
  "id, entry_type, amount, balance_daily_after, balance_permanent_after, tool_slug, created_at";

/**
 * Built per call, never at module load.
 *
 * This module is reachable from five tool handlers through their default
 * dependencies. A client constructed at import time throws on a half-configured
 * environment and takes every one of those routes down with it.
 */
async function callRpcViaSupabase(
  name: string,
  params: Readonly<Record<string, unknown>>,
): Promise<RpcOutcome> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client.rpc(name, params);
  if (error) {
    return { kind: "error", code: error.code ?? null, message: error.message };
  }
  return { kind: "ok", data };
}

async function selectLedgerViaSupabase(input: {
  readonly userId: string;
  readonly limit: number;
  readonly cursor: LedgerCursor | null;
}): Promise<RpcOutcome> {
  const client = createAdminSupabaseClient();
  let query = client
    .from("credit_ledger")
    .select(LEDGER_COLUMNS)
    .eq("user_id", input.userId);

  if (input.cursor !== null) {
    // Keyset paging on the (created_at desc, id desc) index. Ordering on
    // created_at alone repeats and drops rows whenever two entries share a
    // timestamp, which two grants in one transaction always do.
    query = query.or(
      `created_at.lt.${input.cursor.createdAt},and(created_at.eq.${input.cursor.createdAt},id.lt.${input.cursor.id})`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.limit);

  if (error) {
    return { kind: "error", code: error.code ?? null, message: error.message };
  }
  return { kind: "ok", data };
}

export const DEFAULT_CREDITS_STORE_DEPENDENCIES: CreditsStoreDependencies = {
  callRpc: callRpcViaSupabase,
  selectLedger: selectLedgerViaSupabase,
};

function unavailable(reason: string): CreditsResult<never> {
  console.error("[credits-store] unavailable:", reason);
  return { kind: "unavailable", reason };
}

function failureReason(outcome: {
  readonly code: string | null;
  readonly message: string;
}): string {
  return outcome.code !== null && MISSING_STORE_CODES.has(outcome.code)
    ? "store_missing"
    : outcome.message;
}

function rowsOf(data: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(data)) return data as readonly Record<string, unknown>[];
  if (data !== null && typeof data === "object") {
    return [data as Record<string, unknown>];
  }
  return [];
}

/** Runs a call and narrows it to rows, keeping every failure mode internal. */
async function rows(
  run: () => Promise<RpcOutcome>,
): Promise<CreditsResult<readonly Record<string, unknown>[]>> {
  try {
    const outcome = await run();
    if (outcome.kind === "error") return unavailable(failureReason(outcome));
    return { kind: "ok", value: rowsOf(outcome.data) };
  } catch (error) {
    return unavailable(
      error instanceof Error ? error.message : "credits store failed",
    );
  }
}

/** Maps a row, turning a malformed one into the same fail-closed outcome. */
function mapped<T>(
  row: Record<string, unknown>,
  map: (row: Record<string, unknown>) => T,
): CreditsResult<T> {
  try {
    return { kind: "ok", value: map(row) };
  } catch (error) {
    if (error instanceof MalformedRowError) {
      return unavailable(`malformed credits row: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Thrown when a row is missing a number the caller is about to treat as money.
 *
 * The repository rule is that an unavailable figure is null, never zero. A
 * schema-cache mismatch or a changed return type must not be able to render a
 * funded account as an empty one, so a malformed row fails the whole read
 * instead of being smoothed into a plausible lie.
 */
class MalformedRowError extends Error {}

function int(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MalformedRowError(`${key} is not a number`);
  }
  return value;
}

function str(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new MalformedRowError(`${key} is not a string`);
  }
  return value;
}

function nullableStr(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function readStatus(row: Record<string, unknown>): "active" | "frozen" {
  if (row.status === "active" || row.status === "frozen") return row.status;
  throw new MalformedRowError("status is not a known value");
}

function toSnapshot(row: Record<string, unknown>): CreditAccountSnapshot {
  const daily = int(row, "daily_balance");
  const permanent = int(row, "permanent_balance");
  return {
    userId: str(row, "user_id"),
    // A status this build does not recognise is not "active"; treating it as
    // active is how a frozen-for-fraud account would keep earning.
    status: readStatus(row),
    dailyBalance: daily,
    permanentBalance: permanent,
    totalBalance: daily + permanent,
    dailyGrantedOn: nullableStr(row, "daily_granted_on"),
    dailyAccruedTotal: int(row, "daily_accrued_total"),
    referralCode: str(row, "referral_code"),
    referredBy: nullableStr(row, "referred_by"),
    referralRewardedCount: int(row, "referral_rewarded_count"),
    firstToolRunAt: nullableStr(row, "first_tool_run_at"),
    created: row.created === true,
    attributed: row.attributed === true,
  };
}

export async function ensureAccount(
  userId: string,
  referralCode: string | null,
  dependencies: CreditsStoreDependencies = DEFAULT_CREDITS_STORE_DEPENDENCIES,
): Promise<CreditsResult<CreditAccountSnapshot>> {
  const result = await rows(() =>
    dependencies.callRpc("credits_ensure_account", {
      p_user_id: userId,
      p_referral_code: referralCode,
    }),
  );
  if (result.kind !== "ok") return result;

  const row = result.value[0];
  // This function creates the account, so an empty answer is not "no account",
  // it is the store contradicting itself.
  if (row === undefined) return unavailable("credits_ensure_account returned no row");
  return mapped(row, toSnapshot);
}

export async function touchDaily(
  userId: string,
  dependencies: CreditsStoreDependencies = DEFAULT_CREDITS_STORE_DEPENDENCIES,
): Promise<CreditsResult<DailyTouch>> {
  const result = await rows(() =>
    dependencies.callRpc("credits_touch_daily", { p_user_id: userId }),
  );
  if (result.kind !== "ok") return result;

  const row = result.value[0];
  if (row === undefined) return { kind: "missing" };

  return mapped(row, (source) => {
    const daily = int(source, "daily_balance");
    const permanent = int(source, "permanent_balance");
    const cap = int(source, "welfare_accrual_cap");
    const accrued = int(source, "daily_accrued_total");
    return {
      mode: str(source, "mode"),
      granted: int(source, "granted"),
      dailyBalance: daily,
      permanentBalance: permanent,
      totalBalance: daily + permanent,
      dailyAccruedTotal: accrued,
      dailyAmount: int(source, "daily_amount"),
      welfareAccrualCap: cap,
      welfareRemaining: Math.max(cap - accrued, 0),
      dailyGrantedOn: nullableStr(source, "daily_granted_on"),
      referralInviterCap: int(source, "referral_inviter_cap"),
    };
  });
}

export async function rewardReferral(
  userId: string,
  toolSlug: string,
  dependencies: CreditsStoreDependencies = DEFAULT_CREDITS_STORE_DEPENDENCIES,
): Promise<CreditsResult<ReferralVerdict>> {
  const result = await rows(() =>
    dependencies.callRpc("credits_reward_referral", {
      p_invitee_id: userId,
      p_tool_slug: toolSlug,
    }),
  );
  if (result.kind !== "ok") return result;

  const row = result.value[0];
  if (row === undefined) return { kind: "missing" };
  return {
    kind: "ok",
    value: { rewarded: row.rewarded === true, reason: str(row, "reason") },
  };
}

export async function readLedger(
  userId: string,
  page: { readonly limit: number; readonly cursor: LedgerCursor | null },
  dependencies: CreditsStoreDependencies = DEFAULT_CREDITS_STORE_DEPENDENCIES,
): Promise<CreditsResult<LedgerPage>> {
  // One row past the page is how the caller learns there is a next page
  // without a second count query.
  const result = await rows(() =>
    dependencies.selectLedger({
      userId,
      limit: page.limit + 1,
      cursor: page.cursor,
    }),
  );
  if (result.kind !== "ok") return result;

  const kept = result.value.slice(0, page.limit);
  const page_ = mapped({}, () => ({
    entries: kept.map((row) => ({
      id: String(row.id ?? ""),
      type: str(row, "entry_type"),
      amount: int(row, "amount"),
      // One number, because the split into pools is an implementation detail of
      // expiry, not something a reader of their own history should have to model.
      balanceAfter:
        int(row, "balance_daily_after") + int(row, "balance_permanent_after"),
      toolSlug: nullableStr(row, "tool_slug"),
      createdAt: str(row, "created_at"),
    })),
  }));
  if (page_.kind !== "ok") return page_;

  const entries = page_.value.entries;
  const last = entries[entries.length - 1];
  const hasMore = result.value.length > page.limit;
  return {
    kind: "ok",
    value: {
      entries,
      nextCursor:
        hasMore && last !== undefined ? `${last.createdAt}|${last.id}` : null,
    },
  };
}

/**
 * Split on the LAST separator: an ISO timestamp never contains one, but a
 * malformed cursor might, and guessing wrong would silently reset paging.
 */
export function decodeLedgerCursor(value: string | null): LedgerCursor | null {
  if (value === null || value === "") return null;
  const separator = value.lastIndexOf("|");
  if (separator <= 0 || separator === value.length - 1) return null;
  const createdAt = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!/^\d+$/.test(id) || !Number.isFinite(Date.parse(createdAt))) return null;
  return { createdAt, id };
}
