import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/env";
import { safePostLoginPath } from "@/lib/auth/redirect";
import { withBasePath } from "@/lib/base-path";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * OAuth return leg (spec §1.6).
 *
 * Supabase sends the browser here with a one-time `code`. Exchanging it sets the
 * session cookies, after which `getOperatorContext` either finds an existing
 * operator or provisions a workspace for a first-time account.
 *
 * Everything that arrives in the query string is attacker-reachable — a link to
 * this route can be sent to anyone — so `next` is re-validated here even though
 * the action that minted it already did. A failed exchange returns to the login
 * screen with a marker rather than rendering an error page, because the only
 * useful next step is to try again.
 */
function loginRedirect(request: NextRequest, next: string, reason: string): NextResponse {
  const url = new URL(withBasePath("/login"), request.url);
  url.searchParams.set("error", reason);
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requested = request.nextUrl.searchParams;
  const next = safePostLoginPath(requested.get("next"));

  // The provider reports a refusal (consent declined, for instance) with
  // `error`, and no code. That is not a failure worth alarming about.
  if (requested.get("error")) {
    return loginRedirect(request, next, "oauth_denied");
  }

  const code = requested.get("code");
  if (!code) return loginRedirect(request, next, "oauth");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return loginRedirect(request, next, "oauth");

  // Built against the configured origin rather than `request.url`: the redirect
  // must land on the app's own origin even when a proxy rewrote the inbound
  // host, and `next` is already fenced to a same-origin path.
  return NextResponse.redirect(
    new URL(withBasePath(next), getEnv().APP_ORIGIN),
  );
}
