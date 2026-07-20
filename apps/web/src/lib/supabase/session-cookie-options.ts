import type { CookieOptions } from "@supabase/ssr";

/** Session-cookie attributes shared by server rendering and edge refresh. */
export function sessionCookieOptions(
  environment = process.env["NODE_ENV"],
): CookieOptions {
  return {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: environment === "production",
  };
}

/** Preserve Supabase expiry metadata while preventing weaker cookie attributes. */
export function hardenSessionCookieOptions(
  options: CookieOptions,
  environment = process.env["NODE_ENV"],
): CookieOptions {
  return {
    ...options,
    ...sessionCookieOptions(environment),
  };
}
