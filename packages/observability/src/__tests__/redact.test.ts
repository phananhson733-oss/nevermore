import { describe, expect, it } from "vitest";

import {
  LOG_REDACT_LIMITS,
  REDACT_KEYS,
  redact as redactValue,
  redactText,
  redactUrl,
  type RedactLimits,
} from "../redact.ts";

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
const UNAVAILABLE = "[unavailable]";
const UNSUPPORTED = "[unsupported]";
const TRUNCATED = "[truncated]";
const MAX_OBJECT_KEYS = LOG_REDACT_LIMITS.maxObjectKeys;
const MAX_ARRAY_ITEMS = LOG_REDACT_LIMITS.maxArrayItems;
const MAX_STRING_BYTES = LOG_REDACT_LIMITS.maxStringBytes;
// Obviously-fake credential values (secrets:scan must never flag these).
const FAKE = "Bearer FAKE-not-a-real-token";

const redact = (value: unknown): unknown =>
  redactValue(value, LOG_REDACT_LIMITS);

function hostileProxy(target: object = Object.create(null)): object {
  return new Proxy(target, {
    get() {
      throw new Error("hostile get must not run");
    },
    getOwnPropertyDescriptor() {
      throw new Error("hostile descriptor must not escape");
    },
    getPrototypeOf() {
      throw new Error("hostile prototype must not escape");
    },
    ownKeys() {
      throw new Error("hostile ownKeys must not escape");
    },
  });
}

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
      const result = redact({ [upper]: FAKE, keep: "visible" }) as Record<
        string,
        unknown
      >;
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

  it("redacts camelCase spellings of the mandated snake_case keys (domain is camelCase)", () => {
    const result = redact({
      accessToken: FAKE,
      refreshToken: FAKE,
      clientSecret: FAKE,
      apiKey: FAKE,
      setCookie: FAKE,
      keep: "visible",
    }) as Record<string, unknown>;
    expect(result["accessToken"]).toBe(REDACTED);
    expect(result["refreshToken"]).toBe(REDACTED);
    expect(result["clientSecret"]).toBe(REDACTED);
    expect(result["apiKey"]).toBe(REDACTED);
    expect(result["setCookie"]).toBe(REDACTED);
    expect(result["keep"]).toBe("visible");
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

  it("redacts secret material embedded in benign string fields", () => {
    const oauthToken = `ya29.${"O".repeat(40)}`;
    const apiKey = `sk-${"A".repeat(32)}`;
    const cookie = `Cookie: sf_session=${"C".repeat(32)}; theme=dark`;
    const ciphertext = `encrypted_payload=${Buffer.from(
      "ciphertext-fixture-that-must-not-leak",
    ).toString("base64")}`;
    const input = {
      message: `provider failed for ${oauthToken} using ${apiKey}`,
      diagnostic: cookie,
      note: ciphertext,
      safe: "ordinary operational summary",
    };

    const result = redact(input) as typeof input;
    const serialized = JSON.stringify(result);
    for (const secret of [oauthToken, apiKey, cookie, ciphertext]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("[redacted]");
    expect(result.safe).toBe(input.safe);
  });

  it("handles null, undefined, and primitives without throwing", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact("plain")).toBe("plain");
    expect(redact(42)).toBe(42);
    expect(
      redact({ token: null, access_token: undefined, keep: null }),
    ).toEqual({
      token: REDACTED,
      access_token: REDACTED,
      keep: null,
    });
  });
});

