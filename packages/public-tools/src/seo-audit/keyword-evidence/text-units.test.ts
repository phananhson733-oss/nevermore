import {
  isCjkUnit,
  parsePage,
  unitStream,
} from "@sf/sources/crawl-public-preview";
import { describe, expect, it } from "vitest";

import {
  cjkShare,
  cjkShareFromCounts,
  countTextUnits,
  hasCjk,
  TEXT_UNITS_VERSION,
  textUnitsFromCounts,
} from "./text-units.ts";

describe("countTextUnits", () => {
  it("counts whitespace-separated runs for Latin text", () => {
    expect(countTextUnits("free birth chart calculator")).toEqual({
      units: 4,
      basis: "words",
    });
  });

  it("collapses repeated whitespace instead of counting empty runs", () => {
    expect(countTextUnits("  free   birth \n chart  ")).toEqual({
      units: 3,
      basis: "words",
    });
  });

  it("counts CJK one unit per character", () => {
    // The whole string is one whitespace run, so a word count would say 1.
    expect(countTextUnits("占星命盘")).toEqual({
      units: 4,
      basis: "cjk_chars",
    });
  });

  it("counts mixed scripts as the sum of both bases", () => {
    expect(countTextUnits("free 占星 chart")).toEqual({
      units: 4,
      basis: "mixed",
    });
  });

  it("counts kana and hangul per character", () => {
    expect(countTextUnits("ひらがな").units).toBe(4);
    expect(countTextUnits("カタカナ").units).toBe(4);
    expect(countTextUnits("한국어").units).toBe(3);
  });

  it("reports zero units for blank text without inventing a basis", () => {
    expect(countTextUnits("   ")).toEqual({ units: 0, basis: "words" });
  });

  it("removes CJK rather than splitting the run it sat inside", () => {
    // The frozen unit removes CJK code points; replacing them with a space
    // would count "SEO工具checker" as four units instead of three and change
    // every density computed from it.
    expect(countTextUnits("SEO工具checker")).toEqual({
      units: 3,
      basis: "mixed",
    });
  });

  it("is stable across repeated calls (no shared regex lastIndex leak)", () => {
    const first = countTextUnits("占星 astrology 占星");
    const second = countTextUnits("占星 astrology 占星");
    expect(second).toEqual(first);
  });
});

describe("hasCjk", () => {
  it("detects CJK and stays false for Latin", () => {
    expect(hasCjk("占星")).toBe(true);
    expect(hasCjk("astrology")).toBe(false);
    expect(hasCjk("seo 工具")).toBe(true);
  });

  it("does not drift across calls", () => {
    expect(hasCjk("占星")).toBe(true);
    expect(hasCjk("占星")).toBe(true);
    expect(hasCjk("astrology")).toBe(false);
    expect(hasCjk("astrology")).toBe(false);
  });
});

describe("cjkShare", () => {
  it("is 1 for pure CJK and 0 for pure Latin", () => {
    expect(cjkShare("占星命盘")).toBe(1);
    expect(cjkShare("astrology chart")).toBe(0);
  });

  it("ignores whitespace when measuring the share", () => {
    expect(cjkShare("  占星  ")).toBe(1);
  });

  it("measures the share in code points, not UTF-16 units", () => {
    // Four emoji are eight code units. Dividing by code units puts a page that
    // is 43% CJK under a 30% threshold and publishes the word count the
    // threshold exists to withhold.
    expect(cjkShare("占星图\u{1F600}\u{1F600}\u{1F600}\u{1F600}")).toBeCloseTo(
      3 / 7,
      5,
    );
  });

  it("returns 0 for text with no countable characters", () => {
    expect(cjkShare("   ")).toBe(0);
    expect(cjkShare("")).toBe(0);
  });

  it("measures a real mixed page below the CJK branch threshold", () => {
    // 2 CJK characters in 11 dense characters ("占星" + "astrology").
    expect(cjkShare("占星 astrology")).toBeCloseTo(2 / 11, 5);
  });
});

