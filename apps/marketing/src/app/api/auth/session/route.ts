// @input  -- the Supabase session cookies shared across *.gengrowth.ai
// @output -- signed-in state or a stable auth-unavailable error; never identity
// @pos    -- lets statically rendered marketing pages show the right header CTA
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { getServerAuthenticationStatus } from "../../../../lib/auth/server-auth-status.ts";

export const runtime = "nodejs";

/**
 * Report sign-in state, and nothing else.
 *
 * The marketing pages are statically rendered; reading cookies during render
 * would opt every page into dynamic rendering and lose the CDN cache. So the
 * header asks after hydration instead.
 *
 * A verified answer is deliberately a bare boolean. An email or a name here
 * would be personal data on an endpoint reachable from any page. If auth
 * cannot be checked, a stable non-personal error keeps an Agent from opening a
 * misleading sign-in flow while ordinary header callers can still degrade.
 */
export async function GET(): Promise<Response> {
  const authentication = await getServerAuthenticationStatus();
  const body =
    authentication === "unavailable"
      ? { error: { code: "auth_unavailable" } }
      : { signedIn: authentication === "authenticated" };

  return new Response(JSON.stringify(body), {
    status: authentication === "unavailable" ? 503 : 200,
    headers: {
      "content-type": "application/json",
      // Per-visitor. A shared cache here would show one visitor's state to
      // another.
      "cache-control": "no-store, private",
    },
  });
}
