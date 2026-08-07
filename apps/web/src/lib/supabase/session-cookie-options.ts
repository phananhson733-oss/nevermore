import type { CookieOptions } from "@supabase/ssr";

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Session cookie scope for a two-property brand.
 *
 * Sign-in can start on gengrowth.ai (One Tap) and continue here, so both
 * properties must agree on the cookie's scope. If only the marketing site set
 * `domain`, this app would keep refreshing the session into a host-only cookie
 * of the same name, leaving two cookies whose precedence the app does not
 * control.
 *
 * It stays configuration rather than a constant because the value is only
 * correct for the real deployment: on localhost and on preview *.vercel.app
 * hosts a domain attribute is meaningless or rejected outright, and a rejected
 * Set-Cookie is a silent sign-out. Unset means host-only — it fails to a
 * narrower scope, never a wider one.
 *
 * Must be the registrable domain the two hosts share (gengrowth.ai). A leading
 * dot is accepted and normalised away; RFC 6265 treats the two forms alike.
 */
export function sessionCookieDomain(
  env: RuntimeEnvironment = process.env,
): string | undefined {
  const raw = env["SESSION_COOKIE_DOMAIN"]?.trim();
  if (!raw) return undefined;
  const normalized = raw.replace(/^\./, "").toLowerCase();
  return normalized === "" ? undefined : normalized;
}

/** Session-cookie attributes shared by server rendering and edge refresh. */
export function sessionCookieOptions(
  env: RuntimeEnvironment = process.env,
): CookieOptions {
  const domain = sessionCookieDomain(env);
  return {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: env["NODE_ENV"] === "production",
    ...(domain ? { domain } : {}),
  };
}

/** Preserve Supabase expiry metadata while preventing weaker cookie attributes. */
export function hardenSessionCookieOptions(
  options: CookieOptions,
  env: RuntimeEnvironment = process.env,
): CookieOptions {
  return {
    ...options,
    ...sessionCookieOptions(env),
  };
}

/**
 * Attributes that expire a pre-existing HOST-ONLY cookie of the same name.
 *
 * Widening scope does not replace a cookie — it adds one. A browser that
 * already holds `sb-…-auth-token` for `app.gengrowth.ai` keeps it alongside the
 * new `Domain=gengrowth.ai` copy, sends BOTH on every request, and which one
 * the server reads is decided by header order rather than by us. That is how a
 * sign-out leaves a still-valid session behind, or a refresh writes to one copy
 * while reads come from the other.
 *
 * So on every write we also emit a deletion for the un-scoped twin. `maxAge: 0`
 * with NO domain attribute matches only the host-only cookie; the domain-scoped
 * one we just wrote is a different cookie and is untouched. Once no browser
 * holds a legacy cookie this is a no-op that costs one Set-Cookie header.
 *
 * Only meaningful while a domain IS configured — without one there is no second
 * cookie to disambiguate from, and emitting this would delete the very cookie
 * being set.
 */
export function legacyHostOnlyExpiry(
  env: RuntimeEnvironment = process.env,
): CookieOptions | null {
  if (!sessionCookieDomain(env)) return null;
  return {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: env["NODE_ENV"] === "production",
    maxAge: 0,
  };
}
