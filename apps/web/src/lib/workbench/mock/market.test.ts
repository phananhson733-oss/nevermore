import { describe, expect, it } from "vitest";
import { marketLanguage } from "./market.ts";

describe("marketLanguage", () => {
  it.each([
    ["CN", "zh-CN"],
    ["cn", "zh-CN"],
    ["Cn", "zh-CN"],
    ["TW", "zh-TW"],
    ["HK", "zh-HK"],
    ["JP", "ja-JP"],
    ["KR", "ko-KR"],
  ])("maps %s to %s", (code, language) => {
    expect(marketLanguage(code)).toBe(language);
  });

  it.each(["US", "GB", "FR", "", "中文"])(
    "falls back to en-US for %j",
    (code) => {
      expect(marketLanguage(code)).toBe("en-US");
    },
  );

  // Smoke only. toUpperCase() already turns these into keys Object.prototype does
  // not have, so they would fall back with a plain object lookup too; they are not
  // evidence for the Map.
  it.each(["__proto__", "constructor", "toString"])(
    "smoke: %j falls back to en-US",
    (code) => {
      expect(marketLanguage(code)).toBe("en-US");
    },
  );
});
