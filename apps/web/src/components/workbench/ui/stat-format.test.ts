/**
 * `statValue` is the fix for one specific defect, so these cases are the defect:
 * a known zero must survive as "0", and every flavour of "no value" must come
 * out as `null` — never as 0, never as the string "0", never as "NaN".
 */

import { describe, expect, it } from "vitest";
import { statValue, UNKNOWN_TEXT } from "./stat-format.ts";

describe("statValue", () => {
  it("keeps a measured zero", () => {
    // The whole reason this function exists: "0 artifacts this session" is a
    // fact, and both shortcuts that type-check without it lose it.
    expect(statValue(0)).toBe("0");
  });

  it("normalises negative zero, which String() renders as -0", () => {
    expect(statValue(-0)).toBe("0");
  });

  it("prints the digits of a known number without grouping or rounding", () => {
    expect(statValue(56)).toBe("56");
    expect(statValue(5000)).toBe("5000");
    expect(statValue(-3)).toBe("-3");
    expect(statValue(57.5)).toBe("57.5");
  });

  it("reads every kind of absent value as unknown", () => {
    const absent: readonly (number | null | undefined)[] = [
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];

    for (const n of absent) {
      const out = statValue(n);
      expect(out).toBeNull();
      // Stated separately: the failure mode being guarded against is not
      // "wrong type", it is "unknown was rendered as a value".
      expect(out).not.toBe("0");
      expect(out).not.toBe(0);
      expect(out).not.toBe("NaN");
    }
  });
});

describe("UNKNOWN_TEXT", () => {
  it("is an em dash, not a zero and not an empty string", () => {
    expect(UNKNOWN_TEXT).toBe("—");
    expect(UNKNOWN_TEXT).not.toBe("");
    expect(UNKNOWN_TEXT).not.toBe("0");
  });
});
