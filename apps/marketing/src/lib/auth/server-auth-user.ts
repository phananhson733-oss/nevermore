// @input  -- the server Supabase client's verified getUser result
// @output -- the verified user id, or a tri-state that keeps an outage apart from a sign-out
// @pos    -- the identity boundary server-side per-user records are keyed on

import { createServerSupabaseClient } from "../supabase/server.ts";

export type ServerAuthenticatedUser =
  | { readonly status: "authenticated"; readonly userId: string }
  | { readonly status: "unauthenticated" }
  | { readonly status: "unavailable" };

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
 *
 * The id is only ever the one the auth server verified. A caller keying
 * per-user records on it must be able to tell "nobody is signed in" from "we
 * could not ask", because the two demand opposite responses: one is a normal
 * anonymous visitor, the other must not be written against at all.
 */
export async function getServerAuthenticatedUser(): Promise<ServerAuthenticatedUser> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error !== null) {
      return user === null && isMissingSessionError(error)
        ? { status: "unauthenticated" }
        : { status: "unavailable" };
    }
    return user === null
      ? { status: "unauthenticated" }
      : { status: "authenticated", userId: user.id };
  } catch {
    return { status: "unavailable" };
  }
}
