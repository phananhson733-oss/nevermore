// @input  -- a TaskDb, a verified Supabase user id, a promo code from /t/<code>
// @output -- claims (one per person, drama and channel), the promo redirect target, click counts
// @pos    -- every SQL statement on task_center.task_claims and task_center.promo_clicks
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { randomInt } from "node:crypto";

import { PROMO_CODE_ALPHABET, type PromoChannel } from "./contracts.ts";
import { toSafeInteger, type TaskDb } from "./db.ts";

export interface Claim {
  readonly id: string;
  readonly dramaId: string;
  readonly channel: PromoChannel;
  readonly code: string;
  readonly claimedAt: string;
}

export interface ClaimWithStats extends Claim {
  readonly dramaTitle: string;
  readonly dramaTitleCn: string | null;
  readonly dramaPlatform: string;
  readonly clicks: number;
}

interface ClaimRow {
  id: string;
  drama_id: string;
  channel: PromoChannel;
  code: string;
  claimed_at: Date;
}

function toClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    dramaId: row.drama_id,
    channel: row.channel,
    code: row.code,
    claimedAt: row.claimed_at.toISOString(),
  };
}

export function generatePromoCode(): string {
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += PROMO_CODE_ALPHABET[randomInt(PROMO_CODE_ALPHABET.length)];
  }
  return code;
}

export type ClaimResult =
  | { readonly ok: true; readonly claim: Claim; readonly created: boolean }
  | { readonly ok: false; readonly code: "not_found" };

/**
 * Claiming twice returns the first claim, so a double click or a second tab
 * never hands out a second code for the same channel.
 *
 * Only a published drama can be claimed; publishing requires a promo target,
 * so every code handed out has somewhere to send its visitors.
 */
export async function claimTask(
  db: TaskDb,
  claim: { readonly userId: string; readonly dramaId: string; readonly channel: PromoChannel },
  newCode: () => string = generatePromoCode,
): Promise<ClaimResult> {
  // A collision on `code` is about one in 10^12 per claim; a few retries is
  // the whole cost of keeping codes short.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const { rows } = await db.query<ClaimRow>(
        `insert into task_center.task_claims (user_id, drama_id, channel, code)
         select $1, d.id, $3, $4 from task_center.dramas d
          where d.id = $2 and d.status = 'published'
         on conflict (user_id, drama_id, channel) do nothing
         returning id, drama_id, channel, code, claimed_at`,
        [claim.userId, claim.dramaId, claim.channel, newCode()],
      );
      if (rows[0] !== undefined) {
        return { ok: true, claim: toClaim(rows[0]), created: true };
      }
      const existing = await db.query<ClaimRow>(
        `select id, drama_id, channel, code, claimed_at from task_center.task_claims
          where user_id = $1 and drama_id = $2 and channel = $3`,
        [claim.userId, claim.dramaId, claim.channel],
      );
      if (existing.rows[0] !== undefined) {
        return { ok: true, claim: toClaim(existing.rows[0]), created: false };
      }
      return { ok: false, code: "not_found" };
    } catch (error) {
      if ((error as { constraint?: unknown }).constraint === "task_claims_code_key") {
        continue;
      }
      throw error;
    }
  }
  throw new Error("task center: could not find an unused promo code");
}

/** This person's claims on one drama, for the detail page's buttons. */
export async function listClaimsForDrama(
  db: TaskDb,
  userId: string,
  dramaId: string,
): Promise<readonly Claim[]> {
  const { rows } = await db.query<ClaimRow>(
    `select id, drama_id, channel, code, claimed_at from task_center.task_claims
      where user_id = $1 and drama_id = $2 order by claimed_at`,
    [userId, dramaId],
  );
  return rows.map(toClaim);
}

/** Everything this person claimed, newest first, with how often each link was followed. */
export async function listMyClaims(
  db: TaskDb,
  userId: string,
): Promise<readonly ClaimWithStats[]> {
  const { rows } = await db.query<
    ClaimRow & { title: string; title_cn: string | null; platform: string; clicks: string }
  >(
    `select c.id, c.drama_id, c.channel, c.code, c.claimed_at,
            d.title, d.title_cn, d.platform,
            (select count(*) from task_center.promo_clicks p where p.claim_id = c.id) as clicks
       from task_center.task_claims c
       join task_center.dramas d on d.id = c.drama_id
      where c.user_id = $1
      order by c.claimed_at desc, c.id`,
    [userId],
  );
  return rows.map((row) => ({
    ...toClaim(row),
    dramaTitle: row.title,
    dramaTitleCn: row.title_cn,
    dramaPlatform: row.platform,
    clicks: toSafeInteger(row.clicks) ?? 0,
  }));
}

export interface PromoTarget {
  readonly targetUrl: string;
  readonly codeParam: string | null;
}

/**
 * Records one click and returns where to send the visitor, or null for a code
 * nobody claimed. A drama taken down, or moved back to draft, later still
 * forwards: codes are only handed out while a drama is published, the
 * promoter's post outlives the listing, and the platform decides what its link
 * shows.
 */
export async function followPromoCode(
  db: TaskDb,
  code: string,
): Promise<PromoTarget | null> {
  const { rows } = await db.query<{ promo_target_url: string | null; promo_code_param: string | null }>(
    `with target as (
       select c.id as claim_id, d.promo_target_url, d.promo_code_param
         from task_center.task_claims c
         join task_center.dramas d on d.id = c.drama_id
        where c.code = $1 and d.promo_target_url is not null
     ), click as (
       insert into task_center.promo_clicks (claim_id)
       select claim_id from target
     )
     select promo_target_url, promo_code_param from target`,
    [code],
  );
  const row = rows[0];
  if (row === undefined || row.promo_target_url === null) return null;
  return { targetUrl: row.promo_target_url, codeParam: row.promo_code_param };
}

/**
 * The target URL with the promo code added as the platform's sub-channel
 * parameter. Always serialised through URL, which percent-encodes a path like
 * /剧 and punycodes the host: a Location header only takes ASCII, and the
 * click is already recorded by the time it is built.
 */
export function promoRedirectUrl(target: PromoTarget, code: string): string {
  const url = new URL(target.targetUrl);
  if (target.codeParam !== null) url.searchParams.set(target.codeParam, code);
  return url.toString();
}
