// @input  -- the Supabase session cookies shared across *.gengrowth.ai
// @output -- the caller's own email, or 401 / 503; never anybody else's
// @pos    -- what the header's account menu names the signed-in account by
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { getServerAuthenticatedUser } from "../../../../lib/auth/server-auth-user.ts";

export const runtime = "nodejs";

/**
 * Name the account the visitor is signed in as.
 *
 * Deliberately separate from /api/auth/session, which answers a bare boolean
 * and must keep doing so: that endpoint is called from every marketing page to
 * pick a header CTA, and widening it would put an address in an answer the
 * whole site asks for. This one is asked for only when a signed-in visitor
 * opens their account menu, and returns nothing to anyone who is not signed in.
 *
 * The address is the caller's own, read from the session cookie the caller
 * sent, verified against the auth server. There is no id parameter and no way
 * to ask about a different account, which is what keeps this from being a
 * lookup endpoint.
 *
 * Why an address at all: a visitor with more than one Google account cannot
 * otherwise tell which one this site holds a session for, and on this site
 * that matters — the balance, the referral code and the ledger all belong to
 * whichever account is signed in, and they are invisible from the wrong one.
 */
export async function GET(): Promise<Response> {
  const authentication = await getServerAuthenticatedUser();

  if (authentication.status === "unavailable") {
    return json({ error: { code: "auth_unavailable" } }, 503);
  }
  if (authentication.status === "unauthenticated") {
    return json({ error: { code: "auth_required" } }, 401);
  }

  return json({ data: { email: authentication.email } }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // One person's address. A shared cache here would hand it to the next
      // visitor through the same edge node.
      "cache-control": "no-store, private",
    },
  });
}
