// @input  -- a disposable Postgres with the marketing migrations applied
// @output -- proof that the grant functions are correct, including under concurrency
// @pos    -- the only test that executes marketing SQL

import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  connectFreshMarketingSchema,
  openConcurrentClient,
} from "./sql-test-harness.ts";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_C = "33333333-3333-4333-8333-333333333333";

let db: Client;

beforeAll(async () => {
  db = await connectFreshMarketingSchema();
});

afterAll(async () => {
  await db?.end();
});

beforeEach(async () => {
  // The append-only trigger blocks DELETE, so the reset has to lift it first.
  // Production never does this; only a test owns the whole database.
  await db.query(
    "alter table public.credit_ledger disable trigger credit_ledger_immutable_row",
  );
  await db.query("delete from public.credit_ledger");
  await db.query(
    "alter table public.credit_ledger enable trigger credit_ledger_immutable_row",
  );
  await db.query("delete from public.credit_accounts");
  await db.query("delete from public.credit_daily_counters");
  await db.query(`
    update public.credit_settings
       set mode = 'welfare', daily_amount = 20, welfare_accrual_cap = 600,
           referral_daily_cap = 200, signup_bonus = 100, referral_reward = 50,
           referral_inviter_cap = 20
     where id = 1`);
});

interface AccountRow {
  readonly created: boolean;
  readonly referral_code: string;
  readonly permanent_balance: number;
}

async function ensure(
  client: Client,
  userId: string,
  code?: string,
): Promise<AccountRow> {
  const { rows } = await client.query<AccountRow>(
    "select * from public.credits_ensure_account($1, $2)",
    [userId, code ?? null],
  );
  return rows[0] as AccountRow;
}

