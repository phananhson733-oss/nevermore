// @input  -- SESSION_COOKIE_DOMAIN, NODE_ENV
// @output -- the cookie attributes Supabase session cookies are written with
// @pos    -- the single place the marketing site decides session cookie scope
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { CookieOptions } from "@supabase/ssr";

/**
 * Session cookie scope for a two-property brand.
 *
 * Signing in happens on gengrowth.ai; the product runs on app.gengrowth.ai. A
 * host-only cookie written by the marketing site is simply not sent to the app
 * subdomain, so the visitor would sign in and then arrive logged out. Setting
 * `domain` to the registrable domain makes one session cover both.
 *
 * It is configuration rather than a constant because the value is only correct
 * for the real deployment: on localhost and on *.vercel.app a domain attribute
 * is either meaningless or outright rejected by the browser, and a rejected
 * Set-Cookie is a silent sign-in failure. Unset means host-only, which is the
 * safe default — it fails to a narrower scope, never a wider one.
 *
 * The value must be the registrable domain the two hosts share (gengrowth.ai).
 * A leading dot is accepted for the operator's convenience and normalised away;
 * RFC 6265 treats `.example.com` and `example.com` identically.
 */
export function sessionCookieDomain(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const raw = env["SESSION_COOKIE_DOMAIN"]?.trim();
  if (!raw) return undefined;
  const normalized = raw.replace(/^\./, "").toLowerCase();
  return normalized === "" ? undefined : normalized;
}

export function sessionCookieOptions(
  env: Readonly<Record<string, string | undefined>> = process.env,
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

/**
 * Keep Supabase's expiry metadata while refusing weaker attributes.
 *
 * Supabase decides `maxAge`/`expires` per cookie; we decide scope and hardening.
 * Spreading ours last means a future library change cannot quietly drop
 * `httpOnly` or widen `sameSite`.
 */
export function hardenSessionCookieOptions(
  options: CookieOptions,
  env: Readonly<Record<string, string | undefined>> = process.env,
): CookieOptions {
  return { ...options, ...sessionCookieOptions(env) };
}
