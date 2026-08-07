// @input  -- Google's redirect carrying code + state, and the sealed transaction cookie
// @output -- identity and (optionally) Search Console grant cookies, then a redirect back
// @pos    -- the only place a Google authorization code is exchanged
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { cookies } from "next/headers";
import { after } from "next/server";
import { revocableGrantToken } from "@/lib/auth/disconnect";
import {
  exchangeCode,
  hasSearchConsoleScope,
  listSearchConsoleProperties,
  readGoogleOAuthConfig,
  revokeToken,
  stateMatches,
} from "@/lib/auth/google-oauth";
import {
  clearGrantCookies,
  GRANT_TTL_SECONDS,
  IDENTITY_TTL_SECONDS,
  sealGrantProperties,
  sealGrantWithinBudget,
  type GrantCookieJar,
  type StoredGrant,
} from "@/lib/auth/grant-cookie";
import {
  assertCookieSecretConfigured,
  cookieAttributes,
  open,
  seal,
  SealedCookieError,
} from "@/lib/auth/sealed-cookie";
import { decideSupersededGrant } from "@/lib/auth/superseded-grant";
import { isGoogleConnectEnabled } from "@/lib/tools/traffic-drop-session";

export const runtime = "nodejs";

/**
 * Fallback lifetime when Google issued no refresh token.
 *
 * The grant cookie then never outlives the token inside it, exactly as it did
 * before offline access: when it expires the visitor authorizes again. Google
 * withholds the refresh token whenever the user was not actually re-prompted,
 * so this path is reachable and must degrade rather than promise persistence it
 * does not have.
 */
const GRANT_SAFETY_MARGIN_SECONDS = 60;

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

/**
 * Revoke the grant this authorization supersedes, after the response.
 *
 * Clearing the cookies only forgets the credential: the refresh token stays
 * live at Google for months, on an account that has just been replaced in this
 * browser. The disconnect control revokes for exactly this reason, and the
 * reasoning does not change because the visitor arrived here instead.
 *
 * Never awaited inside the redirect. A slow or failing revoke endpoint must not
 * delay a sign-in that has already succeeded, and there is no one left to
 * report a failure to. `after` is what keeps the work alive on a runtime that
 * would otherwise stop executing the moment the redirect is returned — a bare
 * floating promise there is dropped, not deferred.
 *
 * Called only for a grant whose subject is KNOWN and differs from the subject
 * that just authorized; `decideSupersededGrant` is what establishes that, and
 * an unreadable subject on either side never reaches here. Revocation at Google
 * is per client+user, so revoking a grant that in fact belongs to the account
 * authorizing right now would kill the credential this request just issued.
 */
function revokeSupersededGrant(held: StoredGrant): void {
  const token = revocableGrantToken(held);
  if (token === null) return;
  after(() => revokeToken({ token }));
}

