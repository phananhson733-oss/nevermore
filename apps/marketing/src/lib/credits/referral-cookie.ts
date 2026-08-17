// @input  -- a referral code from a /r/{code} link, or the request cookie jar
// @output -- a validated code and the attributes gg_ref is written with
// @pos    -- the only definition of how a referral is remembered

import {
  REFERRAL_COOKIE_MAX_AGE_SECONDS,
  REFERRAL_COOKIE_NAME,
  REFERRAL_CODE_PATTERN,
} from "./credits-config.ts";

export { REFERRAL_COOKIE_NAME };

export interface ReferralCookieAttributes {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: "/";
  readonly maxAge: number;
}

/**
 * Accept only what the generator could have issued, and normalise the two ways
 * a real link gets mangled: a code copied out of chat keeps its whitespace, and
 * a code retyped from a screenshot loses its case.
 *
 * Anything else returns null rather than throwing. A dead referral link is not
 * an error page; the visitor still came to the site.
 */
export function normalizeReferralCode(
  value: string | undefined | null,
): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return REFERRAL_CODE_PATTERN.test(candidate) ? candidate : null;
}

/**
 * Host-only, deliberately.
 *
 * `sealed-cookie.ts` refuses to set a Domain on this site's cookies, on the
 * grounds that a domain-wide cookie hands the app's XSS blast radius to the
 * marketing site and back. A referral code is not worth reopening that: the
 * landing page and One Tap sign-in share a host, and §5.3 of the design already
 * declares attribution best-effort, so a visitor who crosses between apex and
 * www simply is not attributed.
 */
export function referralCookieAttributes(): ReferralCookieAttributes {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
  };
}

/** Attributes for clearing the cookie. Path must match, or the delete no-ops. */
export function referralCookieClearAttributes(): Omit<
  ReferralCookieAttributes,
  "maxAge"
> & { readonly maxAge: 0 } {
  return { ...referralCookieAttributes(), maxAge: 0 };
}
