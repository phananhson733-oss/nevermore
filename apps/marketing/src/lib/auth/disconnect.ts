// @input  -- a cookie jar, a clock, and a way to revoke a token at Google
// @output -- the grant revoked at Google where possible, and cleared from the browser always
// @pos    -- the behaviour behind /api/auth/google/logout, kept out of the transport
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  cookieAttributes,
  open,
  type SealedCookiePurpose,
} from "./sealed-cookie.ts";
import type { StoredGrant } from "./grant-cookie.ts";

/** Read and clear only. Disconnecting never writes a cookie. */
export interface DisconnectCookieJar {
  read(name: SealedCookiePurpose): string | undefined;
  clear(name: SealedCookiePurpose, path: string): void;
}

export interface DisconnectResult {
  /**
   * Whether Google confirmed the revocation.
   *
   * `null` means there was nothing to revoke — no credential was held — which
   * is not the same as a revocation that failed. The UI says different things
   * about the two, and saying "revoked" when we could not reach Google would be
   * the one claim a visitor cannot check.
   */
  readonly revokedAtGoogle: boolean | null;
}

/**
 * The token to revoke for a stored grant, or null when it holds none.
 *
 * The refresh token first: revoking it kills the whole grant including the
 * access tokens derived from it, while revoking an access token leaves the
 * refresh token alive — a disconnect that did not disconnect.
 *
 * Shared with the OAuth callback, which revokes the grant an arriving account
 * SUPERSEDES. Revocation at Google is per client+user, so there it is safe only
 * for a grant whose subject is KNOWN and differs from the one authorizing —
 * `decideSupersededGrant` is what decides that, and an unreadable subject on
 * either side is not evidence of a different account. Revoking the same
 * account's grant would kill the credential that request just issued.
 */
export function revocableGrantToken(
  grant: Pick<StoredGrant, "accessToken" | "refreshToken"> | null | undefined,
): string | null {
  if (!grant) return null;
  if (typeof grant.refreshToken === "string" && grant.refreshToken !== "") {
    return grant.refreshToken;
  }
  if (typeof grant.accessToken === "string" && grant.accessToken !== "") {
    return grant.accessToken;
  }
  return null;
}

/** Every cookie this site sets, with the path it was set at. */
const OWNED_COOKIES: readonly SealedCookiePurpose[] = [
  "gg_id",
  "gg_gsc",
  "gg_sites",
  "gg_oauth_tx",
];

/**
 * Disconnect: revoke at Google, then clear locally whatever happened.
 *
 * The local clear is unconditional on purpose. A refresh token now lives in the
 * visitor's browser for weeks, so leaving it there because Google was
 * unreachable would be strictly worse than a grant that outlives our cookie.
 */
export async function disconnectGoogleGrant(input: {
  readonly jar: DisconnectCookieJar;
  readonly now: () => number;
  readonly revoke: (token: string) => Promise<boolean>;
}): Promise<DisconnectResult> {
  const { jar, now } = input;
  const raw = jar.read("gg_gsc");
  const stored = readStoredGrant(raw, now);
  const token = revocableGrantToken(stored);

  // A cookie that is present but unreadable — a rotated root key, an expired
  // envelope — is a grant that may still be live at Google and that we cannot
  // reach. Reporting `null` there would tell the visitor nothing was held,
  // which is the one thing we know to be false.
  let revokedAtGoogle: boolean | null =
    token === null && raw !== undefined && raw !== "" ? false : null;
  if (token !== null) {
    try {
      revokedAtGoogle = await input.revoke(token);
    } catch {
      // Never logged: the provider body can echo the token itself.
      revokedAtGoogle = false;
    }
  }

  for (const name of OWNED_COOKIES) {
    // The path comes from the same function that wrote it. `gg_gsc` lives at
    // /api, and a Set-Cookie at / does not match it — a delete without the
    // explicit path leaves the credential in the browser and reports success.
    jar.clear(name, cookieAttributes(name, 0).path);
  }

  return { revokedAtGoogle };
}

/**
 * Read the grant, or answer null.
 *
 * `open` throws when the ROOT KEY cannot be built, which is deliberate
 * everywhere else — a deployment that reads every cookie as absent must not
 * look like a visitor who has none. Disconnecting is the exception: clearing
 * the browser needs no key, and it is the operation a visitor holding an
 * unreadable credential needs most.
 */
function readStoredGrant(
  raw: string | undefined,
  now: () => number,
): StoredGrant | null {
  try {
    return open<StoredGrant>("gg_gsc", raw, now);
  } catch {
    return null;
  }
}

/**
 * Reject a cross-site POST.
 *
 * A browser omits `Origin` on some same-origin requests, so its absence cannot
 * be treated as an attack — but when it is present and belongs to someone else,
 * this is a forced disconnect that costs the visitor their Google grant and
 * cannot be undone by coming back.
 */
export function isSameOriginPost(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
