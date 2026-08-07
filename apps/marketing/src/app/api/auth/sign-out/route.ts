// @input  -- POST from a signed-in visitor on the marketing site
// @output -- the Supabase session cleared across gengrowth.ai, plus any grant cookies
// @pos    -- the counterpart to the One Tap sign-in; lets a session end where it began
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { cookies } from "next/headers";

import { cookieAttributes } from "../../../../lib/auth/sealed-cookie.ts";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

export const runtime = "nodejs";

/**
 * End the session.
 *
 * Distinct from `/api/auth/google/logout`, which drops only the Search Console
 * grant. This ends the account session itself — and because signing in is now
 * possible here, ending it has to be possible here too. Without it a visitor
 * who signed in on the marketing site had no way back out of it, since the
 * header's sign-in control correctly hides itself once a session exists.
 *
 * The Supabase client owns the session cookie, so `signOut` is what clears it:
 * the cookie is written with the registrable domain (see
 * session-cookie-options.ts), and deleting it by name from the jar would be
 * host-only — leaving the real, domain-scoped cookie in place. Letting the
 * library expire its own cookie keeps the attributes matched.
 *
 * The grant cookies go too. A session ending while its Search Console token
 * lingers would leave this site holding a read grant for an identity that is no
 * longer signed in.
 *
 * POST, not GET: clearing someone's session from a cross-site image tag would
 * be a nuisance rather than an attack, but it is still not something a link
 * should be able to do.
 */
export async function POST(): Promise<Response> {
  try {
    const supabase = await createServerSupabaseClient();
    // 'local' — this browser only. A 'global' sign-out would end the session on
    // every device the account has, which is not what a header control means.
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // An unconfigured or unreachable Supabase must not strand the visitor in a
    // signed-in shell. The grant cookies below still go, and the session cookie
    // is only useful against a Supabase that answers anyway.
  }

  const jar = await cookies();
  // The path has to come from whatever wrote the cookie: `gg_gsc` lives at
  // /api, and a delete at the default "/" does not match it, so the grant
  // would survive the sign-out that was supposed to end it. Same failure the
  // note above describes for the session cookie's domain, one attribute over.
  for (const name of ["gg_id", "gg_gsc", "gg_sites", "gg_oauth_tx"] as const) {
    jar.delete({ name, path: cookieAttributes(name, 0).path });
  }

  return Response.json(
    { data: { signedOut: true } },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
