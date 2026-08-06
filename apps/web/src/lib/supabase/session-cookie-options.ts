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