export async function GET(request: Request): Promise<Response> {
  if (!isGoogleConnectEnabled()) {
    return new Response("Google sign-in is not enabled on this site.", {
      status: 404,
    });
  }

  try {
    // Before a single cookie is opened. A root key that cannot be built reads
    // every sealed cookie as absent, so without this the symptom is "the
    // transaction expired" on every authorization, forever, with nothing
    // naming the variable that is wrong.
    assertCookieSecretConfigured();
  } catch (error) {
    if (!(error instanceof SealedCookieError)) throw error;
    // The message names an environment variable, which is the operator's
    // business and not the visitor's.
    console.error("[auth/callback] cookie secret unusable:", error.message);
    return new Response("Google sign-in is misconfigured on this site.", {
      status: 503,
    });
  }

  const jar = await cookies();
  // The explicit path matters: `gg_gsc` lives at /api and a Set-Cookie at /
  // does not match it, so a delete without it reports success and leaves the
  // credential in the browser.
  const grantJar: Pick<GrantCookieJar, "clear"> = {
    clear: (name, path) => jar.delete({ name, path }),
  };
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

    // Drop a grant belonging to anyone but the account that just authorized —
    // BEFORE the identity cookie is written, so the two can never name
    // different people. Without this, A connects, B signs in on the same
    // browser, and A's refresh token stays the credential every Search Console
    // read is made with while the site displays B.
    //
    // The two effects are decided apart, because they are not equally cheap to
    // get wrong: a grant whose subject cannot be READ on both sides is cleared
    // from this browser and left alone at Google. `decideSupersededGrant`
    // carries the reasoning and the tests.
    const held = open<StoredGrant>("gg_gsc", jar.get("gg_gsc")?.value);
    if (held) {
      const action = decideSupersededGrant({
        heldSub: held.sub,
        authorizingSub: tokens.sub,
      });
      if (action !== "keep") clearGrantCookies(grantJar);
      if (action === "clear_and_revoke") revokeSupersededGrant(held);
    }

    if (tokens.sub) {
      // Identity carries the subject only — never a token. This cookie is
      // readable on page requests, so nothing sensitive may live in it. Its
      // lifetime is the grant's absolute cap, stamped in this same request:
      // `resolveGrant` refuses a grant whose identity is missing, which it can
      // only do because this cookie cannot expire first.
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
      if (!tokens.sub) {
        // Nothing to bind this credential to, and `resolveGrant` refuses a
        // grant it cannot bind — so sealing this one would hand the visitor a
        // 30-day cookie that is dropped on their very next request, with the
        // page offering "connect" again and nothing anywhere saying why.
        // Google returns `sub` for the `openid` scope this flow always asks
        // for, so reaching here means the id_token did not parse.
        console.error(
          "[auth/callback] token set carried no subject; not storing a grant no request could use",
        );
        return backTo(request, transaction.next, "identity_missing");
      }
      const properties = await listSearchConsoleProperties({
        accessToken: tokens.accessToken,
      });
      // With a refresh token the grant outlives its access token and both
      // cookies carry the same long life. Without one they stay bound to the
      // token, which is the pre-offline behaviour.
      const ttl = tokens.refreshToken
        ? GRANT_TTL_SECONDS
        : Math.max(60, tokens.expiresInSeconds - GRANT_SAFETY_MARGIN_SECONDS);
      const nowSeconds = Math.floor(Date.now() / 1000);
      const grant: StoredGrant = {
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: nowSeconds + tokens.expiresInSeconds,
        // `grantedAt` is what the absolute cap is measured against, so it is
        // stamped once here and never again.
        grantedAt: nowSeconds,
        ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
        // Whose grant this is. Not optional here, whatever the type says: every
        // later request requires it to equal the identity cookie, so a grant
        // sealed without one is a grant nothing can use.
        sub: tokens.sub,
      };
      const sealedGrant = sealGrantWithinBudget(grant, ttl);
      if (sealedGrant === null) {
        // An over-budget Set-Cookie is discarded by the browser without a word
        // to the server or the page, so "authorized" and "silently dropped"
        // would look identical to the visitor. Saying so costs one redirect
        // parameter and is the difference between a bug report and a mystery.
        console.error(
          "[auth/callback] grant exceeds the cookie budget; not storing it",
        );
        clearGrantCookies(grantJar);
        return backTo(request, transaction.next, "grant_too_large");
      }
      // Token at /api, property list at /. The page renders the picker, the
      // route handler does the reading — and a cookie scoped to /api is not
      // sent with a page request, so keeping both in one cookie left the page
      // unable to see the grant its own visitor had just completed.
      //
      // Both cookies get the SAME ttl: the page decides "connected" from
      // `gg_sites` alone, so a long-lived token behind a short-lived site list
      // would still show the connect button.
      jar.set("gg_gsc", sealedGrant, cookieAttributes("gg_gsc", ttl));
      jar.set(
        "gg_sites",
        sealGrantProperties(properties, ttl).value,
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
