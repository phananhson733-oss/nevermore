// @input  -- hostile strings, reordered objects, and known digest vectors
// @output -- proof one normalization and one serialization produce one set of bytes
// @pos    -- focused tests for the shared GEO hashing discipline

import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  codePointLength,
  geoDomainHash,
  GeoCanonicalError,
  hasArrayHole,
  hasLoneSurrogate,
  isGeoDigest,
  normalizeGeoText,
  sliceCodePoints,
} from "./geo-canonical.ts";

describe("normalizeGeoText", () => {
  it("makes a decomposed and a precomposed accent identical", () => {
    // Written as escapes rather than as literal accented characters: an editor
    // or a formatter that normalizes this file would otherwise quietly turn the
    // two sides into the same string and the assertion into a tautology.
    const decomposed = "Cafe\u0301 Analytics";
    const precomposed = "Caf\u00e9 Analytics";

    expect(decomposed).not.toBe(precomposed);
    expect(normalizeGeoText(decomposed)).toBe(normalizeGeoText(precomposed));
  });

  it("folds CRLF, bare CR and tabs into single spaces and trims", () => {
    expect(normalizeGeoText("  AI\r\n\r\nvisibility\ttracking \r ")).toBe(
      "AI visibility tracking",
    );
  });

  it("keeps punctuation that belongs to a real name", () => {
    for (const name of ["U.S. tax software", "[24]7.ai", "C++ analytics"]) {
      expect(normalizeGeoText(name)).toBe(name);
    }
  });

  it("does not change case", () => {
    expect(normalizeGeoText("SEMrush")).toBe("SEMrush");
  });
});

describe("codePointLength and sliceCodePoints", () => {
  it("counts astral characters once", () => {
    // Two UTF-16 code units, one code point. A bound counted in `.length`
    // would let a snippet twice as long as advertised through.
    expect("\u{1f600}".length).toBe(2);
    expect(codePointLength("\u{1f600}")).toBe(1);
  });

  it("never cuts an astral character in half", () => {
    const value = `ab\u{1f600}cd`;

    expect(sliceCodePoints(value, 3)).toBe("ab\u{1f600}");
    expect(hasLoneSurrogate(sliceCodePoints(value, 3))).toBe(false);
    // The naive cut is the bug this exists to prevent.
    expect(hasLoneSurrogate(value.slice(0, 3))).toBe(true);
  });

  it("returns an empty string for a non-positive budget", () => {
    expect(sliceCodePoints("abc", 0)).toBe("");
    expect(sliceCodePoints("abc", -1)).toBe("");
  });
});

describe("canonicalJson", () => {
  it("does not depend on key insertion order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts keys by UTF-16 code unit, not by locale", () => {
    // Locale-aware collation would put "a" before "Z"; code-unit order does not.
    expect(canonicalJson({ a: 1, Z: 2 })).toBe('{"Z":2,"a":1}');
  });

  it("preserves array order, which carries meaning", () => {
    expect(canonicalJson(["b", "a"])).toBe('["b","a"]');
  });

  it("serializes negative zero the same as zero", () => {
    expect(canonicalJson(-0)).toBe("0");
    expect(canonicalJson(0)).toBe("0");
  });

  it("refuses values that cannot round-trip identically", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(GeoCanonicalError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(
      GeoCanonicalError,
    );
    expect(() =>
      canonicalJson({ a: undefined } as unknown as Record<string, never>),
    ).toThrow(GeoCanonicalError);
    expect(() =>
      canonicalJson([undefined] as unknown as readonly string[]),
    ).toThrow(GeoCanonicalError);
  });

  it("refuses a lone surrogate rather than repairing it", () => {
    expect(() => canonicalJson("bad\ud800tail")).toThrow(GeoCanonicalError);
  });

  it("never drops a key that happens to be undefined", () => {
    // Dropping it would make {a: 1, b: undefined} and {a: 1} hash alike, so the
    // fingerprint would stop noticing a real difference between two payloads.
    expect(() =>
      canonicalJson({ a: 1, b: undefined } as unknown as Record<string, never>),
    ).toThrow(GeoCanonicalError);
  });
});

describe("geoDomainHash", () => {
  /**
   * Golden vectors, computed independently with Node's own `crypto` module.
   *
   * The point is not that SHA-256 works; it is that the exact bytes fed to it —
   * domain, newline, canonical JSON, UTF-8 — are pinned, so a later refactor
   * that changes the separator or the encoding fails here instead of failing on
   * a customer's confirmed run.
   */
  it("matches an independently computed digest", async () => {
    await expect(geoDomainHash("geo_test.v1", {})).resolves.toBe(
      "sha256:346e84470a6c518d103b39715e4d780875a4006fe1580ba2777a560a8c680c8b",
    );
    await expect(
      geoDomainHash("geo_test.v1", { a: 1, b: ["x", "y"] }),
    ).resolves.toBe(
      "sha256:41e44e68a22d910a935b81436bc7af299ec51d19411517e19141e8613f9458b9",
    );
  });

  it("gives the same content different digests in different domains", async () => {
    const inRole = await geoDomainHash("geo_context.v1", {});
    const inOtherRole = await geoDomainHash("geo_test.v1", {});

    expect(inRole).toBe(
      "sha256:f4fae9be2c2b8885900d4f9f7574eaaee3d67957036f95d2c98e76ccd5de407a",
    );
    expect(inRole).not.toBe(inOtherRole);
  });

  it("is stable across key insertion order", async () => {
    const first = await geoDomainHash("geo_test.v1", { a: "1", b: "2" });
    const second = await geoDomainHash("geo_test.v1", { b: "2", a: "1" });

    expect(first).toBe(second);
  });

  it("produces the documented digest shape", async () => {
    expect(isGeoDigest(await geoDomainHash("geo_test.v1", {}))).toBe(true);
    for (const other of [
      "",
      "sha256:",
      "sha256:ABC",
      `sha256:${"A".repeat(64)}`,
      `sha1:${"a".repeat(64)}`,
      `sha256:${"a".repeat(63)}`,
    ]) {
      expect(isGeoDigest(other)).toBe(false);
    }
  });
});

describe("sparse arrays", () => {
  it("refuses a hole rather than serializing it away", () => {
    // `map` skips holes, so `new Array(1)` would serialize as `[]` and collide
    // with a genuinely empty array. A content fingerprint that cannot tell
    // those apart is not a content fingerprint.
    const sparse = new Array(1) as unknown as readonly string[];

    expect(hasArrayHole(sparse)).toBe(true);
    expect(() => canonicalJson(sparse)).toThrow(GeoCanonicalError);
  });

  it("refuses a trailing hole after real elements", () => {
    const sparse = ["a", "b"] as unknown as string[];
    sparse.length = 3;

    expect(hasArrayHole(sparse)).toBe(true);
    expect(() => canonicalJson(sparse)).toThrow(GeoCanonicalError);
  });

  it("accepts a dense array of the same length", () => {
    expect(hasArrayHole(["a", "b", "c"])).toBe(false);
    expect(canonicalJson(["a", "b", "c"])).toBe('["a","b","c"]');
  });
});
