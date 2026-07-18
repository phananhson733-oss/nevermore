import { describe, expect, it } from "vitest";
import {
  encodeCredentialEnvelope,
  decodeCredentialEnvelope,
  type OAuthCredentialEnvelope,
} from "./envelope.ts";

/**
 * Spec §14.3: the credential envelope must round-trip the FULL token set (so the
 * once-issued refresh token and real expiry survive) while staying tolerant of a
 * legacy bare access-token plaintext (pre-envelope credentials must still work).
 */
describe("credential envelope", () => {
  it("round-trips a full envelope", () => {
    const env: OAuthCredentialEnvelope = {
      accessToken: "ya29.fake-access",
      refreshToken: "1//fake-refresh",
      expiresAt: "2026-07-18T12:00:00.000Z",
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
    };
    expect(decodeCredentialEnvelope(encodeCredentialEnvelope(env))).toEqual(env);
  });

  it("preserves a null refresh token and expiry (never fabricated)", () => {
    const env: OAuthCredentialEnvelope = {
      accessToken: "ya29.only-access",
      refreshToken: null,
      expiresAt: null,
      scope: "",
    };
    expect(decodeCredentialEnvelope(encodeCredentialEnvelope(env))).toEqual(env);
  });

  it("decodes a legacy bare access-token string (backward compatible)", () => {
    expect(decodeCredentialEnvelope("legacy-bare-token")).toEqual({
      accessToken: "legacy-bare-token",
      refreshToken: null,
      expiresAt: null,
      scope: "",
    });
  });

  it("treats non-envelope JSON as a legacy bare token, never throwing", () => {
    // A JSON array or an object without accessToken falls back to legacy handling.
    expect(decodeCredentialEnvelope("[1,2,3]").accessToken).toBe("[1,2,3]");
    expect(decodeCredentialEnvelope('{"foo":1}').accessToken).toBe('{"foo":1}');
  });
});