describe("credits_ensure_account", () => {
  it("creates the account and pays the signup bonus exactly once", async () => {
    const first = await ensure(db, USER_A);
    expect(first.created).toBe(true);
    expect(first.permanent_balance).toBe(100);
    expect(first.referral_code).toMatch(/^[a-z0-9]{8}$/);

    const second = await ensure(db, USER_A);
    expect(second.created).toBe(false);
    expect(second.permanent_balance).toBe(100);

    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.credit_ledger where entry_type = 'signup_bonus'",
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("pays once when two requests create the same account at the same moment", async () => {
    const other = await openConcurrentClient();
    try {
      await Promise.all([ensure(db, USER_A), ensure(other, USER_A)]);
    } finally {
      await other.end();
    }
    const { rows } = await db.query<{ permanent_balance: number }>(
      "select permanent_balance from public.credit_accounts where user_id = $1",
      [USER_A],
    );
    expect(rows[0]?.permanent_balance).toBe(100);
  });

  it("attributes a referral once and refuses to rebind it", async () => {
    const inviter = await ensure(db, USER_A);
    await ensure(db, USER_B, inviter.referral_code);
    const attributed = await db.query<{ referred_by: string | null }>(
      "select referred_by from public.credit_accounts where user_id = $1",
      [USER_B],
    );
    expect(attributed.rows[0]?.referred_by).toBe(USER_A);

    // A second, different link must not move the attribution.
    const other = await ensure(db, USER_C);
    await ensure(db, USER_B, other.referral_code);
    const after = await db.query<{ referred_by: string | null }>(
      "select referred_by from public.credit_accounts where user_id = $1",
      [USER_B],
    );
    expect(after.rows[0]?.referred_by).toBe(USER_A);
  });

  it("refuses self-referral", async () => {
    const account = await ensure(db, USER_A);
    await ensure(db, USER_A, account.referral_code);
    const { rows } = await db.query<{ referred_by: string | null }>(
      "select referred_by from public.credit_accounts where user_id = $1",
      [USER_A],
    );
    expect(rows[0]?.referred_by).toBeNull();
  });

  it("ignores an unknown referral code instead of failing the signup", async () => {
    const account = await ensure(db, USER_A, "zzzzzzzz");
    expect(account.created).toBe(true);
    const { rows } = await db.query<{ referred_by: string | null }>(
      "select referred_by from public.credit_accounts where user_id = $1",
      [USER_A],
    );
    expect(rows[0]?.referred_by).toBeNull();
  });
});

interface TouchRow {
  readonly mode: string;
  readonly granted: number;
  readonly daily_balance: number;
  readonly permanent_balance: number;
}

async function touch(
  client: Client,
  userId: string,
): Promise<TouchRow | undefined> {
  const { rows } = await client.query<TouchRow>(
    "select * from public.credits_touch_daily($1)",
    [userId],
  );
  return rows[0];
}

describe("credits_touch_daily", () => {
  it("grants once per day in welfare mode, into the permanent pool", async () => {
    await ensure(db, USER_A);
    const first = await touch(db, USER_A);
    expect(first?.granted).toBe(20);
    expect(first?.permanent_balance).toBe(120);
    expect(first?.daily_balance).toBe(0);

    const second = await touch(db, USER_A);
    expect(second?.granted).toBe(0);
    expect(second?.permanent_balance).toBe(120);
  });

  it("grants at most once when two badge polls arrive together", async () => {
    await ensure(db, USER_A);
    const other = await openConcurrentClient();
    try {
      await Promise.all([touch(db, USER_A), touch(other, USER_A)]);
    } finally {
      await other.end();
    }
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.credit_ledger where entry_type = 'daily_grant'",
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("stops granting at the welfare accrual cap", async () => {
    await ensure(db, USER_A);
    await db.query(
      "update public.credit_accounts set daily_accrued_total = 590 where user_id = $1",
      [USER_A],
    );
    expect((await touch(db, USER_A))?.granted).toBe(10);

    await db.query(
      "update public.credit_accounts set daily_granted_on = null where user_id = $1",
      [USER_A],
    );
    expect((await touch(db, USER_A))?.granted).toBe(0);
  });

  /**
   * Yesterday's leftover is staged directly rather than by granting twice: the
   * idempotency key carries the UTC date, so two grants inside one real day are
   * impossible by construction (which is the point of the key, and is asserted
   * separately below). Staging the leftover reproduces the day-rollover state
   * exactly as production reaches it.
   */
  it("expires and replaces the daily pool in live mode, recording both halves", async () => {
    await ensure(db, USER_A);
    await db.query(
      "update public.credit_settings set mode = 'live' where id = 1",
    );
    await db.query(
      `update public.credit_accounts
          set daily_balance = 7, daily_granted_on = current_date - 1
        where user_id = $1`,
      [USER_A],
    );

    expect((await touch(db, USER_A))?.daily_balance).toBe(20);

    const { rows } = await db.query<{ entry_type: string; amount: number }>(
      `select entry_type, amount from public.credit_ledger
        where entry_type in ('daily_expire', 'daily_grant') order by id`,
    );
    expect(rows.map((row) => `${row.entry_type}:${row.amount}`)).toEqual([
      "daily_expire:-7",
      "daily_grant:20",
    ]);
  });

  it("cannot grant twice in one UTC day even if daily_granted_on is corrupted", async () => {
    await ensure(db, USER_A);
    await touch(db, USER_A);
    await db.query(
      "update public.credit_accounts set daily_granted_on = null where user_id = $1",
      [USER_A],
    );
    // The date-stamped idempotency key is the backstop behind the row lock.
    await expect(touch(db, USER_A)).rejects.toThrow(/duplicate key/);
  });

  it("grants nothing to a frozen account", async () => {
    await ensure(db, USER_A);
    await db.query(
      "update public.credit_accounts set status = 'frozen' where user_id = $1",
      [USER_A],
    );
    expect((await touch(db, USER_A))?.granted).toBe(0);
  });

  it("returns no rows for an account that does not exist", async () => {
    const { rows } = await db.query(
      "select * from public.credits_touch_daily($1)",
      [USER_A],
    );
    expect(rows).toHaveLength(0);
  });
});

interface RewardRow {
  readonly rewarded: boolean;
  readonly reason: string;
}

async function reward(
  client: Client,
  userId: string,
  tool = "quick-wins",
): Promise<RewardRow | undefined> {
  const { rows } = await client.query<RewardRow>(
    "select * from public.credits_reward_referral($1, $2)",
    [userId, tool],
  );
  return rows[0];
}

describe("credits_reward_referral", () => {
  it("pays both sides once and never again", async () => {
    const inviter = await ensure(db, USER_A);
    await ensure(db, USER_B, inviter.referral_code);

    expect(await reward(db, USER_B)).toMatchObject({
      rewarded: true,
      reason: "rewarded_both",
    });
    expect(await reward(db, USER_B)).toMatchObject({
      rewarded: false,
      reason: "already_marked",
    });

    const { rows } = await db.query<{
      user_id: string;
      permanent_balance: number;
    }>(
      "select user_id, permanent_balance from public.credit_accounts order by user_id",
    );
    expect(rows).toEqual([
      { user_id: USER_A, permanent_balance: 150 },
      { user_id: USER_B, permanent_balance: 150 },
    ]);
  });

  it("stamps the run but pays nothing when there is no referrer", async () => {
    await ensure(db, USER_A);
    expect(await reward(db, USER_A, "agent-audit")).toMatchObject({
      rewarded: false,
      reason: "no_referrer",
    });
    const { rows } = await db.query<{
      first_tool_run_at: Date | null;
      permanent_balance: number;
    }>(
      "select first_tool_run_at, permanent_balance from public.credit_accounts where user_id = $1",
      [USER_A],
    );
    expect(rows[0]?.first_tool_run_at).not.toBeNull();
    expect(rows[0]?.permanent_balance).toBe(100);
  });

  /**
   * The reason the global claim happens before the stamp. If a busy day could
   * burn first_tool_run_at, a legitimate invitee would lose their reward
   * permanently and silently.
   */
  it("does NOT burn the first-run stamp when the global cap refuses", async () => {
    await db.query(
      "update public.credit_settings set referral_daily_cap = 0 where id = 1",
    );
    const inviter = await ensure(db, USER_A);
    await ensure(db, USER_B, inviter.referral_code);

    expect(await reward(db, USER_B)).toMatchObject({
      rewarded: false,
      reason: "global_cap",
    });
    const refused = await db.query<{ first_tool_run_at: Date | null }>(
      "select first_tool_run_at from public.credit_accounts where user_id = $1",
      [USER_B],
    );
    expect(refused.rows[0]?.first_tool_run_at).toBeNull();

    await db.query(
      "update public.credit_settings set referral_daily_cap = 200 where id = 1",
    );
    expect(await reward(db, USER_B)).toMatchObject({ rewarded: true });
  });

  it("pays the invitee even when the inviter is capped out", async () => {
    const inviter = await ensure(db, USER_A);
    await db.query(
      "update public.credit_settings set referral_inviter_cap = 0 where id = 1",
    );
    await ensure(db, USER_B, inviter.referral_code);

    expect(await reward(db, USER_B)).toMatchObject({
      rewarded: true,
      reason: "rewarded_invitee_only",
    });
    const { rows } = await db.query<{
      user_id: string;
      permanent_balance: number;
    }>(
      "select user_id, permanent_balance from public.credit_accounts order by user_id",
    );
    expect(rows).toEqual([
      { user_id: USER_A, permanent_balance: 100 },
      { user_id: USER_B, permanent_balance: 150 },
    ]);
  });

  it("never exceeds the inviter cap under concurrent qualification", async () => {
    const inviter = await ensure(db, USER_A);
    await db.query(
      "update public.credit_settings set referral_inviter_cap = 3 where id = 1",
    );

    const invitees = Array.from(
      { length: 8 },
      (_unused, index) =>
        `44444444-4444-4444-8444-4444444444${String(index).padStart(2, "0")}`,
    );
    for (const id of invitees) {
      await ensure(db, id, inviter.referral_code);
    }

    const clients = await Promise.all(
      invitees.map(() => openConcurrentClient()),
    );
    try {
      await Promise.all(
        clients.map((client, index) =>
          reward(client, invitees[index] as string, "agent-audit"),
        ),
      );
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }

    const { rows } = await db.query<{
      referral_rewarded_count: number;
      permanent_balance: number;
    }>(
      "select referral_rewarded_count, permanent_balance from public.credit_accounts where user_id = $1",
      [USER_A],
    );
    expect(rows[0]?.referral_rewarded_count).toBe(3);
    expect(rows[0]?.permanent_balance).toBe(100 + 3 * 50);
  });

  it("never exceeds the global daily cap under concurrent qualification", async () => {
    const inviter = await ensure(db, USER_A);
    await db.query(
      "update public.credit_settings set referral_daily_cap = 2, referral_inviter_cap = 100 where id = 1",
    );

    const invitees = Array.from(
      { length: 6 },
      (_unused, index) =>
        `55555555-5555-4555-8555-5555555555${String(index).padStart(2, "0")}`,
    );
    for (const id of invitees) {
      await ensure(db, id, inviter.referral_code);
    }

    const clients = await Promise.all(
      invitees.map(() => openConcurrentClient()),
    );
    try {
      await Promise.all(
        clients.map((client, index) =>
          reward(client, invitees[index] as string, "agent-audit"),
        ),
      );
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }

    const counter = await db.query<{ rewarded_referrals: number }>(
      "select rewarded_referrals from public.credit_daily_counters",
    );
    expect(counter.rows[0]?.rewarded_referrals).toBe(2);

    const paid = await db.query<{ n: number }>(
      "select count(*)::int as n from public.credit_ledger where entry_type = 'referral_reward_invitee'",
    );
    expect(paid.rows[0]?.n).toBe(2);
  });
});

describe("ledger integrity", () => {
  it("refuses UPDATE and DELETE", async () => {
    await ensure(db, USER_A);
    await expect(
      db.query("update public.credit_ledger set amount = 1"),
    ).rejects.toThrow(/append-only/);
    await expect(db.query("delete from public.credit_ledger")).rejects.toThrow(
      /append-only/,
    );
  });

  it("refuses a duplicate idempotency key", async () => {
    await ensure(db, USER_A);
    await expect(
      db.query(
        `insert into public.credit_ledger
           (user_id, entry_type, amount, permanent_delta, balance_daily_after,
            balance_permanent_after, idempotency_key)
         values ($1, 'signup_bonus', 100, 100, 0, 100, $2)`,
        [USER_A, `signup:${USER_A}`],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("refuses an entry whose sign contradicts its type", async () => {
    await ensure(db, USER_A);
    await expect(
      db.query(
        `insert into public.credit_ledger
           (user_id, entry_type, amount, permanent_delta, balance_daily_after,
            balance_permanent_after, idempotency_key)
         values ($1, 'signup_bonus', -5, -5, 0, 95, 'bogus:1')`,
        [USER_A],
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("replays to the stored balance for every account", async () => {
    const inviter = await ensure(db, USER_A);
    await ensure(db, USER_B, inviter.referral_code);
    await touch(db, USER_A);
    await touch(db, USER_B);
    await reward(db, USER_B);

    const { rows } = await db.query<{
      permanent_balance: number;
      daily_balance: number;
      replayed_permanent: number;
      replayed_daily: number;
    }>(`
      select a.permanent_balance,
             a.daily_balance,
             coalesce(sum(l.permanent_delta), 0)::int as replayed_permanent,
             coalesce(sum(l.daily_delta), 0)::int     as replayed_daily
        from public.credit_accounts a
        left join public.credit_ledger l on l.user_id = a.user_id
       group by a.user_id, a.permanent_balance, a.daily_balance`);

    expect(rows).not.toHaveLength(0);
    for (const row of rows) {
      expect(row.replayed_permanent).toBe(row.permanent_balance);
      expect(row.replayed_daily).toBe(row.daily_balance);
    }
  });

  /**
   * The migration's closing REVOKE/GRANT block is the whole isolation model:
   * RLS with no policies plus service-role-only execute. Asserting it needs a
   * session that actually wears the role, which is why the harness recreates
   * Supabase's roles and schema grants.
   */
  it("exposes the grant functions to service_role and nothing else", async () => {
    const client = await openConcurrentClient();
    try {
      await client.query("set role service_role");
      await expect(
        client.query("select * from public.credits_ensure_account($1)", [
          USER_A,
        ]),
      ).resolves.toBeDefined();

      // The internal helper is revoked even from service_role; only the
      // SECURITY DEFINER functions above may reach it.
      await expect(
        client.query(
          "select public.credits__append_entry($1, 'adjustment', 0, 1, null, 'x', '{}'::jsonb)",
          [USER_A],
        ),
      ).rejects.toThrow(/permission denied/);

      // RLS is enabled with no policy, so the tables are unreachable directly.
      await client.query("set role anon");
      await expect(
        client.query("select * from public.credit_accounts"),
      ).rejects.toThrow(/permission denied/);
      await expect(
        client.query("select * from public.credits_ensure_account($1)", [
          USER_B,
        ]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await client.query("reset role");
      await client.end();
    }
  });

  it("fails closed when the settings row is missing", async () => {
    await ensure(db, USER_A);
    await db.query("delete from public.credit_settings");
    try {
      await expect(touch(db, USER_A)).rejects.toThrow(
        /credit_settings row is missing/,
      );
      await expect(reward(db, USER_A)).rejects.toThrow(
        /credit_settings row is missing/,
      );
    } finally {
      await db.query(
        "insert into public.credit_settings (id) values (1) on conflict (id) do nothing",
      );
    }
  });
});