describe("redact hostile-value and resource boundaries", () => {
  it("handles self-referential arrays and objects without unbounded recursion", () => {
    const object: Record<string, unknown> = { keep: "visible" };
    const array: unknown[] = ["visible"];
    object["self"] = object;
    array.push(array);
    object["array"] = array;

    expect(() => redact(object)).not.toThrow();
    expect(redact(object)).toEqual({
      keep: "visible",
      self: "[circular]",
      array: ["visible", "[circular]"],
    });
  });

  it("never invokes accessors and still redacts accessor secret keys", () => {
    let getterCalls = 0;
    const input: Record<string, unknown> = { safe: "visible" };
    Object.defineProperty(input, "computed", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("getter must not run");
      },
    });
    Object.defineProperty(input, "accessToken", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return FAKE;
      },
    });

    expect(redact(input)).toEqual({
      safe: "visible",
      computed: "[accessor]",
      accessToken: REDACTED,
    });
    expect(getterCalls).toBe(0);
  });

  it("preserves array holes, marks array accessors, and bounds nested arrays", () => {
    let getterCalls = 0;
    const sparse = new Array<unknown>(3);
    Object.defineProperty(sparse, "1", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("array getter must not run");
      },
    });
    sparse[2] = "visible";
    let deep: unknown = "leaf";
    for (let index = 0; index < 20; index += 1) deep = [deep];

    const result = redact(sparse) as unknown[];
    expect(0 in result).toBe(false);
    expect(result[1]).toBe("[accessor]");
    expect(result[2]).toBe("visible");
    expect(getterCalls).toBe(0);
    expect(JSON.stringify(redact(deep))).toContain("[max-depth]");
  });

  it("contains hostile Proxy traps and never reads values through get", () => {
    const ownKeysProxy = new Proxy(Object.create(null), {
      ownKeys() {
        throw new Error("ownKeys sentinel");
      },
    });
    const descriptorProxy = new Proxy({ safe: "visible" }, {
      getOwnPropertyDescriptor() {
        throw new Error("descriptor sentinel");
      },
    });
    const getProxy = new Proxy({ safe: "visible" }, {
      get() {
        throw new Error("get sentinel");
      },
    });
    const prototypeProxy = new Proxy({ safe: "visible" }, {
      getPrototypeOf() {
        throw new Error("prototype sentinel");
      },
    });
    const revocable = Proxy.revocable({ safe: "visible" }, {});
    revocable.revoke();

    expect(() => redact(hostileProxy())).not.toThrow();
    expect(redact(ownKeysProxy)).toBe(UNAVAILABLE);
    expect(redact(descriptorProxy)).toEqual({ safe: UNAVAILABLE });
    expect(redact(getProxy)).toEqual({ safe: "visible" });
    expect(redact(prototypeProxy)).toBe(UNAVAILABLE);
    expect(() => redact(revocable.proxy)).not.toThrow();
    expect(redact(revocable.proxy)).toBe(UNAVAILABLE);
  });

  it("skips symbols/non-enumerable fields and safely defines special keys", () => {
    const input: Record<string, unknown> = { visible: "yes" };
    Reflect.defineProperty(input, Symbol("ignored"), {
      enumerable: true,
      value: FAKE,
    });
    Reflect.defineProperty(input, "hidden", {
      enumerable: false,
      value: FAKE,
    });
    Reflect.defineProperty(input, "__proto__", {
      enumerable: true,
      value: { safe: "kept" },
    });

    const result = redact(input) as Record<string, unknown>;
    expect(result["visible"]).toBe("yes");
    expect(result["__proto__"]).toEqual({ safe: "kept" });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(
      true,
    );
    expect(result["hidden"]).toBeUndefined();
    expect(Reflect.ownKeys(result)).not.toContainEqual(expect.any(Symbol));
  });

  it("copies repeated references independently instead of mislabelling them as cycles", () => {
    const shared = { status: "visible" };

    expect(redact({ left: shared, right: shared })).toEqual({
      left: { status: "visible" },
      right: { status: "visible" },
    });
  });

  it("does not invoke hostile toString/toJSON or expand non-plain values", () => {
    class HostileValue {
      toJSON(): never {
        throw new Error("toJSON sentinel");
      }

      toString(): never {
        throw new Error("toString sentinel");
      }
    }

    expect(() => redact(new HostileValue())).not.toThrow();
    expect(redact(new HostileValue())).toBe(UNSUPPORTED);
    expect(redact(new Date("2026-01-01T00:00:00.000Z"))).toBe(UNSUPPORTED);
    expect(redact(new Map([["token", FAKE]]))).toBe(UNSUPPORTED);
  });

  it("marks Buffer, typed-array, BigInt, function, and symbol values safely", () => {
    const result = redact({
      buffer: Buffer.from("binary fixture"),
      bytes: new Uint8Array([1, 2, 3]),
      view: new DataView(new ArrayBuffer(4)),
      bigint: 12n,
      callback: () => FAKE,
      symbol: Symbol("fixture"),
    });

    expect(result).toEqual({
      buffer: "[binary]",
      bytes: "[binary]",
      view: "[binary]",
      bigint: UNSUPPORTED,
      callback: UNSUPPORTED,
      symbol: UNSUPPORTED,
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("normalizes non-finite numbers and exercises bounded UTF-8 paths", () => {
    expect(redact({ nan: Number.NaN, infinity: Number.POSITIVE_INFINITY })).toEqual(
      {
        nan: UNSUPPORTED,
        infinity: UNSUPPORTED,
      },
    );
    expect(redact("é")).toBe("é");
    expect(redact("😀")).toBe("😀");
    expect(redact("\ud800")).toBe("\ud800");
  });

  it("enforces depth, object-key, array-item, key, and string byte limits", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 20_000; index += 1) {
      const next: Record<string, unknown> = {};
      cursor["next"] = next;
      cursor = next;
    }
    const wide = Object.fromEntries(
      Array.from({ length: 1_000 }, (_, index) => [`key_${index}`, index]),
    );
    const longKey = "k".repeat(MAX_STRING_BYTES + 1);

    expect(() => redact(deep)).not.toThrow();
    expect(JSON.stringify(redact(deep))).toContain("[max-depth]");

    const redactedWide = redact(wide) as Record<string, unknown>;
    expect(Object.keys(redactedWide).length).toBeLessThanOrEqual(
      MAX_OBJECT_KEYS,
    );
    expect(redactedWide["[truncated]"]).toBeDefined();

    const redactedArray = redact(Array.from({ length: 1_000 }, (_, i) => i));
    expect(Array.isArray(redactedArray)).toBe(true);
    expect((redactedArray as unknown[]).length).toBeLessThanOrEqual(
      MAX_ARRAY_ITEMS,
    );
    expect((redactedArray as unknown[]).at(-1)).toBe(TRUNCATED);

    expect(redact("x".repeat(MAX_STRING_BYTES + 1))).toBe(TRUNCATED);
    expect(redact("€".repeat(Math.floor(MAX_STRING_BYTES / 3) + 1))).toBe(
      TRUNCATED,
    );
    const redactedKey = redact({ [longKey]: "must not copy key" }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(redactedKey)).not.toContain(longKey);
    expect(redactedKey["[truncated]"]).toBeDefined();
  });

  it("uses a global node budget for deeply branched values", () => {
    const branch = (depth: number): unknown =>
      depth === 0
        ? "leaf"
        : Array.from({ length: 8 }, () => branch(depth - 1));

    const result = redact(branch(5));
    const serialized = JSON.stringify(result);
    expect(serialized.length).toBeLessThan(100_000);
    expect(serialized).toContain(TRUNCATED);
  });

  it("bounds descriptor failures after the object-key budget is exhausted", () => {
    const target = Object.fromEntries(
      Array.from({ length: MAX_OBJECT_KEYS + 1 }, (_, index) => [
        `field_${index}`,
        index,
      ]),
    );
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor() {
        throw new Error("descriptor sentinel");
      },
    });

    const result = redact(proxy) as Record<string, unknown>;
    expect(Object.keys(result)).toHaveLength(MAX_OBJECT_KEYS);
    expect(result[TRUNCATED]).toBe(TRUNCATED);
  });

  it("ignores hostile or invalid limit profiles without invoking accessors", () => {
    let getterCalls = 0;
    const accessorLimits = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(LOG_REDACT_LIMITS)) {
      Object.defineProperty(accessorLimits, key, {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("limit getter must not run");
        },
      });
    }
    const hostileLimits = new Proxy(LOG_REDACT_LIMITS, {
      getOwnPropertyDescriptor() {
        throw new Error("limit descriptor sentinel");
      },
    });

    expect(
      redactValue("visible", accessorLimits as unknown as RedactLimits),
    ).toBe("visible");
    expect(redactValue("visible", hostileLimits)).toBe("visible");
    expect(
      redactValue("visible", null as unknown as RedactLimits),
    ).toBe("visible");
    expect(getterCalls).toBe(0);
  });
});

