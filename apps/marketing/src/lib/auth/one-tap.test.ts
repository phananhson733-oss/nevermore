import { describe, expect, it } from "vitest";

import { createHash } from "node:crypto";

import {
  createOneTapNonce,
  hashNonce,
  isOneTapEnabled,
  nonceMatches,
  readUnverifiedClaims,
  screenCredential,
} from "./one-tap.ts";

/**
 * One Tap replay binding.
 *
 * The property under test is that holding a valid Google id_token is not enough
 * to complete a sign-in: the exchange also needs the raw nonce, which only ever
 * lives in a sealed HttpOnly cookie belonging to the browser that asked for the
 * token. Every case here is written from an attacker's position.
 */

function credential(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "RS256" })}.${encode(claims)}.signature-not-checked-here`;
}

describe("hashNonce encoding", () => {
  /**
   * This encoding is a contract with GoTrue, not a local choice.
   *
   * GoTrue verifies One Tap by computing `fmt.Sprintf("%x", sha256.Sum256(raw))`
   * and comparing it to the nonce claim Google echoed from what we gave GSI.
   * A base64url digest can never match that, so the feature fails closed with a
   * 401 on every attempt and looks simply "broken" rather than misconfigured.
   * Asserting the exact bytes is what makes that a test failure instead of a
   * production mystery — every behavioural test below passes under either
   * encoding.
   */
  it("is lowercase hex, because GoTrue compares against %x of the raw nonce", () => {
    const hashed = hashNonce("known-input");

    expect(hashed).toBe(
      createHash("sha256").update("known-input").digest("hex"),
    );
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isOneTapEnabled", () => {
  it("is off when no browser client id is configured", () => {
    expect(isOneTapEnabled({})).toBe(false);
    expect(isOneTapEnabled({ NEXT_PUBLIC_GOOGLE_CLIENT_ID: "  " })).toBe(false);
  });

  it("is on when the client id is present", () => {
    expect(
      isOneTapEnabled({
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: "abc.apps.googleusercontent.com",
      }),
    ).toBe(true);
  });

  it("does not depend on the Search Console connector flag", () => {
    // Sign-in must not be coupled to an unrelated sensitive-scope data grant:
    // GSC off is the expected state, and it used to 404 One Tap entirely.
    expect(
      isOneTapEnabled({
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: "abc.apps.googleusercontent.com",
        MARKETING_GSC_CONNECT_ENABLED: "false",
      }),
    ).toBe(true);
  });
});

describe("createOneTapNonce", () => {
  it("hands GSI the hash and keeps the raw value back", () => {
    const nonce = createOneTapNonce();

    expect(nonce.hashed).toBe(hashNonce(nonce.raw));
    expect(nonce.hashed).not.toBe(nonce.raw);
  });

  it("never repeats", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => createOneTapNonce().raw),
    );
    expect(seen.size).toBe(50);
  });
});

describe("nonceMatches", () => {
  it("accepts an exact match and rejects everything else", () => {
    expect(nonceMatches("abc", "abc")).toBe(true);
    expect(nonceMatches("abc", "abd")).toBe(false);
    // Length differences must not throw — timingSafeEqual does on mismatch.
    expect(nonceMatches("abc", "abcd")).toBe(false);
    expect(nonceMatches("", "abc")).toBe(false);
  });
});

describe("readUnverifiedClaims", () => {
  it("reads a payload without asserting anything about the signature", () => {
    expect(readUnverifiedClaims(credential({ nonce: "n1" }))).toEqual({
      nonce: "n1",
    });
  });

  it.each(["", "not-a-jwt", "only.two", "a..c", "a.%%%.c"])(
    "returns null for the unparseable credential %p",
    (raw) => {
      expect(readUnverifiedClaims(raw)).toBeNull();
    },
  );

  it("returns null when the payload is not an object", () => {
    const encoded = Buffer.from(JSON.stringify("a string"), "utf8").toString(
      "base64url",
    );
    expect(readUnverifiedClaims(`h.${encoded}.s`)).toBeNull();
  });
});

describe("screenCredential", () => {
  it("passes a credential whose nonce matches the sealed one", () => {
    const nonce = createOneTapNonce();

    expect(
      screenCredential({
        credential: credential({ nonce: nonce.hashed }),
        sealedNonce: nonce.raw,
      }),
    ).toBeNull();
  });

  it("rejects a token captured from another visitor", () => {
    // The attacker holds a perfectly valid token minted for someone else's
    // page load, and their own cookie carries a different nonce.
    const victim = createOneTapNonce();
    const attacker = createOneTapNonce();

    expect(
      screenCredential({
        credential: credential({ nonce: victim.hashed }),
        sealedNonce: attacker.raw,
      }),
    ).toBe("nonce_mismatch");
  });

  it("rejects a token replayed without any cookie at all", () => {
    const nonce = createOneTapNonce();

    expect(
      screenCredential({
        credential: credential({ nonce: nonce.hashed }),
        sealedNonce: null,
      }),
    ).toBe("nonce_missing");
  });

  it("rejects a token that carries no nonce claim", () => {
    const nonce = createOneTapNonce();

    expect(
      screenCredential({
        credential: credential({ sub: "123" }),
        sealedNonce: nonce.raw,
      }),
    ).toBe("nonce_missing");
  });

  it("rejects a credential that presents the RAW nonce instead of its hash", () => {
    // Someone who learned the raw nonce still cannot mint a token Google would
    // sign, but the pairing must be hash-side regardless: accepting the raw
    // value here would mean the cookie and the token carry the same secret.
    const nonce = createOneTapNonce();

    expect(
      screenCredential({
        credential: credential({ nonce: nonce.raw }),
        sealedNonce: nonce.raw,
      }),
    ).toBe("nonce_mismatch");
  });

  it("rejects a malformed credential before looking at the cookie", () => {
    expect(screenCredential({ credential: "garbage", sealedNonce: null })).toBe(
      "malformed_credential",
    );
  });
});
