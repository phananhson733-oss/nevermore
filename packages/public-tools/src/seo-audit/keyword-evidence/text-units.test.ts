import { describe, expect, it } from "vitest";

import {
  cjkShare,
  countTextUnits,
  hasCjk,
  TEXT_UNITS_VERSION,
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
