// @input  -- same-origin POST from the signed-in visitor
// @output -- the grant revoked at Google where possible, and every cookie cleared
// @pos    -- lets a visitor drop the session and grant this site holds
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { cookies } from "next/headers";
import { disconnectGoogleGrant, isSameOriginPost } from "@/lib/auth/disconnect";
import { readGoogleOAuthConfig, revokeToken } from "@/lib/auth/google-oauth";

export const runtime = "nodejs";

/**
 * POST, not GET: clearing someone's session from a cross-site image tag would
 * be a nuisance rather than an attack, but it is still not something a link
 * should be able to do.
 *
 * Since the grant persists, this endpoint also revokes at Google — an
 * irreversible remote effect, which is why the Origin check is here too.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) {
    return Response.json(
      { error: { code: "cross_origin" } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const jar = await cookies();
  const result = await disconnectGoogleGrant({
    jar: {
      read: (name) => jar.get(name)?.value,
      // The explicit path matters: `gg_gsc` is stored at /api and a Set-Cookie
      // at / does not match it.
      clear: (name, path) => jar.delete({ name, path }),
    },
    now: Date.now,
    revoke: async (token) => {
      try {
        // Reading the config can throw when the site is not configured; that is
        // a reason to skip the remote call, never to skip the local clear.
        readGoogleOAuthConfig();
      } catch {
        return false;
      }
      return revokeToken({ token });
    },
  });

  return Response.json(
    { data: { signedOut: true, revokedAtGoogle: result.revokedAtGoogle } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
