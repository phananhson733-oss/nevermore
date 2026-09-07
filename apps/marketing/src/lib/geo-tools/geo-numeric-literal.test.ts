import { describe, expect, it } from "vitest";

import { geoNumbersSupported, geoNumericLiterals } from "./geo-numeric-literal.ts";

describe("geoNumericLiterals", () => {
  it.each(["$", "€", "£", "¥", "₩", "₹", "₽", "₺", "₪", "฿", "₫", "₴", "¤", "＄", "￥", "₨", "﷼"])(
    "keeps %s attached to the number it prices",
    sign => expect(geoNumericLiterals(`${sign}9,900 today`)).toEqual([`${sign}9,900`]),
  );

  it("reads a signless number as signless", () => expect(geoNumericLiterals("9,900 today")).toEqual(["9,900"]));

  it("keeps every currency distinct from every other and from a bare number", () => {
    const priced = ["$100", "₩100", "₹100", "₨100", "100"];
    expect(new Set(priced.map(value => geoNumericLiterals(value)[0])).size).toBe(priced.length);
  });
});

describe("geoNumbersSupported", () => {
  it.each(["₩", "₹", "₽", "₺", "₪", "฿", "₫", "₴", "₨", "﷼"])(
    "refuses a %s claim that the evidence states without a currency",
    sign => expect(geoNumbersSupported([`Seats cost ${sign}100.`], ["Seats cost 100."])).toBe(false),
  );

  it("refuses a claim that swaps one currency for another", () => {
    expect(geoNumbersSupported(["Seats cost ₩100."], ["Seats cost ¥100."])).toBe(false);
  });

  it("accepts a claim whose number and currency both occur in the evidence", () => {
    expect(geoNumbersSupported(["Seats cost ₩9,900."], ["Our plan is ₩9,900 per seat."])).toBe(true);
  });

  it("accepts a claim that asserts no number at all", () => {
    expect(geoNumbersSupported(["Seats are available."], ["Our plan has seats."])).toBe(true);
  });

  /**
   * NFKC decomposes exactly two currency signs to letters -- ₨ to `Rs` and ﷼ to
   * `ریال`. Normalizing before tokenizing would therefore hand these two back
   * the bug every other sign was just fixed for. Pinned as behaviour, not as a
   * comment, because the sibling guard in `packages/artifacts/src/llm/` does
   * normalize and a later reader may reasonably try to copy it here.
   */
  it.each(["₨", "﷼"])("does not let %s decompose into letters and lose its sign", sign => {
    expect(geoNumericLiterals(`${sign}100`)).toEqual([`${sign}100`]);
    expect(geoNumbersSupported([`${sign}100`], ["100"])).toBe(false);
  });

  /**
   * The other half of the same decision: this tokenizer is `\p{N}`, so `½` and
   * `2²` are literals it already checks. NFKC would rewrite them to `1⁄2` and
   * `22` and let a claim of `½` ride on an excerpt that merely says `1` and `2`.
   * A guard may become stricter; it may not start publishing what it blocks.
   */
  it("keeps a compatibility numeral as the single literal it is written as", () => {
    expect(geoNumericLiterals("½")).toEqual(["½"]);
    expect(geoNumbersSupported(["½ of a seat"], ["1 seat for 2 people"])).toBe(false);
    expect(geoNumbersSupported(["2² seats"], ["22 seats"])).toBe(false);
  });
});