describe("redactUrl query redaction (spec §14.2)", () => {
  it("masks token/state/code query params, keeps origin+path", () => {
    const out = redactUrl(
      "https://example.com/oauth/callback?state=abc123&code=xyz789&accessToken=token-value&keep=1",
    );
    expect(out).toContain("state=%5Bredacted%5D");
    expect(out).toContain("code=%5Bredacted%5D");
    expect(out).toContain("keep=1");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("xyz789");
    expect(out).not.toContain("token-value");
  });

  it("returns non-URL input unchanged", () => {
    expect(redactUrl("not-a-url")).toBe("not-a-url");
  });

  it("does not coerce hostile URL values and bounds oversized URLs", () => {
    let coercions = 0;
    const hostile = {
      toString() {
        coercions += 1;
        throw new Error("coercion must not run");
      },
    };

    expect(redactUrl(hostile as unknown as string)).toBe(UNSUPPORTED);
    expect(redactUrl(`https://example.com/${"x".repeat(MAX_STRING_BYTES)}`)).toBe(
      TRUNCATED,
    );
    expect(redactUrl("https://example.com/path?keep=1")).toBe(
      "https://example.com/path?keep=1",
    );
    expect(coercions).toBe(0);
  });

  it("redacts URL user information and secrets embedded in invalid URLs", () => {
    const withUserInfo = redactUrl(
      "https://fixture-user:fixture-password@example.com/path",
    );
    const bearer = `Bearer ${"B".repeat(36)}`;

    expect(withUserInfo).not.toContain("fixture-user");
    expect(withUserInfo).not.toContain("fixture-password");
    expect(withUserInfo).toContain("%5Bredacted%5D");
    expect(redactUrl(`upstream failed: ${bearer}`)).not.toContain(bearer);
  });

  it("fully removes labelled Bearer and Basic credentials from invalid URLs", () => {
    const bearerValue = "B".repeat(36);
    const basicValue = Buffer.from("fake-basic-credential-fixture").toString(
      "base64",
    );
    const input =
      `upstream authorization=Bearer ${bearerValue}; ` +
      `proxy authorization=Basic ${basicValue}`;
    const output = redactUrl(input);

    expect(output).not.toContain(bearerValue);
    expect(output).not.toContain(basicValue);
    expect(output).toContain(REDACTED);
  });
});

