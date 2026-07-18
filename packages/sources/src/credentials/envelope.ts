/**
 * OAuth credential envelope (spec §14.3). Google issues a refresh token only ONCE
 * — on the first consent (`prompt=consent`, `access_type=offline`). Persisting only
 * the access token discards it, so a connection dies ~1h later with no way to
 * re-obtain the refresh token short of forcing re-consent. This module serializes
 * the full token set (access + refresh + expiry + scope) into the plaintext that
 * the AES-256-GCM layer (`encryptCredential`) then encrypts.
 *
 * Pure: no crypto, no env, no I/O. The ciphertext version lives in `crypto.ts`;
 * this is the plaintext SHAPE version, bumped independently when fields change.
 */

/** The decrypted credential payload stored for a connected GSC/GA4 source. */
export interface OAuthCredentialEnvelope {
  readonly accessToken: string;
  /** Present only when Google returned one (first consent); else `null`. */
  readonly refreshToken: string | null;
  /** Access-token expiry (RFC3339), or `null` when unknown (§1.3: never faked). */
  readonly expiresAt: string | null;
  /** Space-delimited granted scopes, or "" when unknown. */
  readonly scope: string;
}

/** Plaintext envelope shape version. Bump when the field set changes. */
export const CREDENTIAL_ENVELOPE_VERSION = 1;

/** Serialize an envelope to the plaintext that `encryptCredential` will encrypt. */
export function encodeCredentialEnvelope(
  envelope: OAuthCredentialEnvelope,
): string {
  return JSON.stringify({
    v: CREDENTIAL_ENVELOPE_VERSION,
    accessToken: envelope.accessToken,
    refreshToken: envelope.refreshToken,
    expiresAt: envelope.expiresAt,
    scope: envelope.scope,
  });
}

/**
 * Decode a decrypted credential plaintext into an envelope. TOLERANT by design:
 * a v1 JSON envelope yields the full record; a legacy bare access-token string
 * (pre-envelope credentials, or a hand-seeded token) yields an envelope carrying
 * only that access token. Never throws on shape — a stored credential must stay
 * usable across the format change.
 */
export function decodeCredentialEnvelope(
  plaintext: string,
): OAuthCredentialEnvelope {
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { accessToken?: unknown }).accessToken === "string"
    ) {
      const p = parsed as Record<string, unknown>;
      return {
        accessToken: p["accessToken"] as string,
        refreshToken:
          typeof p["refreshToken"] === "string"
            ? (p["refreshToken"] as string)
            : null,
        expiresAt:
          typeof p["expiresAt"] === "string" ? (p["expiresAt"] as string) : null,
        scope: typeof p["scope"] === "string" ? (p["scope"] as string) : "",
      };
    }
  } catch {
    // Not JSON — treat the whole plaintext as a legacy bare access token.
  }
  return { accessToken: plaintext, refreshToken: null, expiresAt: null, scope: "" };
}
