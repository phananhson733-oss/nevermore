// @input  -- POST with a Google One Tap credential, plus the sealed nonce cookie
// @output -- a Supabase session shared across gengrowth.ai and app.gengrowth.ai
// @pos    -- the One Tap leg of sign-in; the redirect leg lives in auth/google
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { cookies } from "next/headers";
import { screenCredential } from "@/lib/auth/one-tap";
import { open } from "@/lib/auth/sealed-cookie";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isGoogleConnectEnabled } from "@/lib/tools/traffic-drop-session";

export const runtime = "nodejs";

/** A credential is a JWT; anything much larger is not one. */
const MAX_CREDENTIAL_BYTES = 8 * 1024;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Complete a One Tap sign-in.
 *
 * Two independent checks admit the credential, and both must pass:
 *
 *  1. The nonce binds the token to the page load that requested it, so a token
 *     captured from another visitor cannot be replayed here (see one-tap.ts).
 *  2. Supabase verifies the signature, issuer, audience and expiry against
 *     Google's keys. That is the check that actually authenticates; ours only
 *     rejects replays cheaply before the network round trip.
 *
 * Failures answer with a generic message. The caller is a browser that can only
 * retry, and distinguishing "your nonce is stale" from "that signature is
 * invalid" tells an attacker which half of the pairing they still need.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isGoogleConnectEnabled()) {
    return json({ error: "unavailable" }, 404);
  }

  let credential: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_CREDENTIAL_BYTES) {
      return json({ error: "invalid" }, 413);
    }
    credential = (JSON.parse(raw) as { credential?: unknown }).credential;
  } catch {
    return json({ error: "invalid" }, 400);
  }

  if (typeof credential !== "string" || credential === "") {
    return json({ error: "invalid" }, 400);
  }

  const jar = await cookies();
  const sealedNonce = open<string>(
    "gg_onetap",
    jar.get("gg_onetap")?.value,
  );

  const rejection = screenCredential({ credential, sealedNonce });
  if (rejection) {
    return json({ error: "invalid" }, 401);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: credential,
    // Supabase compares this against the token's nonce claim itself. Passing it
    // means the provider-side check runs too, rather than trusting ours alone.
    nonce: sealedNonce ?? undefined,
  });

  if (error) {
    return json({ error: "invalid" }, 401);
  }

  // One nonce, one sign-in. Clearing it means a captured credential cannot be
  // replayed even from the browser that legitimately obtained it.
  jar.delete("gg_onetap");

  return json({ ok: true }, 200);
}