describe("redactText value-level redaction", () => {
  it("scrubs bearer/query/ciphertext values without discarding surrounding context", () => {
    const bearer = `Bearer ${"B".repeat(36)}`;
    const refresh = `1//${"R".repeat(36)}`;
    const slackToken = `xoxb-${"S".repeat(32)}`;
    const ciphertext = Buffer.from("private-ciphertext-fixture").toString(
      "base64",
    );
    const input =
      `refresh failed: ${bearer}; refresh_token=${refresh}; ` +
      `token_cipher=${ciphertext}; token=${slackToken}; keep=request-42`;

    const output = redactText(input);
    expect(output).not.toContain(bearer);
    expect(output).not.toContain(refresh);
    expect(output).not.toContain(slackToken);
    expect(output).not.toContain(ciphertext);
    expect(output).toContain("keep=request-42");
    expect(output).toContain("[redacted]");
  });

  it("does not coerce hostile non-string values", () => {
    let coercions = 0;
    const hostile = {
      toString() {
        coercions += 1;
        throw new Error("coercion must not run");
      },
    };

    expect(redactText(hostile as unknown as string)).toBe(UNSUPPORTED);
    expect(coercions).toBe(0);
  });

  it("fully removes labelled Bearer and Basic credentials", () => {
    const bearerValue = "B".repeat(36);
    const basicValue = Buffer.from("fake-basic-credential-fixture").toString(
      "base64",
    );
    const output = redactText(
      `authorization: Bearer ${bearerValue}; authorization=Basic ${basicValue}`,
    );

    expect(output).not.toContain(bearerValue);
    expect(output).not.toContain(basicValue);
    expect(output).toContain(REDACTED);
  });
});
