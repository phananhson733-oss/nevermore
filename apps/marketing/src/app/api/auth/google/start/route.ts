// @input  -- GET with optional scope=gsc and a same-origin next path
// @output -- redirect to Google, with the PKCE transaction sealed into a cookie
// @pos    -- entry point of the marketing site's Google authorization flow
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { cookies } from "next/headers";
import {
  buildAuthUrl,
  codeChallengeS256,
  generateCodeVerifier,
  generateState,
  GoogleOAuthError,
  readGoogleOAuthConfig,
} from "@/lib/auth/google-oauth";
import { safeNextPath } from "@/lib/auth/next-path";
import { cookieAttributes, seal } from "@/lib/auth/sealed-cookie";
import { isGoogleConnectEnabled } from "@/lib/tools/traffic-drop-session";

export const runtime = "nodejs";

/** A transaction is short-lived by design: it covers one round trip to Google. */
const TRANSACTION_TTL_SECONDS = 600;

export async function GET(request: Request): Promise<Response> {
  if (!isGoogleConnectEnabled()) {
    return new Response("Google sign-in is not enabled on this site.", {
      status: 404,
    });
  }

  let config;
  try {
    config = readGoogleOAuthConfig();
  } catch (error) {
    if (error instanceof GoogleOAuthError) {
      return new Response("Google sign-in is not configured.", { status: 503 });
    }
    throw error;
  }

  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const includeSearchConsole = url.searchParams.get("scope") === "gsc";

  const state = generateState();
  const codeVerifier = generateCodeVerifier();

  const jar = await cookies();
  jar.set(
    "gg_oauth_tx",
    seal(
      "gg_oauth_tx",
      { state, codeVerifier, next, includeSearchConsole },
      TRANSACTION_TTL_SECONDS,
    ),
    cookieAttributes("gg_oauth_tx", TRANSACTION_TTL_SECONDS),
  );

  return Response.redirect(
    buildAuthUrl({
      config,
      state,
      codeChallenge: codeChallengeS256(codeVerifier),
      includeSearchConsole,
    }),
    302,
  );
}
