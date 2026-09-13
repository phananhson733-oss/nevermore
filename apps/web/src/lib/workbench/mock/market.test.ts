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

  it.each(["US", "GB", "FR", "", "中文", "__proto__", "constructor", "toString"])(
    "falls back to en-US for %j",
    (code) => {
      expect(marketLanguage(code)).toBe("en-US");
    },
  );
});
