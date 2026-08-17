// @input  -- the server Supabase client's verified getUser result
// @output -- authenticated, unauthenticated, or unavailable without user data
// @pos    -- shared marketing boundary for session probes and gated Agent APIs

import { getServerAuthenticatedUser } from "./server-auth-user.ts";

export type ServerAuthenticationStatus =
  | "authenticated"
  | "unauthenticated"
  | "unavailable";

/**
 * Verify the current user while keeping "no session" distinct from an auth
 * service or configuration failure. Only an absent session reads as signed
 * out; every other error fails closed as unavailable instead of being
 * mislabeled as signed out.
 *
 * The answer carries no user data because /api/auth/session is reachable from
 * any marketing page, and an email or an id there would be personal data on an
 * unauthenticated endpoint. Server code that legitimately needs the verified
 * id calls getServerAuthenticatedUser in server-auth-user.ts, which owns the
 * verification this status narrows.
 */
export async function getServerAuthenticationStatus(): Promise<ServerAuthenticationStatus> {
  return (await getServerAuthenticatedUser()).status;
}
