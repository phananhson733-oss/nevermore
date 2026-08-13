// @input  -- the server Supabase client's verified getUser result
// @output -- authenticated, unauthenticated, or unavailable without user data
// @pos    -- shared marketing boundary for session probes and gated Agent APIs

import { createServerSupabaseClient } from "../supabase/server.ts";

export type ServerAuthenticationStatus =
  | "authenticated"
  | "unauthenticated"
  | "unavailable";

function isMissingSessionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Readonly<Record<string, unknown>>;
  return (
    candidate.name === "AuthSessionMissingError" && candidate.status === 400
  );
}

/**
 * Verify the current user while keeping "no session" distinct from an auth
 * service or configuration failure. Supabase auth-js 2.110.7 uses this exact
 * named/status error for an absent session; every other error fails closed as
 * unavailable instead of being mislabeled as signed out.
 */
export async function getServerAuthenticationStatus(): Promise<ServerAuthenticationStatus> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error !== null) {
      return user === null && isMissingSessionError(error)
        ? "unauthenticated"
        : "unavailable";
    }
    return user === null ? "unauthenticated" : "authenticated";
  } catch {
    return "unavailable";
  }
}
