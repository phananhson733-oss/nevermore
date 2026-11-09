// @input  -- integer minor-unit amounts and counts as the database sums them, in decimal strings
// @output -- proof that the earnings page shows them exactly, past the range a float holds, that a drama's free-episode line and 收费起始 follow its first paid episode, and that a clip named by a UUID or hash shows no title
// @pos    -- unit test for copy.ts formatting
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { clipTitle, episodeLine, formatCount, formatMoney, paidFrom, taskCopy } from "./copy.ts";

describe("formatMoney", () => {
  it("places the decimal point on the string, so no cent is rounded", () => {
    expect(formatMoney("9007199254740991", "USD", "en")).toBe("$90,071,992,547,409.91");
    expect(formatMoney("18014398509481982", "USD", "en")).toBe("$180,143,985,094,819.82");
    expect(formatMoney("5", "USD", "en")).toBe("$0.05");
    expect(formatMoney("0", "USD", "en")).toBe("$0.00");
  });

  it("follows the currency's own minor units", () => {
    expect(formatMoney("1500", "JPY", "en")).toBe("¥1,500");
    // ICU puts a no-break space after the code.
    expect(formatMoney("9007199254740991", "KWD", "en")).toMatch(/^KWD\s9,007,199,254,740\.991$/);
  });

  it("shows an unknown amount as a dash and refuses anything that is not minor units", () => {
    expect(formatMoney(null, "USD", "en")).toBe("—");
    expect(() => formatMoney("1.5", "USD", "en")).toThrow(RangeError);
    expect(() => formatMoney("-1", "USD", "en")).toThrow(RangeError);
  });
});

describe("formatCount", () => {
  it("formats summed counts exactly and unknown counts as a dash", () => {
    expect(formatCount("18014398509481982", "en")).toBe("18,014,398,509,481,982");
    expect(formatCount(12, "zh")).toBe("12");
    expect(formatCount(null, "zh")).toBe("—");
  });
});

describe("episodeLine", () => {
  const zh = taskCopy("zh");
  const en = taskCopy("en");

  it("counts the free episodes before the first paid one", () => {
    expect(episodeLine(60, 10, zh)).toBe("共 60 集 · 前 9 集免费");
    expect(episodeLine(60, 10, en)).toBe("60 episodes · first 9 free");
    expect(episodeLine(60, 1, zh)).toBe("共 60 集 · 第 1 集起付费");
    expect(episodeLine(60, 61, zh)).toBe("共 60 集 · 全部免费");
  });

  it("leaves out what nobody knows", () => {
    expect(episodeLine(60, null, zh)).toBe("共 60 集");
    expect(episodeLine(null, 10, zh)).toBe("前 9 集免费");
    expect(episodeLine(null, null, zh)).toBeNull();
  });
});

describe("paidFrom", () => {
  const zh = taskCopy("zh");
  const en = taskCopy("en");

  it("names the first paid episode, or says all are free when it lies past the last", () => {
    expect(paidFrom(60, 10, zh)).toBe("第 10 集");
    expect(paidFrom(60, 10, en)).toBe("Episode 10");
    expect(paidFrom(60, 1, zh)).toBe("第 1 集");
    expect(paidFrom(60, 61, zh)).toBe("全部免费");
    expect(paidFrom(null, 10, zh)).toBe("第 10 集");
  });

  it("is null when nobody knows", () => {
    expect(paidFrom(60, null, zh)).toBeNull();
  });
});

describe("clipTitle", () => {
  it("keeps a title a person wrote", () => {
    expect(clipTitle("  Ep 3 slap scene ")).toBe("Ep 3 slap scene");
    expect(clipTitle("第3集 高光")).toBe("第3集 高光");
  });

  it("drops machine names: a UUID, a long hash, the upload default", () => {
    expect(clipTitle("955b87e8-3c1d-4f0a-9b2e-1a2b3c4d5e6f")).toBeNull();
    expect(clipTitle("D41D8CD98F00B204E9800998ECF8427E")).toBeNull();
    expect(clipTitle("clip")).toBeNull();
    expect(clipTitle("   ")).toBeNull();
  });
});
