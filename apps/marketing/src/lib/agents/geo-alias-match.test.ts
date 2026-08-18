// @input  -- answers, questions, and brand aliases including hostile shapes
// @output -- proof the matcher is whole-word, positioned, and bounded
// @pos    -- focused tests for the shared GEO alias matcher

import { describe, expect, it } from "vitest";

import { codePointLength, hasLoneSurrogate } from "./geo-canonical.ts";
import {
  containsGeoAlias,
  findGeoAliasMatch,
  GEO_MAX_MENTION_SNIPPET_CODE_POINTS,
  geoMentionSnippet,
  normalizeAliasForMatch,
} from "./geo-alias-match.ts";

describe("findGeoAliasMatch", () => {
  it("matches a whole word regardless of case", () => {
    const match = findGeoAliasMatch("We recommend ACME for teams.", ["Acme"]);

    expect(match).not.toBeNull();
    expect(match!.alias).toBe("Acme");
    expect("We recommend ACME for teams.".slice(match!.startIndex, match!.endIndex)).toBe(
      "ACME",
    );
  });

  it("matches across an apostrophe the way a reader would", () => {
    expect(containsGeoAlias("Acme's dashboard is fast.", ["Acme"])).toBe(true);
  });

  it("does not match a name buried inside a longer word", () => {
    expect(containsGeoAlias("AcmeCorp is unrelated.", ["Acme"])).toBe(false);
    expect(containsGeoAlias("supercalifragilistic", ["cali"])).toBe(false);
  });

  it("matches a multi-word alias as one phrase", () => {
    expect(containsGeoAlias("Try Acme Analytics today.", ["Acme Analytics"])).toBe(
      true,
    );
    expect(containsGeoAlias("Try Acme, then Analytics.", ["Acme Analytics"])).toBe(
      false,
    );
  });

  it("ignores aliases too short to be evidence", () => {
    // Two characters collide with ordinary words and with every acronym in the
    // answer; a mention count built on that is noise wearing evidence's clothes.
    expect(containsGeoAlias("Go to the go store", ["Go"])).toBe(false);
    expect(normalizeAliasForMatch("Go").length).toBeLessThan(3);
  });

  it("takes the earliest match", () => {
    const text = "Beta is fine. Acme is better. Beta again.";
    const match = findGeoAliasMatch(text, ["Acme", "Beta"]);

    expect(match!.alias).toBe("Beta");
    expect(match!.startIndex).toBe(0);
  });

  it("takes the longest alias when two start at the same offset", () => {
    const text = "Acme Analytics is the product.";
    const match = findGeoAliasMatch(text, ["Acme", "Acme Analytics"]);

    expect(match!.alias).toBe("Acme Analytics");
    expect(text.slice(match!.startIndex, match!.endIndex)).toBe("Acme Analytics");
  });

  it("returns offsets into the original text, not the normalized one", () => {
    // The normalized form is lowercased and stripped of punctuation, so an
    // offset taken from it would point at the wrong place in the sentence the
    // model actually wrote.
    const text = "  Hello,   world — ACME Inc. ships today.";
    const match = findGeoAliasMatch(text, ["Acme"]);

    expect(text.slice(match!.startIndex, match!.endIndex)).toBe("ACME");
  });

  it("handles astral characters without shifting the offsets", () => {
    const text = "\u{1f680} launch: Acme is live.";
    const match = findGeoAliasMatch(text, ["Acme"]);

    expect(text.slice(match!.startIndex, match!.endIndex)).toBe("Acme");
  });

  it("returns null when nothing matched", () => {
    expect(findGeoAliasMatch("Nothing here.", ["Acme"])).toBeNull();
    expect(findGeoAliasMatch("", ["Acme"])).toBeNull();
    expect(findGeoAliasMatch("Acme", [])).toBeNull();
  });
});

