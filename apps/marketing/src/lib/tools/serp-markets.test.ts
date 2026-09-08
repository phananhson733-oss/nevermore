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
  // One character per script the language may be written in, not one per
  // language: a single sample proves only the first entry, so dropping Hindi's
  // Latin or Japanese's kanji went unnoticed.
  const SAMPLE: Readonly<Record<string, readonly string[]>> = {
    zh: ["\u4e2d"], ja: ["\u6f22", "\u3042", "\u30a2"], ko: ["\ud55c"], th: ["\u0e44"],
    ru: ["\u0434"], uk: ["\u0434"], ar: ["\u0639"], he: ["\u05e2"],
    hi: ["\u0939", "a"], el: ["\u03b1"],
  };

  it("matches every script each language is actually written in", () => {
    for (const [code, script] of EXPECTED_BRIEF_SCRIPTS) {
      const pattern = new RegExp(`[${script}]`, "u");
      for (const sample of SAMPLE[code] ?? ["a"]) {
        expect(pattern.test(sample), `${code} ${sample}`).toBe(true);
      }
    }
  });

  it("counts one script entry per script the sample exercises", () => {
    // Otherwise a table entry could carry a script no sample reaches, and
    // dropping it would still pass the test above.
    for (const [code, samples] of Object.entries(SAMPLE)) {
      expect(EXPECTED_BRIEF_SCRIPTS.get(code)?.split("\\p{Script=").length, code).toBe(samples.length + 1);
    }
  });

  it("does not let one unsegmented script stand in for another", () => {
    // Han, kana, Hangul and Thai share one class in the tokenizer. A Chinese
    // brief written in Hangul must not pass by sharing that bucket.
    const chinese = new RegExp(`[${EXPECTED_BRIEF_SCRIPTS.get("zh")!}]`, "u");

    for (const sample of [SAMPLE.ko![0]!, SAMPLE.ja![1]!, SAMPLE.ja![2]!, SAMPLE.th![0]!]) {
      expect(chinese.test(sample), sample).toBe(false);
    }
    expect(chinese.test(SAMPLE.zh![0]!)).toBe(true);
  });
});
