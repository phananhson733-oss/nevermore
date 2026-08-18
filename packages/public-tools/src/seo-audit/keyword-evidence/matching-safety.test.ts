// @input  -- the source of the modules that handle a visitor's own query text
// @output -- a failing test when one of them builds a pattern out of that text
// @pos    -- the frozen "never a dynamic RegExp" rule, made checkable
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { countOccurrencesInText, tokenizationOf } from "./match.ts";

/**
 * Modules that receive the query the visitor typed.
 *
 * The contract forbids building a regular expression out of it. A query is
 * arbitrary text, so `new RegExp(query)` turns `a+` into a quantifier and
 * `(((((…` into a pattern that costs more to compile than to send — and the
 * matcher runs against six page fields for up to five queries, server-side,
 * inside the request the visitor is waiting on.
 *
 * The rule is a source check because the alternative is testing for the absence
 * of a behaviour: the correct implementation and the dangerous one agree on
 * every ordinary input, and only diverge on the ones an attacker chooses.
 */
const QUERY_HANDLING = ["./match.ts", "./normalize.ts", "./evidence.ts"];

describe("query matching never compiles the query", () => {
  it.each(QUERY_HANDLING)("%s builds no RegExp at all", (relative) => {
    const source = readFileSync(
      fileURLToPath(new URL(relative, import.meta.url)),
      "utf8",
    );

    // Not "no RegExp built from a variable" — no RegExp constructor, full stop.
    // A constructor call whose argument is a constant today is one edit away
    // from taking the query, and that edit reads as harmless.
    expect(source).not.toContain("new RegExp");
    // The same hole through the other door.
    expect(source).not.toMatch(/RegExp\s*\(/);
  });

  /**
   * And the behaviour the rule protects: a query made of regex metacharacters is
   * matched as the literal text it is.
   */
  it("treats metacharacters as text", () => {
    const query = "a+b";
    const tokenization = tokenizationOf(query);

    expect(countOccurrencesInText(query, "a+b and a+b again", tokenization)).toBe(
      2,
    );
    // `a+` as a quantifier would match "aaab"; as text it does not appear.
    expect(countOccurrencesInText(query, "aaab", tokenization)).toBe(0);
  });

  it("does not hang on a pathological query", () => {
    const query = `${"(".repeat(2_000)}x`;
    const tokenization = tokenizationOf(query);
    const started = process.hrtime.bigint();

    expect(countOccurrencesInText(query, "no such text here", tokenization)).toBe(
      0,
    );

    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    // A compiled pattern is where the time would go; literal scanning is linear.
    expect(elapsedMs).toBeLessThan(250);
  });
});