describe("geoMentionSnippet", () => {
  const long = (filler: string) => `${filler.repeat(40)} Acme is mentioned here. ${filler.repeat(40)}`;

  it("returns null for an answer short enough that the window is the whole answer", () => {
    const text = "Acme is a good option.";
    const match = findGeoAliasMatch(text, ["Acme"])!;

    expect(geoMentionSnippet(text, match)).toBeNull();
  });

  it("bounds the excerpt in code points and marks both cuts", () => {
    const text = long("lorem ipsum ");
    const match = findGeoAliasMatch(text, ["Acme"])!;
    const snippet = geoMentionSnippet(text, match)!;

    expect(snippet).not.toBeNull();
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(codePointLength(snippet.replaceAll("…", ""))).toBeLessThanOrEqual(
      GEO_MAX_MENTION_SNIPPET_CODE_POINTS,
    );
  });

  it("keeps the matched name inside the excerpt", () => {
    const text = long("lorem ipsum ");
    const match = findGeoAliasMatch(text, ["Acme"])!;

    expect(geoMentionSnippet(text, match)).toContain("Acme");
  });

  it("never cuts an astral character in half", () => {
    const text = `${"\u{1f600}".repeat(200)} Acme ${"\u{1f600}".repeat(200)}`;
    const match = findGeoAliasMatch(text, ["Acme"])!;
    const snippet = geoMentionSnippet(text, match)!;

    expect(hasLoneSurrogate(snippet)).toBe(false);
    expect(snippet).toContain("Acme");
  });

  it("marks only the end when the match sits at the start", () => {
    const text = `Acme ${"filler ".repeat(200)}`;
    const match = findGeoAliasMatch(text, ["Acme"])!;
    const snippet = geoMentionSnippet(text, match)!;

    expect(snippet.startsWith("…")).toBe(false);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("marks only the start when the match sits at the end", () => {
    const text = `${"filler ".repeat(200)}Acme`;
    const match = findGeoAliasMatch(text, ["Acme"])!;
    const snippet = geoMentionSnippet(text, match)!;

    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(false);
    expect(snippet).toContain("Acme");
  });
});

describe("Unicode composition and astral offsets", () => {
  // Written as escapes: an editor or formatter that normalizes this file would
  // otherwise turn both sides into the same string and the tests into
  // tautologies.
  const DECOMPOSED = "Cafe\u0301 Analytics is good";
  const PRECOMPOSED = "Caf\u00e9 Analytics is good";

  it("uses genuinely different source bytes on the two sides", () => {
    expect(DECOMPOSED).not.toBe(PRECOMPOSED);
  });

  it("does not read a decomposed accent as the unaccented alias", () => {
    // A reader sees "Cafe\u0301 Analytics" as "Café Analytics". Matching it as
    // "Cafe" would invent a mention of a company that was never named.
    expect(containsGeoAlias(DECOMPOSED, ["Cafe"])).toBe(false);
    expect(containsGeoAlias(PRECOMPOSED, ["Cafe"])).toBe(false);
  });

  it("matches the same visible name in either composition", () => {
    for (const text of [DECOMPOSED, PRECOMPOSED]) {
      for (const alias of ["Cafe\u0301 Analytics", "Caf\u00e9 Analytics"]) {
        expect(containsGeoAlias(text, [alias])).toBe(true);
      }
    }
  });

  it("keeps offsets aligned when an astral character precedes the match", () => {
    // The index is built per UTF-16 code unit, not per code point: a per-code-
    // point map desynchronizes the moment a surrogate pair appears, and the
    // reported span then covers a different part of the sentence.
    const text = "\u{20000}\u{20000} Acme Analytics ships";
    const match = findGeoAliasMatch(text, ["Acme Analytics"])!;

    expect(match).not.toBeNull();
    expect(
      text.normalize("NFC").slice(match.startIndex, match.endIndex),
    ).toBe("Acme Analytics");
  });

  it("keeps the whole excerpt, ellipses included, inside the bound", () => {
    const text = `${"lorem ipsum ".repeat(60)}Acme${" dolor sit".repeat(60)}`;
    const match = findGeoAliasMatch(text, ["Acme"])!;
    const snippet = geoMentionSnippet(text, match)!;

    expect(codePointLength(snippet)).toBeLessThanOrEqual(
      GEO_MAX_MENTION_SNIPPET_CODE_POINTS,
    );
    expect(snippet).toContain("Acme");
  });
});
