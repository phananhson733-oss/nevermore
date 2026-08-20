import { describe, expect, it, vi } from "vitest";

import { hostKey, readSerpLandscape, SERP_LOCATIONS } from "./serp-landscape.ts";
import {
  DEFAULT_SERP_LANGUAGE,
  DEFAULT_SERP_MARKET,
  SERP_LANGUAGE_OPTIONS,
  SERP_MARKET_OPTIONS,
} from "./serp-markets.ts";

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
  const estimateTraffic = vi.fn(async (input: { readonly targets: readonly string[] }) => ({
    rows: input.targets.map((target) => ({ target, organicEtv: null })),
    unresolvedTargets: [],
    costUsd: 0,
  }));
  const client = { serpOrganic } as never;
  return {
    serpOrganic,
    estimateTraffic,
    dependencies: { client, estimateTraffic },
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
    const { dependencies, serpOrganic } = clientReturning(ROWS, [
      "organic",
      "ai_overview",
    ]);

    const result = await readSerpLandscape(
      {
        query: "birth chart",
        market: "us",
        language: "en-US",
        targetUrl: "https://www.acme.test/pricing",
      },
      dependencies,
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
    const { dependencies } = clientReturning(ROWS);

    const result = await readSerpLandscape(
      {
        query: "birth chart",
        market: "US",
        language: "en",
        targetUrl: "https://elsewhere.test/",
      },
      dependencies,
    );

    expect(result).toMatchObject({ availability: "available", targetPosition: null });
  });

  it("books what the call cost, since the provider itemises nothing per tool", async () => {
    const { dependencies } = clientReturning(ROWS);
    const onCost = vi.fn();

    await readSerpLandscape(
      { query: "q", market: "US", language: "en", targetUrl: "https://a.test/" },
      { ...dependencies, onCost },
    );

    expect(onCost).toHaveBeenCalledWith(0.002, "US", "q");
  });

  it("logs what it spent when nobody is listening", async () => {
    // The provider itemises nothing per tool, so a call nobody records is a
    // charge nobody can attribute.
    const { dependencies } = clientReturning(ROWS);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await readSerpLandscape(
        { query: "q", market: "US", language: "en", targetUrl: "https://a.test/" },
        dependencies,
      );
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining("[serp-landscape] paid_call cost_usd=0.002"),
      );
    } finally {
      info.mockRestore();
    }
  });

  it("spends nothing on a market it cannot look up", async () => {
    const { dependencies, serpOrganic } = clientReturning(ROWS);

    const result = await readSerpLandscape(
      { query: "q", market: "ZZ", language: "en", targetUrl: "https://a.test/" },
      dependencies,
    );

    expect(serpOrganic).not.toHaveBeenCalled();
    expect(result).toEqual({
      availability: "unavailable",
      reason: "market_not_supported",
    });
  });

  it("spends nothing when no query was submitted", async () => {
    const { dependencies, serpOrganic } = clientReturning(ROWS);

    const result = await readSerpLandscape(
      { query: null, market: "US", language: "en", targetUrl: "https://a.test/" },
      dependencies,
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
    const { dependencies } = clientReturning(
      ROWS,
      Array.from({ length: 60 }, (_, index) => `feature_${index}`.repeat(20)),
    );

    const result = await readSerpLandscape(
      { query: "q", market: "US", language: "en", targetUrl: "https://a.test/" },
      dependencies,
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
    const { dependencies } = clientReturning(ROWS);

    const result = await readSerpLandscape(
      { query: "q", market: "US", language: "en", targetUrl: "acme.test/pricing" },
      dependencies,
    );

    // Failing to parse our own target would have published "not among the top
    // ten" — a claim about the site, made because of a claim about the parser.
    expect(result).toMatchObject({ targetPosition: 2 });
  });

  it("will not claim the page when the provider gave no URL to compare", async () => {
    const { dependencies } = clientReturning([
      { rankGroup: 1, domain: "acme.test", sitelinkCount: 0, url: null },
    ]);

    const result = await readSerpLandscape(
      {
        query: "q",
        market: "US",
        language: "en",
        targetUrl: "https://acme.test/pricing",
      },
      dependencies,
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
    const { dependencies } = clientReturning([
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
      dependencies,
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
    const { dependencies, serpOrganic } = clientReturning(ROWS);

    const result = await readSerpLandscape(
      { query: "q", market: "US", language: "zz", targetUrl: "https://a.test/" },
      dependencies,
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

describe("what the form offers is what this lookup accepts", () => {
  /**
   * Crossing the boundary on purpose.
   *
   * Comparing the option list against the same table the options are built from
   * proves nothing. These run the real lookup for every code the selector can
   * emit, so a market that the form offers and this function refuses fails here
   * rather than as a visitor's spent-nothing "market not supported".
   */
  it.each(SERP_MARKET_OPTIONS.map((option) => option.code))(
    "looks up %s instead of refusing it",
    async (market) => {
      const { dependencies, serpOrganic } = clientReturning(ROWS);
      const result = await readSerpLandscape(
        {
          query: "q",
          market,
          language: DEFAULT_SERP_LANGUAGE,
          targetUrl: "https://a.test/",
        },
        dependencies,
      );
      expect(serpOrganic).toHaveBeenCalled();
      expect(result.availability).toBe("available");
    },
  );

  it.each(SERP_LANGUAGE_OPTIONS.map((option) => option.code))(
    "accepts %s instead of refusing it",
    async (language) => {
      const { dependencies, serpOrganic } = clientReturning(ROWS);
      const result = await readSerpLandscape(
        {
          query: "q",
          market: DEFAULT_SERP_MARKET,
          language,
          targetUrl: "https://a.test/",
        },
        dependencies,
      );
      expect(serpOrganic).toHaveBeenCalled();
      expect(result.availability).toBe("available");
    },
  );

  it("starts the form on a pair this lookup can serve", () => {
    expect(SERP_LOCATIONS[DEFAULT_SERP_MARKET]).toBeTypeOf("number");
    expect(
      SERP_MARKET_OPTIONS.some((o) => o.code === DEFAULT_SERP_MARKET),
    ).toBe(true);
    expect(
      SERP_LANGUAGE_OPTIONS.some((o) => o.code === DEFAULT_SERP_LANGUAGE),
    ).toBe(true);
  });

  it("gives every offered code a name that is not the code", () => {
    // An option reading "ZA (ZA)" means the label table missed an entry, which
    // the fallback hides.
    for (const option of [...SERP_MARKET_OPTIONS, ...SERP_LANGUAGE_OPTIONS]) {
      expect(option.label, option.code).not.toBe(option.code);
    }
  });
});
