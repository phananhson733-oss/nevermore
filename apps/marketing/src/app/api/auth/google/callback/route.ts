// @input  -- Google's redirect carrying code + state, and the sealed transaction cookie
// @output -- identity and (optionally) Search Console grant cookies, then a redirect back
// @pos    -- the only place a Google authorization code is exchanged
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { cookies } from "next/headers";
import {
  exchangeCode,
  hasSearchConsoleScope,
  listSearchConsoleProperties,
  readGoogleOAuthConfig,
  stateMatches,
} from "@/lib/auth/google-oauth";
import { cookieAttributes, open, seal } from "@/lib/auth/sealed-cookie";
import { isGoogleConnectEnabled } from "@/lib/tools/traffic-drop-session";

export const runtime = "nodejs";

/** Identity outlives one visit; the access token does not. */
const IDENTITY_TTL_SECONDS = 30 * 24 * 60 * 60;
/**
 * The grant cookie never outlives the token inside it. With access_type=online
 * there is no refresh token, so when this expires the visitor authorizes again.
 */
const GRANT_SAFETY_MARGIN_SECONDS = 60;

interface Transaction {
  readonly state: string;
  readonly codeVerifier: string;
  readonly next: string;
  readonly includeSearchConsole: boolean;
}

function backTo(request: Request, path: string, error?: string): Response {
  const target = new URL(path, new URL(request.url).origin);
  if (error) target.searchParams.set("auth_error", error);
  return Response.redirect(target.toString(), 302);
}

export async function GET(request: Request): Promise<Response> {
  if (!isGoogleConnectEnabled()) {
    return new Response("Google sign-in is not enabled on this site.", {
      status: 404,
    });
  }

  const jar = await cookies();
  const transaction = open<Transaction>("gg_oauth_tx", jar.get("gg_oauth_tx")?.value);
  // The transaction cookie is single-use: consumed here whether or not the rest
  // of the flow succeeds, so a code cannot be replayed against it.
  jar.delete("gg_oauth_tx");

  if (!transaction) return backTo(request, "/", "expired");

  const url = new URL(request.url);
  const returned = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  if (url.searchParams.get("error")) {
    return backTo(request, transaction.next, "declined");
  }
  if (!returned || !code || !stateMatches(returned, transaction.state)) {
    return backTo(request, transaction.next, "state_mismatch");
  }

  try {
    const config = readGoogleOAuthConfig();
    const tokens = await exchangeCode({
      config,
      code,
      codeVerifier: transaction.codeVerifier,
    });

    if (tokens.sub) {
      // Identity carries the subject only — never a token. This cookie is
      // readable on page requests, so nothing sensitive may live in it.
      jar.set(
        "gg_id",
        seal("gg_id", { sub: tokens.sub, email: tokens.email }, IDENTITY_TTL_SECONDS),
        cookieAttributes("gg_id", IDENTITY_TTL_SECONDS),
      );
    }

    if (transaction.includeSearchConsole) {
      if (!hasSearchConsoleScope(tokens.grantedScopes)) {
        // Signed in, but the Search Console box was left unchecked.
        return backTo(request, transaction.next, "gsc_not_granted");
      }
      const properties = await listSearchConsoleProperties({
        accessToken: tokens.accessToken,
      });
      const ttl = Math.max(
        60,
        tokens.expiresInSeconds - GRANT_SAFETY_MARGIN_SECONDS,
      );
      jar.set(
        "gg_gsc",
        seal("gg_gsc", { accessToken: tokens.accessToken, properties }, ttl),
        cookieAttributes("gg_gsc", ttl),
      );
    }

    return backTo(request, transaction.next);
  } catch {
    // Provider bodies can contain the code or client secret; nothing is logged
    // or echoed, and the visitor gets a stable code instead.
    return backTo(request, transaction.next, "exchange_failed");
  }
}
