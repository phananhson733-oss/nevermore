// @input  -- integer minor-unit amounts and counts as the database sums them, in decimal strings
// @output -- proof that the earnings page shows them exactly, past the range a float holds
// @pos    -- unit test for copy.ts formatting
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import { formatCount, formatMoney } from "./copy.ts";

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
