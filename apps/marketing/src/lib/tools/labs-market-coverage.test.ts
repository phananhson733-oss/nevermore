// @input  -- the shipped SERP market list and the Labs language table
// @output -- proof no market goes silently unsized, and none is guessed at
// @pos    -- the guard for a table that lives in another package

import { describe, expect, it } from "vitest";
import { labsLanguageForMarket } from "@sf/sources/dataforseo/labs-traffic";

import { SERP_LOCATIONS } from "./serp-markets.ts";

/**
 * Markets DataForSEO Labs cannot serve at all.
 *
 * Listed here, with a count, so adding a market never silently lands in the
 * unsized bucket: a new entry in SERP_LOCATIONS that Labs cannot serve has to
 * be added here deliberately, and one that Labs CAN serve fails until its
 * language is filled in.
 */
const UNSERVED_BY_LABS: readonly string[] = ["CN"];

describe("Labs traffic market coverage", () => {
  it("resolves a language for every shipped market except the known gaps", () => {
    const unresolved = Object.keys(SERP_LOCATIONS).filter(
      (market) => labsLanguageForMarket(market) === null,
    );

    expect(unresolved.sort()).toEqual([...UNSERVED_BY_LABS].sort());
  });

  it("keeps exactly one market unsized, and names it", () => {
    // Chinese mainland is not in the Labs location list at all, so no language
    // makes the pair legal. The product ships that market deliberately, so the
    // check reports it as unmeasurable rather than refusing the market.
    expect(UNSERVED_BY_LABS).toHaveLength(1);
    expect(SERP_LOCATIONS["CN"]).toBe(2156);
  });

  it("does not invent a market the product does not ship", () => {
    // The first version of this table was written from memory and carried AT,
    // CH, BE, AR and eleven others that have never shipped. A language for a
    // market nobody can select is dead weight that reads as coverage.
    for (const market of ["AT", "CH", "BE", "AR", "RU", "TR"]) {
      expect(SERP_LOCATIONS[market]).toBeUndefined();
      expect(labsLanguageForMarket(market)).toBeNull();
    }
  });

  it("never sends the SERP call's bare subtag where Labs needs a full tag", () => {
    // Labs serves Norway only as `nb` and Taiwan only as `zh-TW`; the SERP
    // call normalises to `no` and `zh` on purpose. Reusing that pair here is a
    // paid error, not an answer.
    expect(labsLanguageForMarket("NO")).toBe("nb");
    expect(labsLanguageForMarket("TW")).toBe("zh-TW");
    expect(labsLanguageForMarket("HK")).toBe("zh-TW");
  });
});
