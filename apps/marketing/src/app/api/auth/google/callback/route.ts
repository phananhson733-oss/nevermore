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
import {
  cookieAttributes,
  MAX_SEALED_VALUE_BYTES,
  open,
  seal,
  sealedByteLength,
} from "@/lib/auth/sealed-cookie";
import { isGoogleConnectEnabled } from "@/lib/tools/traffic-drop-session";

export const runtime = "nodejs";

/** Identity outlives one visit; the access token does not. */
const IDENTITY_TTL_SECONDS = 30 * 24 * 60 * 60;
/**
 * The grant cookie never outlives the token inside it. With access_type=online
 * there is no refresh token, so when this expires the visitor authorizes again.
 */
const GRANT_SAFETY_MARGIN_SECONDS = 60;

/**
 * Seal as many properties as fit in one cookie, and record how many there were.
 *
 * An account with a hundred Search Console properties seals to well over the
 * ~4096 bytes a browser will store, and the browser discards the whole cookie
 * without telling anyone. The visitor authorizes, Google redirects them back,
 * and the page — unable to read a cookie that was never stored — shows them
 * the connect button again. That is the same dead end the `gg_gsc`/`gg_sites`
 * split was made to fix, reappearing for exactly the multi-site and agency
 * accounts this tool is for.
 *
 * So the list is fitted to the budget and the FULL count travels with it. A
 * truncated list the page knows is truncated can be described honestly; a
 * truncated list that claims to be complete cannot.
 */
function sealPropertiesWithinBudget(
  properties: readonly string[],
  ttlSeconds: number,
): { readonly value: string; readonly shown: number } {
  let fitted = properties;
  let value = seal(
    "gg_sites",
    { properties: fitted, total: properties.length },
    ttlSeconds,
  );

  // Drop from the end until it fits. Linear rather than clever: the list is at
  // most a few hundred entries and this runs once per authorization.
  while (
    fitted.length > 0 &&
    sealedByteLength(value) > MAX_SEALED_VALUE_BYTES
  ) {
    fitted = fitted.slice(0, fitted.length - 1);
    value = seal(
      "gg_sites",
      { properties: fitted, total: properties.length },
      ttlSeconds,
    );
  }

  return { value, shown: fitted.length };
}

interface Transaction {
  readonly state: string;
  readonly codeVerifier: string;
  readonly next: string;
  readonly includeSearchConsole: boolean;
}

/**
 * Redirect back into this site, and only into this site.
 *
 * The origin of the RESOLVED url is what decides, not the shape of the string
 * that produced it. `next` is validated at `/api/auth/google/start` before it
 * is sealed, but it is consumed here, a redirect away and out of a cookie — so
 * it is re-checked at the point of use. The first gate can only reason about
 * what a path looks like; this one asks the URL parser where the value
 * actually goes, which is the question that matters.
 */
function backTo(request: Request, path: string, error?: string): Response {
  const origin = new URL(request.url).origin;
  let target: URL;
  try {
    target = new URL(path, origin);
  } catch {
    target = new URL("/", origin);
  }
  if (target.origin !== origin) target = new URL("/", origin);
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
  const transaction = open<Transaction>(
    "gg_oauth_tx",
    jar.get("gg_oauth_tx")?.value,
  );
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
        seal(
          "gg_id",
          { sub: tokens.sub, email: tokens.email },
          IDENTITY_TTL_SECONDS,
        ),
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
      // Token at /api, property list at /. The page renders the picker, the
      // route handler does the reading — and a cookie scoped to /api is not
      // sent with a page request, so keeping both in one cookie left the page
      // unable to see the grant its own visitor had just completed.
      jar.set(
        "gg_gsc",
        seal("gg_gsc", { accessToken: tokens.accessToken }, ttl),
        cookieAttributes("gg_gsc", ttl),
      );
      jar.set(
        "gg_sites",
        sealPropertiesWithinBudget(properties, ttl).value,
        cookieAttributes("gg_sites", ttl),
      );
    }

    return backTo(request, transaction.next);
  } catch {
    // Provider bodies can contain the code or client secret; nothing is logged
    // or echoed, and the visitor gets a stable code instead.
    return backTo(request, transaction.next, "exchange_failed");
  }
}
