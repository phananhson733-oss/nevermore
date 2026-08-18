import { describe, expect, it } from "vitest";

import {
  MAX_TARGET_QUERIES,
  MAX_TARGET_QUERY_LENGTH,
  normalizeForMatch,
  normalizeTargetQueries,
} from "./normalize.ts";

function accepted(raw: readonly string[]) {
  const result = normalizeTargetQueries(raw);
  if (!result.ok) throw new Error(`expected acceptance, got ${result.reason}`);
  return result.queries;
}

function rejected(raw: readonly string[]) {
  const result = normalizeTargetQueries(raw);
  if (result.ok) throw new Error("expected rejection");
  return result.reason;
}

describe("normalizeTargetQueries", () => {
  it("keeps the visitor's casing for display and lowercases only the identity", () => {
    expect(accepted(["Natal Chart"])).toEqual([
      { displayQuery: "Natal Chart", identity: "natal chart" },
    ]);
  });

  it("applies NFKC so full-width and half-width input are one query", () => {
    const queries = accepted(["ＳＥＯ工具", "SEO工具"]);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.identity).toBe("seo工具");
  });

  it("strips zero-width characters before collapsing whitespace", () => {
    // Collapsing first would leave a double space behind the removed ZWSP and
    // produce an identity that never equals the same query typed cleanly.
    expect(accepted(["a ​ b"])[0]?.identity).toBe("a b");
  });

  it("drops an input that is only whitespace and zero-width characters", () => {
    expect(rejected(["​ ﻿"])).toBe("empty_after_normalization");
  });

  it("trims and collapses runs of whitespace", () => {
    expect(accepted(["  free   birth \n chart  "])[0]?.displayQuery).toBe(
      "free birth chart",
    );
  });

  it("deduplicates by identity and keeps the first spelling", () => {
    const queries = accepted(["Astrology", "astrology", "ASTROLOGY"]);
    expect(queries).toEqual([
      { displayQuery: "Astrology", identity: "astrology" },
    ]);
  });

  it("does not stem: singular and plural stay two queries", () => {
    expect(accepted(["seo tool", "seo tools"])).toHaveLength(2);
  });

  it("accepts the maximum number of queries", () => {
    expect(accepted(["a", "b", "c", "d", "e"])).toHaveLength(
      MAX_TARGET_QUERIES,
    );
  });

  it("rejects the whole request past the query limit instead of truncating", () => {
    expect(rejected(["a", "b", "c", "d", "e", "f"])).toBe("too_many_queries");
  });

  it("counts the limit after deduplication", () => {
    expect(accepted(["a", "a", "b", "c", "d", "e"])).toHaveLength(5);
  });

  it("accepts a query at exactly the length limit", () => {
    const exact = "x".repeat(MAX_TARGET_QUERY_LENGTH);
    expect(accepted([exact])[0]?.identity).toHaveLength(
      MAX_TARGET_QUERY_LENGTH,
    );
  });

  it("rejects the whole request past the length limit instead of truncating", () => {
    expect(rejected(["x".repeat(MAX_TARGET_QUERY_LENGTH + 1)])).toBe(
      "query_too_long",
    );
  });

  it("measures length after normalization, not on the raw input", () => {
    // Padding normalizes away, so this is a legal query even though the raw
    // string is longer than the limit.
    const padded = `  ${"x".repeat(MAX_TARGET_QUERY_LENGTH)}   `;
    expect(accepted([padded])[0]?.identity).toHaveLength(
      MAX_TARGET_QUERY_LENGTH,
    );
  });

  it("rejects an empty list", () => {
    expect(rejected([])).toBe("empty_after_normalization");
  });

  it("rejects a list whose entries all normalize away", () => {
    expect(rejected(["", "   ", "​"])).toBe("empty_after_normalization");
  });

  it("keeps a legal query when a sibling entry normalizes away", () => {
    expect(accepted(["", "natal chart"])).toHaveLength(1);
  });
});

describe("normalizeForMatch", () => {
  it("lowercases and applies the same normalization as an identity", () => {
    expect(normalizeForMatch("  Free  BIRTH​ Chart ")).toBe(
      "free birth chart",
    );
  });

  it("normalizes full-width page text so it can match a half-width query", () => {
    expect(normalizeForMatch("ＳＥＯ")).toBe("seo");
  });

  it("returns an empty string for blank text", () => {
    expect(normalizeForMatch("   ​ ")).toBe("");
  });
});

describe("frozen limits", () => {
  it("matches the frozen contract values", () => {
    expect(MAX_TARGET_QUERIES).toBe(5);
    expect(MAX_TARGET_QUERY_LENGTH).toBe(80);
  });
});
