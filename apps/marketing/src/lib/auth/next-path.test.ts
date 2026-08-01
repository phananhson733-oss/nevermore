import { describe, expect, it } from "vitest";

import { safeNextPath } from "./next-path.ts";

/**
 * The return-path guard.
 *
 * This shipped accepting `/\evil.com`, because the guard and its consumer
 * disagreed about what a path is: the guard asked whether the string starts
 * with `/` and not `//`, while `new URL(next, origin)` in the callback follows
 * the WHATWG rules, which promote a backslash to a separator and strip tabs,
 * newlines and carriage returns from anywhere in the input.
 *
 * Each payload is asserted against `new URL` first, so the test states WHY it
 * is dangerous instead of only pinning a return value. If a future parser
 * stops treating one of them as an authority, that surfaces here as a changed
 * premise rather than a quietly weaker test.
 */
const ORIGIN = "https://gengrowth.ai";

describe("safeNextPath", () => {
  it("keeps ordinary same-site paths, including query and fragment", () => {
    expect(safeNextPath("/tools/traffic-drop-diagnosis")).toBe(
      "/tools/traffic-drop-diagnosis",
    );
    expect(safeNextPath("/zh/tools/traffic-drop-diagnosis?a=1#b")).toBe(
      "/zh/tools/traffic-drop-diagnosis?a=1#b",
    );
    expect(safeNextPath("/")).toBe("/");
  });

  it("rejects every input that would resolve to another origin", () => {
    const escapes = [
      "//evil.com",
      "https://evil.com",
      // Backslash: a separator in special schemes, so this is an authority.
      "/\\evil.com",
      "/\\/evil.com",
      // C0 controls are stripped before parsing, so what remains is `//`.
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
    ];

    for (const raw of escapes) {
      const label = JSON.stringify(raw);
      // The premise: left alone, this really does leave the site.
      expect(
        new URL(raw, ORIGIN).origin,
        `${label} was expected to resolve off-origin`,
      ).not.toBe(ORIGIN);

      // The guard: it never gets that far.
      expect(safeNextPath(raw), label).toBe("/");
      expect(new URL(safeNextPath(raw), ORIGIN).origin).toBe(ORIGIN);
    }
  });

  it("falls back to the site root for a missing or relative target", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath("tools/traffic-drop-diagnosis")).toBe("/");
  });
});
