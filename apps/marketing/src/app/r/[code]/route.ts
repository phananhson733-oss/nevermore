// @input  -- GET /r/{code} from a shared referral link
// @output -- a 302 to the home page, with the referral code remembered
// @pos    -- the only entry point that writes gg_ref

import { NextResponse } from "next/server";

import {
  REFERRAL_COOKIE_NAME,
  normalizeReferralCode,
  referralCookieAttributes,
} from "../../../lib/credits/referral-cookie.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{ code?: string }> | { code?: string };
  },
): Promise<Response> {
  const { code } = await Promise.resolve(context.params);

  const response = NextResponse.redirect(new URL("/", request.url), 302);
  // A redirect that sets a per-visitor cookie must never be cached by a CDN,
  // or the next visitor inherits someone else's referrer.
  response.headers.set("cache-control", "no-store");

  const normalized = normalizeReferralCode(code);
  if (normalized !== null) {
    response.cookies.set(
      REFERRAL_COOKIE_NAME,
      normalized,
      referralCookieAttributes(),
    );
  }
  return response;
}
