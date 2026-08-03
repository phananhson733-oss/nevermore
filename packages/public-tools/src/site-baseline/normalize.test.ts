import { describe, expect, it } from "vitest";

import { isBrandQuery, normalizeQuery, splitBrandQueries } from "./normalize.ts";
import type { GscQueryRow } from "./types.ts";

function row(query: string, impressions = 100, clicks = 1): GscQueryRow {
  return { query, impressions, clicks, position: 5 };
}

describe("normalizeQuery", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeQuery("  Lamine   YAMAL  ")).toBe("lamine yamal");
  });

  it("leaves an already-normal query alone", () => {
    expect(normalizeQuery("messi zodiac sign")).toBe("messi zodiac sign");
  });
});

describe("isBrandQuery", () => {
  it("matches a brand term on a token boundary", () => {
    expect(isBrandQuery("gengrowth pricing", ["gengrowth"])).toBe(true);
    expect(isBrandQuery("what is gengrowth", ["gengrowth"])).toBe(true);
  });

  it("does not match a term that merely shares a prefix", () => {
    // Substring matching would classify this as brand and quietly pull a
    // non-brand query out of the curve. A brand filter that cannot be checked
    // by the visitor has to err toward leaving queries in.
    expect(isBrandQuery("gengrowthly reviews", ["gengrowth"])).toBe(false);
  });

  it("matches a multi-word brand only when the words are adjacent and in order", () => {
    expect(isBrandQuery("acme corp login", ["acme corp"])).toBe(true);
    expect(isBrandQuery("acme is a corp", ["acme corp"])).toBe(false);
  });

  it("is case-insensitive on both sides", () => {
    expect(isBrandQuery("GenGrowth Pricing", ["gengrowth"])).toBe(true);
    expect(isBrandQuery("gengrowth pricing", ["GenGrowth"])).toBe(true);
  });

  it("treats an empty brand list as no brand queries", () => {
    expect(isBrandQuery("anything at all", [])).toBe(false);
  });

  it("ignores blank brand terms rather than matching everything", () => {
    // A blank term would otherwise be "contained" in every query and silently
    // empty the curve.
    expect(isBrandQuery("messi zodiac sign", ["", "   "])).toBe(false);
  });
});

describe("splitBrandQueries", () => {
  it("partitions rows and keeps both sides", () => {
    const rows = [
      row("gengrowth pricing"),
      row("messi zodiac sign"),
      row("gengrowth vs ahrefs"),
    ];

    const split = splitBrandQueries(rows, ["gengrowth"]);

    expect(split.brand.map((r) => r.query)).toEqual([
      "gengrowth pricing",
      "gengrowth vs ahrefs",
    ]);
    expect(split.nonBrand.map((r) => r.query)).toEqual(["messi zodiac sign"]);
  });

  it("puts everything in nonBrand when no brand terms are given", () => {
    const rows = [row("a"), row("b")];

    expect(splitBrandQueries(rows, []).nonBrand).toHaveLength(2);
    expect(splitBrandQueries(rows, []).brand).toHaveLength(0);
  });
});
