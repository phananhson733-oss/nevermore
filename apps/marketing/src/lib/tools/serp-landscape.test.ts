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
  {
    rankGroup: 2,
    domain: "acme.test",
    sitelinkCount: 0,
    url: "https://www.acme.test/pricing",
  },
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
      targetPageOnPage: true,
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

  it("does not turn a missing credential into a five hundred", async () => {
    // The provider client throws AUTH_REQUIRED on an empty login. This runs
    // after a 240-second crawl has succeeded and the credit is already spent,
    // so a deployment without the variable set would have failed every finished
    // check — measured by constructing the real client with no credentials.
    const previousLogin = process.env["DATAFORSEO_LOGIN"];
    const previousPassword = process.env["DATAFORSEO_PASSWORD"];
    delete process.env["DATAFORSEO_LOGIN"];
    delete process.env["DATAFORSEO_PASSWORD"];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        readSerpLandscape({
          query: "birth chart",
          market: "US",
          language: "en",
          targetUrl: "https://a.test/",
        }),
      ).resolves.toEqual({
        availability: "unavailable",
        // Named apart from a provider outage: this one is ours to fix.
        reason: "provider_not_configured",
      });
    } finally {
      error.mockRestore();
      if (previousLogin !== undefined)
        process.env["DATAFORSEO_LOGIN"] = previousLogin;
      if (previousPassword !== undefined)
        process.env["DATAFORSEO_PASSWORD"] = previousPassword;
    }
  });

  it("bounds the provider's feature list where it is produced", async () => {
    const { client } = clientReturning(
      ROWS,
      Array.from({ length: 60 }, (_, index) => `feature_${index}`.repeat(20)),
    );

    const result = await readSerpLandscape(
      { query: "q", market: "US", language: "en", targetUrl: "https://a.test/" },
      { client },
    );

    // The guard that validates this shape allows 40 names of 64 characters. A
    // producer that emits more makes the guard reject the whole response.
    expect(result).toMatchObject({ availability: "available" });
    if (result.availability !== "available") return;
    expect(result.features?.length).toBeLessThanOrEqual(40);
    for (const feature of result.features ?? []) {
      expect(feature.length).toBeLessThanOrEqual(64);
    }
  });

  it("finds the target host even when the URL carries no scheme", async () => {
    const { client } = clientReturning(ROWS);

    const result = await readSerpLandscape(
      { query: "q", market: "US", language: "en", targetUrl: "acme.test/pricing" },
      { client },
    );

    // Failing to parse our own target would have published "not among the top
    // ten" — a claim about the site, made because of a claim about the parser.
    expect(result).toMatchObject({ targetPosition: 2 });
  });

  it("will not claim the page when the provider gave no URL to compare", async () => {
    const { client } = clientReturning([
      { rankGroup: 1, domain: "acme.test", sitelinkCount: 0, url: null },
    ]);

    const result = await readSerpLandscape(
      {
        query: "q",
        market: "US",
        language: "en",
        targetUrl: "https://acme.test/pricing",
      },
      { client },
    );

    expect(result).toMatchObject({ targetPosition: 1, targetPageOnPage: false });
    if (result.availability !== "available") return;
    // Null, not false: "we could not compare" is not "a different page".
    expect(result.rows[0]?.isTargetPage).toBeNull();
  });

  it("does not call a rival page of your own site your page", async () => {
    // Domain match is not page match, and the provider gives the URL. Reporting
    // only the host said "your page is at position 2" when position 2 was a
    // different page of theirs competing for the same query.
    const { client } = clientReturning([
      { rankGroup: 1, domain: "big.com", sitelinkCount: 0, url: "https://big.com/" },
      {
        rankGroup: 2,
        domain: "acme.test",
        sitelinkCount: 0,
        url: "https://acme.test/blog/pricing-guide",
      },
    ]);

    const result = await readSerpLandscape(
      {
        query: "pricing",
        market: "US",
        language: "en",
        targetUrl: "https://acme.test/pricing",
      },
      { client },
    );

    expect(result).toMatchObject({
      availability: "available",
      targetPosition: 2,
      targetPageOnPage: false,
    });
    if (result.availability !== "available") return;
    expect(result.rows[1]?.isTargetPage).toBe(false);
  });

  it("spends nothing on a language the provider was never going to accept", async () => {
    const { client, serpOrganic } = clientReturning(ROWS);

    const result = await readSerpLandscape(
      { query: "q", market: "US", language: "zz", targetUrl: "https://a.test/" },
      { client },
    );

    // The market was allow-listed for exactly this reason and the language was
    // not, so `zz` passed both layers and bought a provider error.
    expect(serpOrganic).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reason: "market_not_supported" });
  });

  it("covers the markets a Chinese-first product actually sells into", () => {
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
