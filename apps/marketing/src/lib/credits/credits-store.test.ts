// @input  -- fake RPC outcomes standing in for the marketing Supabase project
// @output -- assertions on the store's three-way result and its fail-closed edges
// @pos    -- guards the only module that talks to the credits tables

import { describe, expect, it, vi } from "vitest";

import {
  ensureAccount,
  readLedger,
  rewardReferral,
  touchDaily,
  type CreditsStoreDependencies,
} from "./credits-store.ts";

const USER = "11111111-1111-4111-8111-111111111111";

const ACCOUNT_ROW = {
  user_id: USER,
  status: "active",
  daily_balance: 0,
  permanent_balance: 120,
  daily_granted_on: "2026-08-17",
  daily_accrued_total: 20,
  referral_code: "ab3kd9xz",
  referred_by: null,
  referral_rewarded_count: 0,
  first_tool_run_at: null,
  created: false,
  attributed: false,
};

function deps(
  overrides: Partial<CreditsStoreDependencies> = {},
): CreditsStoreDependencies {
  return {
    callRpc: vi.fn(async () => ({ kind: "ok" as const, data: [ACCOUNT_ROW] })),
    selectLedger: vi.fn(async () => ({ kind: "ok" as const, data: [] })),
    ...overrides,
  };
}

describe("ensureAccount", () => {
  it("maps the row into camelCase and totals the two pools", async () => {
    const result = await ensureAccount(USER, "ab3kd9xz", deps());

    expect(result).toEqual({
      kind: "ok",
      value: {
        userId: USER,
        status: "active",
        dailyBalance: 0,
        permanentBalance: 120,
        totalBalance: 120,
        dailyGrantedOn: "2026-08-17",
        dailyAccruedTotal: 20,
        referralCode: "ab3kd9xz",
        referredBy: null,
        referralRewardedCount: 0,
        firstToolRunAt: null,
        created: false,
        attributed: false,
      },
    });
  });

  it("passes the referral code through, and null when there is none", async () => {
    const callRpc = vi.fn(async () => ({
      kind: "ok" as const,
      data: [ACCOUNT_ROW],
    }));
    await ensureAccount(USER, null, deps({ callRpc }));
    expect(callRpc).toHaveBeenCalledWith("credits_ensure_account", {
      p_user_id: USER,
      p_referral_code: null,
    });
  });

  /** PostgREST returns a `returns table` function as an array of rows. */
  it("unwraps a single row delivered as a bare object", async () => {
    const result = await ensureAccount(
      USER,
      null,
      deps({
        callRpc: async () => ({ kind: "ok" as const, data: ACCOUNT_ROW }),
      }),
    );
    expect(result).toMatchObject({ kind: "ok" });
  });

  it("treats an empty result as unavailable, not as an account", async () => {
    const result = await ensureAccount(
      USER,
      null,
      deps({ callRpc: async () => ({ kind: "ok" as const, data: [] }) }),
    );
    expect(result.kind).toBe("unavailable");
  });
});

describe("failure handling", () => {
  /**
   * The owner applies marketing migrations by hand, so "the table is not there
   * yet" is a normal deployment state rather than an incident. It still fails
   * closed; it just says so in the log with a stable reason.
   */
  it.each(["PGRST205", "42P01"])(
    "reports %s as a missing store",
    async (code) => {
      const result = await ensureAccount(
        USER,
        null,
        deps({
          callRpc: async () => ({
            kind: "error" as const,
            code,
            message: "relation does not exist",
          }),
        }),
      );
      expect(result).toEqual({ kind: "unavailable", reason: "store_missing" });
    },
  );

  it("keeps any other database message internal but preserved", async () => {
    const result = await touchDaily(
      USER,
      deps({
        callRpc: async () => ({
          kind: "error" as const,
          code: "57014",
          message: "statement timeout",
        }),
      }),
    );
    expect(result).toEqual({ kind: "unavailable", reason: "statement timeout" });
  });

  /**
   * A funded account must never be renderable as an empty one. A schema-cache
   * mismatch or a changed RPC return type is an outage, not a zero balance, and
   * this repository's rule is that an unavailable figure is null and never 0.
   */
  it("refuses a row whose balance is missing rather than calling it zero", async () => {
    const { permanent_balance: _dropped, ...withoutBalance } = ACCOUNT_ROW;
    const result = await ensureAccount(
      USER,
      null,
      deps({
        callRpc: async () => ({ kind: "ok" as const, data: [withoutBalance] }),
      }),
    );
    expect(result.kind).toBe("unavailable");
  });

  it("refuses a status this build does not know, rather than assuming active", async () => {
    const result = await ensureAccount(
      USER,
      null,
      deps({
        callRpc: async () => ({
          kind: "ok" as const,
          data: [{ ...ACCOUNT_ROW, status: "suspended_pending_review" }],
        }),
      }),
    );
    expect(result.kind).toBe("unavailable");
  });

  /**
   * createAdminSupabaseClient throws when the environment is half-configured.
   * This module is reachable from five tool handlers, so a throw here would
   * turn a successful audit into a 500.
   */
  it("swallows a throwing client factory", async () => {
    const result = await ensureAccount(
      USER,
      null,
      deps({
        callRpc: async () => {
          throw new Error("Supabase admin credentials are missing");
        },
      }),
    );
    expect(result.kind).toBe("unavailable");
  });
});

