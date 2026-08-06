// @input  -- the Supabase session cookies shared across *.gengrowth.ai
// @output -- whether this visitor is signed in; never who they are
// @pos    -- lets statically rendered marketing pages show the right header CTA
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Report sign-in state, and nothing else.
 *
 * The marketing pages are statically rendered; reading cookies during render
 * would opt every page into dynamic rendering and lose the CDN cache. So the
 * header asks after hydration instead.
 *
 * The answer is deliberately a bare boolean. An email or a name here would be
 * personal data on an endpoint reachable from any page, for the sake of a
 * button label — the header only needs to know whether to offer "sign in" or
 * "open the app".
 */
export async function GET(): Promise<Response> {
  let signedIn = false;
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = user !== null;
  } catch {
    // An unconfigured or unreachable Supabase means we cannot prove a session.
    // Answering "signed out" degrades to the sign-in link, which is the honest
    // and harmless default.
    signedIn = false;
  }

  return new Response(JSON.stringify({ signedIn }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      // Per-visitor. A shared cache here would show one visitor's state to
      // another.
      "cache-control": "no-store, private",
    },
  });
}
