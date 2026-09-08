// @input  -- the market and language lists the brief tools offer
// @output -- proof that every offered language is one the brief can check
// @pos    -- the only place both lists are importable; the package cannot import an app
import { describe, expect, it } from "vitest";
import { EXPECTED_BRIEF_SCRIPTS } from "@sf/public-tools/content-brief/constants";

import { SERP_LANGUAGES } from "./serp-markets.ts";

describe("SERP_LANGUAGES", () => {
  it("gives every offered language a script the generated brief must contain", () => {
    // EXPECTED_BRIEF_SCRIPTS lives in @sf/public-tools, which must not import an
    // app, so the two lists cannot check each other where either one is written.
    // A language added here and missed there is not an error anywhere: the brief
    // simply stops being checked for that language, in silence.
    const missing = [...SERP_LANGUAGES].filter((code) => !EXPECTED_BRIEF_SCRIPTS.has(code));

    expect(missing).toEqual([]);
  });

  it("does not carry a script for a language nobody can pick", () => {
    const unreachable = [...EXPECTED_BRIEF_SCRIPTS.keys()].filter((code) => !SERP_LANGUAGES.has(code));

    expect(unreachable).toEqual([]);
  });

  // Written here rather than derived from the table, so the two sides are
  // independent: a table whose scripts were all replaced with Latin, or with
  // nothing at all, compiles fine and matches nothing that matters.
  const SAMPLE: Readonly<Record<string, string>> = {
    zh: "\u4e2d", ja: "\u3042", ko: "\ud55c", th: "\u0e44", ru: "\u0434", uk: "\u0434",
    ar: "\u0639", he: "\u05e2", hi: "\u0939", el: "\u03b1",
  };

  it("matches the script each language is actually written in", () => {
    for (const [code, script] of EXPECTED_BRIEF_SCRIPTS) {
      const pattern = new RegExp(`[${script}]`, "u");
      expect(pattern.test(SAMPLE[code] ?? "a"), code).toBe(true);
    }
  });

  it("does not let one unsegmented script stand in for another", () => {
    // Han, kana, Hangul and Thai share one class in the tokenizer. A Chinese
    // brief written in Hangul must not pass by sharing that bucket.
    const chinese = new RegExp(`[${EXPECTED_BRIEF_SCRIPTS.get("zh")!}]`, "u");

    expect(chinese.test(SAMPLE.ko!)).toBe(false);
    expect(chinese.test(SAMPLE.ja!)).toBe(false);
    expect(chinese.test(SAMPLE.th!)).toBe(false);
    expect(chinese.test(SAMPLE.zh!)).toBe(true);
  });
});
