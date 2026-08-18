import { describe, expect, it } from "vitest";

import {
  MAX_QUERIES,
  MAX_QUERY_CHARS,
  parseTargetQueries,
} from "./parse-queries.ts";

describe("parseTargetQueries", () => {
  it("splits on the comma the field asks for", () => {
    expect(parseTargetQueries("astrology, birth chart, natal chart").queries)
      .toEqual(["astrology", "birth chart", "natal chart"]);
  });

  it("splits on the full-width comma a Chinese keyboard produces", () => {
    // The separator the audience actually types. Splitting only on `,` took
    // `占星，星盘` as one six-character query and reported it absent from a page
    // that covers both words.
    expect(parseTargetQueries("占星，星盘，本命盘").queries).toEqual([
      "占星",
      "星盘",
      "本命盘",
    ]);
  });

  it("takes a pasted column as a list", () => {
    expect(parseTargetQueries("seo\ngeo\r\ngrowth").queries).toEqual([
      "seo",
      "geo",
      "growth",
    ]);
  });

  it("keeps the spaces inside a phrase and drops the ones around it", () => {
    expect(parseTargetQueries("  birth chart ,  natal chart ").queries).toEqual([
      "birth chart",
      "natal chart",
    ]);
  });

  it("ignores the empty stretches a half-typed list leaves behind", () => {
    expect(parseTargetQueries("seo,,, ,geo,").queries).toEqual(["seo", "geo"]);
  });

  it("folds a repeat rather than asking the same question twice", () => {
    const parsed = parseTargetQueries("SEO, seo, Seo");
    expect(parsed.queries).toEqual(["SEO"]);
    expect(parsed.duplicates).toBe(2);
  });

  it("counts what it dropped past the cap instead of dropping it silently", () => {
    const parsed = parseTargetQueries("a, b, c, d, e, f, g");
    expect(parsed.queries).toHaveLength(MAX_QUERIES);
    expect(parsed.overflow).toBe(2);
  });

  it("does not spend the cap on a repeat", () => {
    // Folding after the cap would have let `a, a, b, c, d, e` fill five slots
    // with four distinct words and call the sixth an overflow.
    const parsed = parseTargetQueries("a, a, b, c, d, e");
    expect(parsed.queries).toEqual(["a", "b", "c", "d", "e"]);
    expect(parsed.overflow).toBe(0);
    expect(parsed.duplicates).toBe(1);
  });

  it("refuses one over-long entry without refusing the line it sits on", () => {
    const long = "x".repeat(MAX_QUERY_CHARS + 1);
    const parsed = parseTargetQueries(`seo, ${long}, geo`);
    expect(parsed.queries).toEqual(["seo", "geo"]);
    expect(parsed.tooLong).toEqual([long]);
  });

  it("measures length in characters, not UTF-16 units", () => {
    // `noUncheckedIndexedAccess` will not catch this one: `.length` on a string
    // of astral characters is double what a reader counts, so a 41-emoji query
    // would have been refused for being 82 characters long.
    const astral = "𝒜".repeat(MAX_QUERY_CHARS);
    expect(parseTargetQueries(astral).queries).toEqual([astral]);
    expect(parseTargetQueries(`${astral}𝒜`).tooLong).toHaveLength(1);
  });

  it("returns nothing for a field nobody filled in", () => {
    expect(parseTargetQueries("   ").queries).toEqual([]);
    expect(parseTargetQueries("").queries).toEqual([]);
  });
});