describe("touchDaily", () => {
  const TOUCH_ROW = {
    mode: "welfare",
    granted: 20,
    daily_balance: 0,
    permanent_balance: 120,
    daily_accrued_total: 20,
    daily_amount: 20,
    welfare_accrual_cap: 600,
    daily_granted_on: "2026-08-17",
    referral_inviter_cap: 20,
  };

  it("maps the grant outcome", async () => {
    const result = await touchDaily(
      USER,
      deps({
        callRpc: async () => ({ kind: "ok" as const, data: [TOUCH_ROW] }),
      }),
    );
    expect(result).toEqual({
      kind: "ok",
      value: {
        mode: "welfare",
        granted: 20,
        dailyBalance: 0,
        permanentBalance: 120,
        totalBalance: 120,
        dailyAccruedTotal: 20,
        dailyAmount: 20,
        welfareAccrualCap: 600,
        welfareRemaining: 580,
        dailyGrantedOn: "2026-08-17",
        referralInviterCap: 20,
      },
    });
  });

  /** Zero rows is the function's way of saying the account does not exist. */
  it("reports an absent account as missing, not unavailable", async () => {
    const result = await touchDaily(
      USER,
      deps({ callRpc: async () => ({ kind: "ok" as const, data: [] }) }),
    );
    expect(result).toEqual({ kind: "missing" });
  });
});

describe("rewardReferral", () => {
  it("passes the tool slug and returns the verdict verbatim", async () => {
    const callRpc = vi.fn(async () => ({
      kind: "ok" as const,
      data: [{ rewarded: true, reason: "rewarded_both" }],
    }));
    const result = await rewardReferral(USER, "quick-wins", deps({ callRpc }));

    expect(callRpc).toHaveBeenCalledWith("credits_reward_referral", {
      p_invitee_id: USER,
      p_tool_slug: "quick-wins",
    });
    expect(result).toEqual({
      kind: "ok",
      value: { rewarded: true, reason: "rewarded_both" },
    });
  });
});

describe("readLedger", () => {
  const entry = (id: string, createdAt: string) => ({
    id,
    entry_type: "daily_grant",
    amount: 20,
    balance_daily_after: 0,
    balance_permanent_after: 120,
    tool_slug: null,
    created_at: createdAt,
  });

  it("asks for one row beyond the page so it can tell there is more", async () => {
    const selectLedger = vi.fn(async () => ({
      kind: "ok" as const,
      data: [],
    }));
    await readLedger(USER, { limit: 2, cursor: null }, deps({ selectLedger }));
    expect(selectLedger).toHaveBeenCalledWith({
      userId: USER,
      limit: 3,
      cursor: null,
    });
  });

  it("returns a cursor built from the last row it keeps", async () => {
    const rows = [
      entry("12", "2026-08-17T00:00:03.000Z"),
      entry("11", "2026-08-17T00:00:02.000Z"),
      entry("10", "2026-08-17T00:00:01.000Z"),
    ];
    const result = await readLedger(
      USER,
      { limit: 2, cursor: null },
      deps({ selectLedger: async () => ({ kind: "ok" as const, data: rows }) }),
    );

    expect(result).toMatchObject({ kind: "ok" });
    if (result.kind !== "ok") return;
    expect(result.value.entries).toHaveLength(2);
    expect(result.value.entries[0]).toEqual({
      id: "12",
      type: "daily_grant",
      amount: 20,
      balanceAfter: 120,
      toolSlug: null,
      createdAt: "2026-08-17T00:00:03.000Z",
    });
    expect(result.value.nextCursor).toBe("2026-08-17T00:00:02.000Z|11");
  });

  it("returns no cursor on the last page", async () => {
    const result = await readLedger(
      USER,
      { limit: 5, cursor: null },
      deps({
        selectLedger: async () => ({
          kind: "ok" as const,
          data: [entry("12", "2026-08-17T00:00:03.000Z")],
        }),
      }),
    );
    expect(result).toMatchObject({ kind: "ok" });
    if (result.kind !== "ok") return;
    expect(result.value.nextCursor).toBeNull();
  });

  it("forwards a decoded cursor to the query", async () => {
    const selectLedger = vi.fn(async () => ({ kind: "ok" as const, data: [] }));
    await readLedger(
      USER,
      { limit: 2, cursor: { createdAt: "2026-08-17T00:00:02.000Z", id: "11" } },
      deps({ selectLedger }),
    );
    expect(selectLedger).toHaveBeenCalledWith({
      userId: USER,
      limit: 3,
      cursor: { createdAt: "2026-08-17T00:00:02.000Z", id: "11" },
    });
  });
});
