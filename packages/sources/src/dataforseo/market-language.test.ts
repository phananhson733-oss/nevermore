import { describe, expect, it } from "vitest";

import { DATAFORSEO_LABS_LOCATIONS } from "./generated/labs-locations.ts";
import {
  dataForSeoMarketLimitation,
  resolveDataForSeoMarket,
} from "./market-language.ts";

describe("resolveDataForSeoMarket", () => {
  it("resolves a served market to the provider's own location code", () => {
    expect(resolveDataForSeoMarket("US")).toEqual({
      locationCode: 2840,
      locationName: "United States",
      languageCode: "en",
    });
  });

  it("never derives the search language from an operator's UI locale", () => {
    // The production defect: a Chinese-speaking operator researching the US
    // market sent language_code "zh", which DataForSEO Labs rejects with task
    // status 40501. The market alone decides the search language.
    const resolved = resolveDataForSeoMarket("US");
    expect(resolved?.languageCode).toBe("en");
    expect(DATAFORSEO_LABS_LOCATIONS["US"]?.languageCodes).not.toContain("zh");
  });

  it("uses the market's own language when the market is not anglophone", () => {
    expect(resolveDataForSeoMarket("JP")?.languageCode).toBe("ja");
    expect(resolveDataForSeoMarket("DE")?.languageCode).toBe("de");
    expect(resolveDataForSeoMarket("AR")?.languageCode).toBe("es");
  });

  it("uses the provider's spelling, not the Intl English exonym", () => {
    // Intl.DisplayNames renders these as "Türkiye", "Bosnia & Herzegovina" and
    // "Côte d'Ivoire", none of which DataForSEO accepts as a location_name.
    // Resolving to location_code removes the whole class of spelling mismatch.
    expect(resolveDataForSeoMarket("TR")).toEqual({
      locationCode: 2792,
      locationName: "Turkiye",
      languageCode: "tr",
    });
    expect(resolveDataForSeoMarket("BA")?.locationName).toBe(
      "Bosnia and Herzegovina",
    );
    expect(resolveDataForSeoMarket("CI")?.locationName).toBe("Cote d'Ivoire");
  });

  it("accepts lowercase and padded market codes", () => {
    expect(resolveDataForSeoMarket(" us ")?.locationCode).toBe(2840);
    expect(resolveDataForSeoMarket("jp")?.languageCode).toBe("ja");
  });

  it("returns null for a market DataForSEO Labs does not serve", () => {
    // Roughly two thirds of ISO 3166-1 countries have no Labs database. The
    // caller must skip discovery rather than enqueue a request that can only
    // fail permanently.
    expect(resolveDataForSeoMarket("AQ")).toBeNull();
    expect(resolveDataForSeoMarket("VA")).toBeNull();
  });

  it("returns null for anything that is not an alpha-2 market code", () => {
    expect(resolveDataForSeoMarket("")).toBeNull();
    expect(resolveDataForSeoMarket("USA")).toBeNull();
    expect(resolveDataForSeoMarket("u1")).toBeNull();
    expect(resolveDataForSeoMarket(undefined)).toBeNull();
    expect(resolveDataForSeoMarket(null)).toBeNull();
    expect(resolveDataForSeoMarket(840)).toBeNull();
  });

  it("only ever returns a language the provider serves for that location", () => {
    for (const [marketCode, entry] of Object.entries(
      DATAFORSEO_LABS_LOCATIONS,
    )) {
      const resolved = resolveDataForSeoMarket(marketCode);
      expect(resolved).not.toBeNull();
      expect(entry.languageCodes).toContain(resolved?.languageCode);
      expect(resolved?.locationCode).toBe(entry.locationCode);
    }
  });

  it("is deterministic", () => {
    expect(resolveDataForSeoMarket("CA")).toEqual(
      resolveDataForSeoMarket("CA"),
    );
  });

  describe("with a configured language preference", () => {
    it("honours a language the provider serves for that location", () => {
      expect(resolveDataForSeoMarket("US", "es")?.languageCode).toBe("es");
      expect(resolveDataForSeoMarket("US", "es-MX")?.languageCode).toBe("es");
      expect(resolveDataForSeoMarket("US", "EN-GB")?.languageCode).toBe("en");
    });

    it("ignores a language the provider does not serve there", () => {
      // The whole defect in one line: a Chinese-language site targeting the US
      // must still be researched in English, because Labs has no zh database
      // for location 2840 and rejects the request outright.
      expect(resolveDataForSeoMarket("US", "zh-CN")?.languageCode).toBe("en");
      expect(resolveDataForSeoMarket("JP", "en")?.languageCode).toBe("ja");
    });

    it("ignores a preference that is not a usable tag", () => {
      expect(resolveDataForSeoMarket("US", "")?.languageCode).toBe("en");
      expect(resolveDataForSeoMarket("US", null)?.languageCode).toBe("en");
      expect(resolveDataForSeoMarket("US", 42)?.languageCode).toBe("en");
    });

    it("still only ever returns a served language, for every market", () => {
      for (const [marketCode, entry] of Object.entries(
        DATAFORSEO_LABS_LOCATIONS,
      )) {
        const resolved = resolveDataForSeoMarket(marketCode, "zh-CN");
        expect(entry.languageCodes).toContain(resolved?.languageCode);
      }
    });
  });
});

describe("dataForSeoMarketLimitation", () => {
  it("states the searched market and language as a plain fact", () => {
    const limitation = dataForSeoMarketLimitation(
      "astrologywiki.com",
      { locationCode: 2840, locationName: "United States", languageCode: "en" },
      { rankedKeywords: 200, competitorDomains: 100 },
    );
    expect(limitation).toContain("astrologywiki.com");
    expect(limitation).toContain("United States");
    expect(limitation).toContain("en");
    expect(limitation).toContain("200");
    expect(limitation).toContain("100");
  });

  it("says the search language follows the market, not the report language", () => {
    const limitation = dataForSeoMarketLimitation(
      "example.com",
      { locationCode: 2840, locationName: "United States", languageCode: "en" },
      { rankedKeywords: 200, competitorDomains: 100 },
    );
    expect(limitation).toMatch(/search language/i);
    expect(limitation).toMatch(/not the report language/i);
  });

  it("never claims intersections are a similarity score", () => {
    const limitation = dataForSeoMarketLimitation(
      "example.com",
      { locationCode: 2392, locationName: "Japan", languageCode: "ja" },
      { rankedKeywords: 50, competitorDomains: 25 },
    );
    expect(limitation).toContain("counts, not similarity percentages");
  });
});
