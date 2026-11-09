// @input  -- a TaskDb, a verified Supabase user id, a promo code from /t/<code>, /t/<code>/go or a drama page's ?ref=
// @output -- claims (one per person, drama and channel; new ones are channel "all"), which drama a followed code is for (one click recorded), the drama's platform link for 去看全集 and /t/<code>/go with the code only when it was claimed for that drama (a sub-channel value stored in the link is replaced or dropped, never passed on), click counts
// @pos    -- every SQL statement on task_center.task_claims and task_center.promo_clicks
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { randomInt } from "node:crypto";

import { PROMO_CODE_ALPHABET, type ClaimChannel } from "./contracts.ts";
import { toSafeInteger, type TaskDb } from "./db.ts";

export interface Claim {
  readonly id: string;
  readonly dramaId: string;
  readonly channel: ClaimChannel;
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
  channel: ClaimChannel;
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
 * Only a published drama can be claimed. Every code handed out opens the
 * drama's page on our site, which exists whether or not the drama has a
 * platform link yet.
 */
export async function claimTask(
  db: TaskDb,
  claim: { readonly userId: string; readonly dramaId: string; readonly channel: ClaimChannel },
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
      // An existing claim is returned even if the drama was taken down since:
      // the links it handed out still open the drama's page.
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

/**
 * Records one click and returns the drama whose page the code opens, or null
 * for a code nobody claimed. Any claimed code opens its drama's page, even
 * after the drama was taken down: codes are only handed out while a drama is
 * published, and a promoter's post outlives the listing.
 */
export async function followPromoCode(
  db: TaskDb,
  code: string,
): Promise<{ readonly dramaId: string } | null> {
  // The insert runs once whether or not anything reads its result.
  const { rows } = await db.query<{ drama_id: string }>(
    `with followed as (
       select id as claim_id, drama_id from task_center.task_claims where code = $1
     ), click as (
       insert into task_center.promo_clicks (claim_id)
       select claim_id from followed
     )
     select drama_id from followed`,
    [code],
  );
  return rows[0] === undefined ? null : { dramaId: rows[0].drama_id };
}

export interface PromoTarget {
  readonly targetUrl: string;
  readonly codeParam: string | null;
}

/**
 * Where 去看全集 on a drama's page and the 资源推广链接 /t/<code>/go lead:
 * the platform link of a drama that has been listed (published now or taken
 * down since, like the page itself), or null when it has none. The code rides along only when it was claimed for
 * this drama, so a ref copied onto another drama's page earns nobody anything.
 */
export async function getPlatformLink(
  db: TaskDb,
  dramaId: string,
  code: string | null,
): Promise<{ readonly target: PromoTarget; readonly code: string | null } | null> {
  const { rows } = await db.query<{
    promo_target_url: string;
    promo_code_param: string | null;
    code_claimed: boolean;
  }>(
    `select d.promo_target_url, d.promo_code_param,
            exists (select 1 from task_center.task_claims c
                     where c.code = $2 and c.drama_id = d.id) as code_claimed
       from task_center.dramas d
      where d.id = $1 and d.listed_at is not null and d.promo_target_url is not null`,
    [dramaId, code],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    target: { targetUrl: row.promo_target_url, codeParam: row.promo_code_param },
    code: row.code_claimed ? code : null,
  };
}

/**
 * The target URL with the promo code as the platform's sub-channel parameter.
 * A value already stored in that parameter never goes out on its own: without
 * a vouched-for code it is dropped, so nobody's code rides on another
 * reader's visit. Always serialised through URL, which percent-encodes a path
 * like /剧 and punycodes the host: a Location header only takes ASCII.
 */
export function promoRedirectUrl(target: PromoTarget, code: string | null): string {
  const url = new URL(target.targetUrl);
  if (target.codeParam !== null) {
    if (code !== null) url.searchParams.set(target.codeParam, code);
    else if (url.searchParams.has(target.codeParam)) url.searchParams.delete(target.codeParam);
  }
  return url.toString();
}
