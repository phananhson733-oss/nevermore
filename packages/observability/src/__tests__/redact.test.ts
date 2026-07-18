import { describe, expect, it } from "vitest";

import { REDACT_KEYS, redact, redactUrl } from "../redact.ts";

/**
 * AC-040: deep redaction must strip every mandated secret key from any structured
 * value bound for logs / telemetry / export bundles. The set below is the minimum
 * required by CLAUDE.md (spec §14.3); `REDACT_KEYS` may be a superset.
 */
const REQUIRED_KEYS = [
  "authorization",
  "token",
  "access_token",
  "refresh_token",
  "client_secret",
  "cookie",
  "set-cookie",
  "api_key",
] as const;

const REDACTED = "[redacted]";
// Obviously-fake credential values (secrets:scan must never flag these).
const FAKE = "Bearer FAKE-not-a-real-token";

describe("REDACT_KEYS coverage", () => {
  it("includes every mandated secret key (spec §14.3)", () => {
    for (const key of REQUIRED_KEYS) {
      expect(REDACT_KEYS.has(key)).toBe(true);
    }
  });
});

describe("redact deep key redaction", () => {
  it("redacts each required key at the top level, case-insensitively", () => {
    for (const key of REQUIRED_KEYS) {
      const upper = key.toUpperCase();
      const result = redact({ [upper]: FAKE, keep: "visible" }) as Record<string, unknown>;
      expect(result[upper]).toBe(REDACTED);
      expect(result["keep"]).toBe("visible");
    }
  });

  it("redacts mixed-case variants of the same key", () => {
    const result = redact({
      Authorization: FAKE,
      Access_Token: FAKE,
      "Set-Cookie": FAKE,
      Api_Key: FAKE,
    }) as Record<string, unknown>;
    expect(result["Authorization"]).toBe(REDACTED);
    expect(result["Access_Token"]).toBe(REDACTED);
    expect(result["Set-Cookie"]).toBe(REDACTED);
    expect(result["Api_Key"]).toBe(REDACTED);
  });

  it("redacts secret keys at arbitrary nesting depth", () => {
    const input = {
      level1: { level2: { level3: { level4: { token: FAKE, safe: "ok" } } } },
    };
    const result = redact(input) as {
      level1: { level2: { level3: { level4: Record<string, unknown> } } };
    };
    expect(result.level1.level2.level3.level4["token"]).toBe(REDACTED);
    expect(result.level1.level2.level3.level4["safe"]).toBe("ok");
  });

  it("redacts secret keys inside arrays (including nested objects)", () => {
    const input = {
      items: [
        { authorization: FAKE, id: 1 },
        { nested: [{ refresh_token: FAKE, label: "keep" }] },
      ],
    };
    const result = redact(input) as {
      items: [Record<string, unknown>, { nested: [Record<string, unknown>] }];
    };
    expect(result.items[0]["authorization"]).toBe(REDACTED);
    expect(result.items[0]["id"]).toBe(1);
    expect(result.items[1].nested[0]["refresh_token"]).toBe(REDACTED);
    expect(result.items[1].nested[0]["label"]).toBe("keep");
  });

  it("returns a NEW object and does not mutate the original (immutability)", () => {
    const original = {
      client_secret: FAKE,
      nested: { cookie: FAKE, arr: [{ api_key: FAKE }] },
    };
    const snapshot = structuredClone(original);

    const result = redact(original);

    // Original is untouched.
    expect(original).toEqual(snapshot);
    expect(original.client_secret).toBe(FAKE);
    expect(original.nested.cookie).toBe(FAKE);
    expect(original.nested.arr[0]?.api_key).toBe(FAKE);
    // A fresh object graph is returned.
    expect(result).not.toBe(original);
    expect((result as { nested: unknown }).nested).not.toBe(original.nested);
  });

  it("passes non-secret fields through unchanged", () => {
    const input = {
      count: 3,
      durationBucket: "under_1s",
      flags: [true, false],
      meta: { provider: "gsc", availability: "available" },
    };
    const result = redact(input);
    expect(result).toEqual(input);
  });

  it("handles null, undefined, and primitives without throwing", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact("plain")).toBe("plain");
    expect(redact(42)).toBe(42);
    expect(redact({ token: null, access_token: undefined, keep: null })).toEqual({
      token: REDACTED,
      access_token: REDACTED,
      keep: null,
    });
  });
});

describe("redactUrl query redaction (spec §14.2)", () => {
  it("masks token/state/code query params, keeps origin+path", () => {
    const out = redactUrl(
      "https://example.com/oauth/callback?state=abc123&code=xyz789&keep=1",
    );
    expect(out).toContain("state=%5Bredacted%5D");
    expect(out).toContain("code=%5Bredacted%5D");
    expect(out).toContain("keep=1");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("xyz789");
  });

  it("returns non-URL input unchanged", () => {
    expect(redactUrl("not-a-url")).toBe("not-a-url");
  });
});
