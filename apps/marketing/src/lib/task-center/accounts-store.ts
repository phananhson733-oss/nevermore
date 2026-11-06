// @input  -- a TaskDb, a verified Supabase user id and email, a TikTok/Facebook handle; an admin's email for a review
// @output -- a promoter's accounts submitted for whitelisting, the admin review list, and the review write
// @pos    -- every SQL statement on task_center.promoter_accounts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  MAX_ACCOUNTS_PER_USER,
  type AccountPlatform,
  type AccountStatus,
} from "./contracts.ts";
import { withTransaction, type TaskDb } from "./db.ts";

export interface PromoterAccount {
  readonly id: string;
  readonly platform: AccountPlatform;
  readonly handle: string;
  readonly status: AccountStatus;
  readonly submittedAt: string;
  readonly reviewedAt: string | null;
}

export interface ReviewAccount extends PromoterAccount {
  readonly userId: string;
  readonly userEmail: string | null;
  readonly reviewedBy: string | null;
}

interface AccountRow {
  id: string;
  user_id: string;
  user_email: string | null;
  platform: AccountPlatform;
  handle: string;
  status: AccountStatus;
  submitted_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
}

const COLUMNS =
  "id, user_id, user_email, platform, handle, status, submitted_at, reviewed_at, reviewed_by";

function toAccount(row: AccountRow): PromoterAccount {
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    status: row.status,
    submittedAt: row.submitted_at.toISOString(),
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
  };
}

function toReview(row: AccountRow): ReviewAccount {
  return {
    ...toAccount(row),
    userId: row.user_id,
    userEmail: row.user_email,
    reviewedBy: row.reviewed_by,
  };
}

export type SubmitResult =
  | { readonly ok: true; readonly account: PromoterAccount; readonly created: boolean }
  | { readonly ok: false; readonly code: "too_many_accounts" };

/**
 * Submitting a handle already on file (in any letter case) returns that row
 * as it is, so a resubmission never resets a whitelisted or rejected account.
 * Submissions by one person take a lock on their user id first, so two at
 * once cannot both count 19 and end at 21.
 */
export async function submitAccount(
  db: TaskDb,
  input: {
    readonly userId: string;
    readonly userEmail: string | null;
    readonly platform: AccountPlatform;
    readonly handle: string;
  },
): Promise<SubmitResult> {
  const handle = input.handle.trim();
  return withTransaction(db, async (tx) => {
    // A separate statement after the lock, so under read committed its count
    // sees whatever the submission that held the lock before it committed.
    await tx.query("select pg_advisory_xact_lock(hashtextextended('promoter_accounts:' || $1, 0))", [
      input.userId,
    ]);
    return insertAccount(tx, input, handle);
  });
}

async function insertAccount(
  db: TaskDb,
  input: { readonly userId: string; readonly userEmail: string | null; readonly platform: AccountPlatform },
  handle: string,
): Promise<SubmitResult> {
  const { rows } = await db.query<AccountRow>(
    `insert into task_center.promoter_accounts (user_id, user_email, platform, handle)
     select $1, $2, $3, $4
      where (select count(*) from task_center.promoter_accounts where user_id = $1) < $5
     on conflict (user_id, platform, lower(handle)) do nothing
     returning ${COLUMNS}`,
    [input.userId, input.userEmail, input.platform, handle, MAX_ACCOUNTS_PER_USER],
  );
  if (rows[0] !== undefined) return { ok: true, account: toAccount(rows[0]), created: true };
  const existing = await db.query<AccountRow>(
    `select ${COLUMNS} from task_center.promoter_accounts
      where user_id = $1 and platform = $2 and lower(handle) = lower($3)`,
    [input.userId, input.platform, handle],
  );
  if (existing.rows[0] !== undefined) {
    return { ok: true, account: toAccount(existing.rows[0]), created: false };
  }
  return { ok: false, code: "too_many_accounts" };
}

export async function listMyAccounts(
  db: TaskDb,
  userId: string,
): Promise<readonly PromoterAccount[]> {
  const { rows } = await db.query<AccountRow>(
    `select ${COLUMNS} from task_center.promoter_accounts
      where user_id = $1 order by submitted_at, id`,
    [userId],
  );
  return rows.map(toAccount);
}

/**
 * A promoter can withdraw an account only while it is still waiting. Once
 * the operators have answered, the row stays: deleting a rejected account and
 * submitting it again would otherwise wipe the rejection.
 */
export async function withdrawAccount(
  db: TaskDb,
  userId: string,
  accountId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `delete from task_center.promoter_accounts
      where id = $1 and user_id = $2 and status = 'submitted'`,
    [accountId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/** Waiting accounts first, oldest first, then everything already reviewed, newest review first. */
export async function listAccountsForReview(db: TaskDb): Promise<readonly ReviewAccount[]> {
  const { rows } = await db.query<AccountRow>(
    `select ${COLUMNS} from task_center.promoter_accounts
      order by (status = 'submitted') desc,
               case when status = 'submitted' then submitted_at end asc,
               reviewed_at desc nulls last, id`,
  );
  return rows.map(toReview);
}

/** False when no such account exists. A second review overwrites the first. */
export async function reviewAccount(
  db: TaskDb,
  accountId: string,
  status: Exclude<AccountStatus, "submitted">,
  reviewer: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update task_center.promoter_accounts
        set status = $2, reviewed_at = now(), reviewed_by = $3
      where id = $1`,
    [accountId, status, reviewer],
  );
  return (rowCount ?? 0) > 0;
}
