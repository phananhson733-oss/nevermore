import { describe, expect, it, vi } from "vitest";

import { hostKey, readSerpLandscape, SERP_LOCATIONS } from "./serp-landscape.ts";

function clientReturning(rows: readonly unknown[], itemTypes: unknown = null) {
  const serpOrganic = vi.fn(async () => ({
    keyword: "birth chart",
    rows,
    itemTypes,
    unresolvedItemCount: 0,
    costUsd: 0.002,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
  }));
  return {
    serpOrganic,
    client: { serpOrganic } as never,
  };
}

const ROWS = [
  { rankGroup: 1, domain: "big.com", sitelinkCount: 4, url: "https://big.com/" },
  { rankGroup: 2, domain: "acme.test", sitelinkCount: 0, url: null },
  { rankGroup: 3, domain: "small.io", sitelinkCount: 0, url: null },
];

describe("readSerpLandscape", () => {
  it("reads page one and finds this page's own domain on it", async () => {
    const { client, serpOrganic } = clientReturning(ROWS, ["organic", "ai_overview"]);

    const result = await readSerpLandscape(
      {
        query: "birth chart",
        market: "us",
        language: "en-US",
        targetUrl: "https://www.acme.test/pricing",
      },
      { client },
    );

    expect(serpOrganic).toHaveBeenCalledWith({
      keyword: "birth chart",
      locationCode: SERP_LOCATIONS["US"],
      // The provider takes a bare language code; `en-US` is a paid error.
      languageCode: "en",
      depth: 10,
    });
    expect(result).toMatchObject({
      availability: "available",
      market: "US",
      language: "en",
      resultsObserved: 3,
      withSitelinks: 1,
      targetPosition: 2,
      features: ["organic", "ai_overview"],
    });
  });

  it("reports a page that is not on the results it read, without calling it unranked", async () => {
    const { client } = clientReturning(ROWS);

    const result = await readSerpLandscape(
      {
        query: "birth chart",
        market: "US",
        language: "en",
        targetUrl: "https://elsewhere.test/",
      },
      { client },
    );

    expect(result).toMatchObject({ availability: "available", targetPosition: null });
  });

  it("books what the call cost, since the provider itemises nothing per tool", async () => {
    const { client } = clientReturning(ROWS);
    const onCost = vi.fn();

    await readSerpLandscape(
      { query: "q", market: "US", language: "en", targetUrl: "https://a.test/" },
      { client, onCost },
    );

    expect(onCost).toHaveBeenCalledWith(0.002);
  });

  it("spends nothing on a market it cannot look up", async () => {
    const { client, serpOrganic } = clientReturning(ROWS);

    const result = await readSerpLandscape(
      { query: "q", market: "ZZ", language: "en", targetUrl: "https://a.test/" },
      { client },
    );

    expect(serpOrganic).not.toHaveBeenCalled();
    expect(result).toEqual({
      availability: "unavailable",
      reason: "market_not_supported",
    });
  });

  it("spends nothing when no query was submitted", async () => {
    const { client, serpOrganic } = clientReturning(ROWS);

    const result = await readSerpLandscape(
      { query: null, market: "US", language: "en", targetUrl: "https://a.test/" },
      { client },
    );

    expect(serpOrganic).not.toHaveBeenCalled();
    expect(result).toEqual({
      availability: "unavailable",
      reason: "no_target_query",
    });
  });

  it("resolves rather than throws when the provider fails", async () => {
    // The crawl has already finished by the time this runs. Losing it to a
    // provider timeout would trade the thing the visitor asked for against the
    // thing they did not.
    const client = {
      serpOrganic: vi.fn(async () => {
        throw new Error("upstream 502");
      }),
    } as never;

    const result = await readSerpLandscape(
      { query: "q", market: "US", language: "en", targetUrl: "https://a.test/" },
      { client },
    );

    expect(result).toEqual({
      availability: "unavailable",
      reason: "provider_unavailable",
    });
  });

  it("covers the markets a Chinese-first product actually sells into", async () => {
    for (const market of ["CN", "TW", "HK", "SG", "JP", "US"]) {
      expect(SERP_LOCATIONS[market], market).toBeTypeOf("number");
    }
  });
});

describe("hostKey", () => {
  it("matches the provider's own spelling of a host", () => {
    expect(hostKey("https://WWW.Acme.test/pricing?x=1")).toBe("acme.test");
    expect(hostKey("not a url")).toBeNull();
  });
});
