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

  it("builds every script into a usable regular expression", () => {
    for (const [code, script] of EXPECTED_BRIEF_SCRIPTS) {
      expect(() => new RegExp(`[${script}]`, "u"), code).not.toThrow();
    }
  });
});
