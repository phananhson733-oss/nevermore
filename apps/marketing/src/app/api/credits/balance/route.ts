// @input  -- GET from a signed-in browser, carrying the session and maybe gg_ref
// @output -- this visitor's balance, today's grant and their referral state
// @pos    -- the only endpoint the header badge and the account page read

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getServerAuthenticatedUser } from "../../../../lib/auth/server-auth-user.ts";
import {
  BALANCE_RATE_LIMIT,
  creditsEnabled,
} from "../../../../lib/credits/credits-config.ts";
import {
  ensureAccount,
  touchDaily,
} from "../../../../lib/credits/credits-store.ts";
import {
  REFERRAL_COOKIE_NAME,
  normalizeReferralCode,
  referralCookieClearAttributes,
} from "../../../../lib/credits/referral-cookie.ts";
import { consumePublicToolQuota } from "../../../../lib/tools/shared-rate-limit.ts";

export const runtime = "nodejs";

/**
 * Reading this grants the day, and everything in the answer belongs to one
 * signed-in person. Neither the browser nor a CDN may keep any of it.
 */
const CACHE_CONTROL = "no-store, private";

function json(
  body: unknown,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...headers, "cache-control": CACHE_CONTROL },
  });
}

function failure(
  code: string,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): NextResponse {
  return json({ error: { code } }, status, headers);
}

export async function GET(): Promise<Response> {
  // Decided first: while the switch is off this endpoint does not exist, so a
  // probe cannot tell whether the tables behind it do.
  if (!creditsEnabled()) return failure("credits_disabled", 404);

  const authentication = await getServerAuthenticatedUser();
  if (authentication.status === "unavailable") {
    return failure("auth_unavailable", 503);
  }
  if (authentication.status === "unauthenticated") {
    return failure("auth_required", 401);
  }
  const { userId } = authentication;

  const quota = await consumePublicToolQuota(
    `credits-balance:user:${userId}`,
    BALANCE_RATE_LIMIT.max,
    BALANCE_RATE_LIMIT.windowSeconds,
  );
  if (quota.kind === "limited") {
    return failure("rate_limited", 429, {
      "retry-after": String(quota.retryAfterSeconds),
    });
  }
  if (quota.kind === "unavailable") {
    /**
     * Open, where the crawl gate is closed.
     *
     * There the limiter guards money spent at a third party, so an outage has
     * to stop the request. Here the whole endpoint is one upsert against our
     * own database, and failing closed would delete the balance from the header
     * of every signed-in visitor for as long as the limiter is down — a much
     * worse outcome than a badge that could briefly be polled too often.
     */
    console.error("[credits-balance] rate limiter unavailable:", quota.reason);
  }

  const jar = await cookies();
  // HttpOnly stops a script from writing this, not a client from sending it, so
  // what reaches the RPC is validated rather than trusted.
  const referralCode = normalizeReferralCode(
    jar.get(REFERRAL_COOKIE_NAME)?.value,
  );

  const account = await ensureAccount(userId, referralCode);
  if (account.kind !== "ok") return failure("credits_unavailable", 503);

  const daily = await touchDaily(userId);
  // "missing" here would mean the row ensureAccount just returned is gone.
  if (daily.kind !== "ok") return failure("credits_unavailable", 503);

  /**
   * Two ways to be granted today, and the second one matters: an account that
   * has reached the lifetime cap is stamped with today's date and granted
   * nothing, and reading `granted` alone would keep inviting it back for a
   * grant it can never receive.
   */
  const grantedToday =
    daily.value.granted > 0 ||
    daily.value.dailyGrantedOn === new Date().toISOString().slice(0, 10);

  const response = json(
    {
      data: {
        balance: {
          permanent: daily.value.permanentBalance,
          daily: daily.value.dailyBalance,
          total: daily.value.totalBalance,
        },
        mode: daily.value.mode,
        dailyGrant: {
          grantedToday,
          amount: daily.value.dailyAmount,
          welfareRemaining: daily.value.welfareRemaining,
          // Sent for the same reason referral.cap is: credit_settings is
          // editable in production and takes effect without a deploy, so a page
          // that printed a compiled-in cap next to a live remaining would
          // eventually print "980 of 600 left".
          welfareCap: daily.value.welfareAccrualCap,
        },
        referral: {
          code: account.value.referralCode,
          rewardedCount: account.value.referralRewardedCount,
          cap: daily.value.referralInviterCap,
        },
      },
    },
    200,
  );

  // Only when THIS call attached the referrer. Attribution is one-shot in SQL,
  // so an account that already had one keeps it, and the code that lost is
  // still the visitor's to use on another account — reading referredBy here
  // would throw it away. The clear has to carry the attributes that wrote the
  // cookie or the browser keeps it for another thirty days.
  if (referralCode !== null && account.value.attributed) {
    response.cookies.set(
      REFERRAL_COOKIE_NAME,
      "",
      referralCookieClearAttributes(),
    );
  }
  return response;
}