describe("TEXT_UNITS_VERSION", () => {
  it("is the frozen contract value", () => {
    expect(TEXT_UNITS_VERSION).toBe("text_units.v1");
  });
});

/**
 * The parser counts the body once, while it still has the text, and publishes
 * three numbers instead. Two implementations of one unit definition live in two
 * packages because the lower one cannot import the higher one — so they are
 * held together here, over real HTML rather than over a shared table. A guard
 * built from one side's own output would agree with itself and prove nothing.
 */
describe("the crawler's counts and this counter agree", () => {
  const CORPUS: readonly { readonly name: string; readonly html: string }[] = [
    {
      name: "Latin prose",
      html: `<html><body><p>Free birth chart calculator with instant results.</p><p>Read the placements below.</p></body></html>`,
    },
    {
      name: "Chinese prose",
      html: `<html><body><p>免费星盘计算器，输入出生时间即可查看完整星盘。</p></body></html>`,
    },
    {
      name: "English opening then a Chinese body",
      html: `<html><body><p>An English opening sentence.</p><p>${"中文正文内容".repeat(60)}</p></body></html>`,
    },
    {
      name: "no word gaps at all",
      html: `<html><body><p>${"星盘".repeat(200)}</p></body></html>`,
    },
    {
      name: "entities, emoji and astral characters",
      html: `<html><body><p>Caf&eacute; &amp; co 🎉 𝕬strology &#x4e2d;&#25991;</p></body></html>`,
    },
    {
      name: "empty body",
      html: `<html><body></body></html>`,
    },
  ];

  it.each(CORPUS)("$name", ({ name, html }) => {
    const parsed = parsePage(html, "https://example.com/");
    // Every fixture puts the whole body inside paragraph elements, so joining
    // them reproduces exactly the text the parser measured. That is a property
    // of the corpus, not of the parser, and it is what makes the two sides
    // comparable at all.
    const bodyText = parsed.paragraphs.join(" ");
    const fromText = countTextUnits(bodyText);
    const fromCounts = textUnitsFromCounts(parsed.onPage.textMetrics);

    // Without this, the empty case would pass by agreeing that nothing is
    // nothing, and so would a fixture whose text never reached either counter.
    if (name !== "empty body") expect(fromText.units).toBeGreaterThan(0);

    expect(fromCounts).toEqual(fromText);
    expect(
      Math.abs(
        cjkShareFromCounts(parsed.onPage.textMetrics) - cjkShare(bodyText),
      ),
    ).toBeLessThan(1e-9);

    // The term leaderboard reads phrases off an ordered version of the same
    // stream, and its densities are divided by this total. If the two counters
    // disagree the page shows one length and a set of percentages taken against
    // another, with nothing on screen to say which is which.
    expect(unitStream(bodyText)).toHaveLength(fromText.units);
  });
});

/**
 * The crawler's per-character test and the frozen counter must agree exactly.
 *
 * Two spellings of one rule, in two packages, and one of them was written by
 * copying characters: the copy arrived with U+8C48 where U+F900 belonged, which
 * renders identically and covers twenty-seven thousand more code points — Yi,
 * private use, Latin Extended-D, all silently counted as CJK. A corpus test
 * cannot find that, because a corpus contains the characters someone thought
 * of. This walks the whole plane the ranges live in.
 */
describe("the CJK unit ranges", () => {
  it("are the same set on both sides", () => {
    const disagreements: string[] = [];
    for (let code = 0; code <= 0xffff; code += 1) {
      // Surrogate halves are not characters; `hasCjk` sees a lone one as a
      // replacement and the numeric test never receives one from a real stream.
      if (code >= 0xd800 && code <= 0xdbff) continue;
      const char = String.fromCodePoint(code);
      if (hasCjk(char) !== isCjkUnit(code)) {
        disagreements.push(`U+${code.toString(16).toUpperCase()}`);
      }
    }
    expect(disagreements).toEqual([]);
  });
});
