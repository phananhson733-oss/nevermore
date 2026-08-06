// @input  -- a Google One Tap credential, the nonce sealed at page render
// @output -- nonce material for GSI, and a verified decision about a credential
// @pos    -- the marketing site's One Tap entry into the shared Supabase session
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * One Tap nonce handling.
 *
 * Google One Tap hands the browser an id_token. Anything the browser can hold,
 * an attacker can replay: a token captured from one visitor can be posted from
 * another session unless the token is bound to the exact page load that asked
 * for it. The nonce is that binding.
 *
 * The pairing is deliberate and asymmetric: GSI is initialised with the SHA-256
 * HASH of the nonce, Google echoes that hash inside the signed id_token, and the
 * raw nonce never leaves the server-side cookie. So possessing the token is not
 * enough — completing the exchange also requires the cookie from the same
 * browser, which an attacker holding only a stolen token does not have.
 */

/** Short by design: it covers one page view's worth of sign-in intent. */
export const NONCE_TTL_SECONDS = 600;

/**
 * One Tap's own switch.
 *
 * Deliberately NOT `isGoogleConnectEnabled()`, which gates the Search Console
 * connector — a sensitive-scope data feature that is off by default. Sharing
 * that flag couples an authentication surface to an unrelated data grant in
 * both directions: One Tap silently 404s wherever GSC is off (the expected
 * state, and what the deployment doc's own instructions produce), and turning
 * GSC on would quietly enable a sign-in surface nobody asked for.
 *
 * Sign-in needs a browser-visible client id anyway, so its presence IS the
 * configuration. Absent means One Tap does not prompt — see google-one-tap.tsx,
 * which treats "no prompt" as a normal outcome rather than an error.
 */
export function isOneTapEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const clientId = env["NEXT_PUBLIC_GOOGLE_CLIENT_ID"];
  return typeof clientId === "string" && clientId.trim() !== "";
}

export interface OneTapNonce {
  /** Kept server-side, sealed into a cookie. Never rendered. */
  readonly raw: string;
  /** Handed to GSI and echoed inside the signed id_token. Safe to render. */
  readonly hashed: string;
}

export function createOneTapNonce(): OneTapNonce {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hashed: hashNonce(raw) };
}

/**
 * Lowercase hex, not base64url.
 *
 * This encoding is not ours to choose. GoTrue verifies One Tap by computing
 * `fmt.Sprintf("%x", sha256.Sum256(nonce))` over the raw nonce we hand
 * `signInWithIdToken` and comparing it to the `nonce` claim Google echoed from
 * what we gave GSI. Hand GSI a base64url digest and that comparison can never
 * match — every One Tap sign-in fails closed with a 401 and the feature simply
 * never works. Supabase's own One Tap recipe hashes with
 * `b.toString(16).padStart(2, "0")` for exactly this reason.
 */
export function hashNonce(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Constant-time comparison. A timing signal on a nonce is a replay oracle, the
 * same reason `stateMatches` in google-oauth.ts is written this way.
 */
export function nonceMatches(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * A JWT's payload without verifying its signature.
 *
 * This is used ONLY to read the nonce claim so we can reject an obvious replay
 * before spending a network round trip on Supabase. It is not a trust decision:
 * Supabase verifies the signature, the issuer, the audience and the expiry
 * against Google's keys, and that verification is what actually admits the
 * token. Treat everything this returns as attacker-controlled.
 */
export function readUnverifiedClaims(
  credential: string,
): Record<string, unknown> | null {
  const payload = credential.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as unknown;
    return typeof decoded === "object" && decoded !== null
      ? (decoded as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export type OneTapRejection =
  | "malformed_credential"
  | "nonce_missing"
  | "nonce_mismatch";

/**
 * Decide whether a credential is worth handing to Supabase.
 *
 * Returns the rejection reason or null when the credential should proceed. This
 * is a pre-check, never the authorization: a credential that passes here is
 * still only admitted if Supabase verifies its signature.
 */
export function screenCredential(input: {
  readonly credential: string;
  readonly sealedNonce: string | null;
}): OneTapRejection | null {
  const claims = readUnverifiedClaims(input.credential);
  if (!claims) return "malformed_credential";
  if (!input.sealedNonce) return "nonce_missing";

  const presented = claims["nonce"];
  if (typeof presented !== "string") return "nonce_missing";

  return nonceMatches(presented, hashNonce(input.sealedNonce))
    ? null
    : "nonce_mismatch";
}
