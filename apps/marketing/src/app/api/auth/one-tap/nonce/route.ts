// @input  -- GET from the One Tap mount before it initialises GSI
// @output -- the hashed nonce to hand Google, with the raw one sealed in a cookie
// @pos    -- issues the replay binding that /api/auth/one-tap later verifies
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { cookies } from "next/headers";
import { createOneTapNonce, NONCE_TTL_SECONDS } from "@/lib/auth/one-tap";
import { cookieAttributes, seal } from "@/lib/auth/sealed-cookie";
import { isGoogleConnectEnabled } from "@/lib/tools/traffic-drop-session";

export const runtime = "nodejs";

/**
 * Issue a One Tap nonce.
 *
 * A route handler rather than a server component because the raw nonce has to
 * be written to a cookie, and Next only permits cookie writes from route
 * handlers and server actions. It also keeps the marketing pages statically
 * renderable: the nonce is fetched after hydration instead of forcing every
 * page that mounts One Tap into dynamic rendering.
 *
 * Only the HASH is returned. The raw value stays server-side, which is what
 * makes a stolen id_token insufficient on its own.
 */
export async function GET(): Promise<Response> {
  if (!isGoogleConnectEnabled()) {
    return new Response(null, { status: 404 });
  }

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    // Not an error worth alarming about: a deployment without One Tap
    // configured simply does not prompt.
    return new Response(null, { status: 404 });
  }

  const nonce = createOneTapNonce();
  const jar = await cookies();
  jar.set(
    "gg_onetap",
    seal("gg_onetap", nonce.raw, NONCE_TTL_SECONDS),
    cookieAttributes("gg_onetap", NONCE_TTL_SECONDS),
  );

  return new Response(
    JSON.stringify({ clientId, nonce: nonce.hashed }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        // Per-visitor and single-use. A cached copy would hand two people the
        // same nonce and break the binding it exists to provide.
        "cache-control": "no-store",
      },
    },
  );
}
