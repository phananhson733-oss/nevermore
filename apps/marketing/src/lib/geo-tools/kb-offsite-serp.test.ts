import { describe, expect, it, vi } from "vitest";
import type { DataForSeoKeywordMetricsClient } from "@sf/sources";

import {
  classifyGeoOffsiteVenue,
  geoOffsiteBrandQueries,
  readGeoOffsiteSerp,
  GEO_OFFSITE_SERP_LIMITS,
  type GeoOffsiteSerpFetch,
  type GeoOffsiteSerpResultRow,
} from "./kb-offsite-serp.ts";

/**
 * The seam has to stay the real client's method, not a shape that drifted away
 * from it. A type error here means the provider changed and this module would
 * have needed an HTTP layer of its own -- which is the thing it must not grow.
 */
const providerSeam: GeoOffsiteSerpFetch = (() => {
  const method = undefined as unknown as DataForSeoKeywordMetricsClient["serpOrganic"];
  return method;
})();
void providerSeam;

const row = (rankGroup: number, url: string, title: string | null = "A title"): GeoOffsiteSerpResultRow =>
  ({ rankGroup, domain: new URL(url).hostname.replace(/^www\./u, ""), title, url });

const reader = (rowsByQuery: Readonly<Record<string, readonly GeoOffsiteSerpResultRow[] | "throw">>) => {
  const calls: string[] = [];
  const serpOrganic: GeoOffsiteSerpFetch = async (request) => {
    calls.push(request.keyword);
    const rows = rowsByQuery[request.keyword];
    if (rows === undefined || rows === "throw") throw new Error("provider unavailable");
    return { rows, costUsd: 0.002 };
  };
  return { calls, serpOrganic };
};

const input = {
  brandName: "Acme Analytics",
  market: "US",
  language: "en",
  officialHosts: ["acme.example"],
  competitorHosts: ["rival.example"],
};

const QUERIES = ['"Acme Analytics"', "Acme Analytics reviews", "Acme Analytics alternatives"];

describe("the three brand queries", () => {
  it("quotes the exact-name query and appends the two intent words", () => {
    expect(geoOffsiteBrandQueries("Acme Analytics").map((entry) => entry.query)).toEqual(QUERIES);
    expect(geoOffsiteBrandQueries("Acme Analytics").map((entry) => entry.kind))
      .toEqual(["brand_exact", "brand_reviews", "brand_alternatives"]);
  });

  it("asks nothing for a name the alias matcher would never look for", () => {
    // Two Latin characters collide with every acronym on the page, so three
    // paid calls would buy results nothing downstream could cross-reference.
    expect(geoOffsiteBrandQueries("AB")).toEqual([]);
  });

  it("cannot truncate its own candidates under the shipped budget", () => {
    // Three queries of ten results can never exceed the carry limit. If depth
    // or query count is raised, `candidatesDropped` reports the loss instead of
    // the list silently getting shorter.
    expect(GEO_OFFSITE_SERP_LIMITS.queries * GEO_OFFSITE_SERP_LIMITS.depth)
      .toBeLessThanOrEqual(GEO_OFFSITE_SERP_LIMITS.candidates);
  });
});

describe("the domain classification table", () => {
  it("sorts identity records, review venues and publications apart", () => {
    expect(classifyGeoOffsiteVenue("en.wikipedia.org")).toMatchObject({
      category: "third_party_profile", sameAsEligible: true, ownerPublished: false,
    });
    expect(classifyGeoOffsiteVenue("www.g2.com")).toMatchObject({
      category: "third_party_profile", ownerSubmittable: true, sameAsEligible: true,
    });
    expect(classifyGeoOffsiteVenue("trustpilot.com")).toMatchObject({ category: "review", sameAsEligible: false });
    expect(classifyGeoOffsiteVenue("techcrunch.com")).toMatchObject({ category: "media", sameAsEligible: false });
  });

  it("marks a venue the subject publishes on as owner-published", () => {
    expect(classifyGeoOffsiteVenue("apps.apple.com")?.ownerPublished).toBe(true);
    expect(classifyGeoOffsiteVenue("play.google.com")?.ownerPublished).toBe(true);
    expect(classifyGeoOffsiteVenue("linkedin.com")?.ownerPublished).toBe(true);
  });

  it("matches exact subdomains, not registrable domains", () => {
    // `play.google.com` is a listed app store; `news.google.com` is not listed
    // at all, and guessing from the registrable domain would file it as one.
    expect(classifyGeoOffsiteVenue("news.google.com")).toBeNull();
    expect(classifyGeoOffsiteVenue("blog.unknown.example")).toBeNull();
  });

  it("carries a written basis for every row, so the table can be audited", () => {
    expect(classifyGeoOffsiteVenue("crunchbase.com")?.basis).toContain("claim");
  });
});

describe("reading the results", () => {
  it("groups, de-duplicates and orders candidates by what the domain publishes", async () => {
    const onCost = vi.fn();
    const { calls, serpOrganic } = reader({
      [QUERIES[0]!]: [row(1, "https://www.acme.example/"), row(2, "https://en.wikipedia.org/wiki/Acme_Analytics")],
      [QUERIES[1]!]: [row(3, "https://www.g2.com/products/acme/reviews"), row(4, "https://techcrunch.com/2026/acme")],
      [QUERIES[2]!]: [row(1, "https://en.wikipedia.org/wiki/Acme_Analytics"), row(5, "https://rival.example/compare")],
    });
    const reading = await readGeoOffsiteSerp(input, { serpOrganic, onCost });

    expect(calls).toEqual(QUERIES);
    expect(reading.availability).toBe("available");
    expect(reading.costUsd).toBeCloseTo(0.006, 10);
    expect(onCost).toHaveBeenCalledTimes(3);
    // Own pages are own-site evidence and a confirmed rival's page is competitor
    // evidence; neither may be relabelled as a third party.
    expect(reading.ownResultsSkipped).toBe(1);
    expect(reading.competitorResultsSkipped).toBe(1);
    expect(reading.candidates.map((candidate) => candidate.host))
      .toEqual(["en.wikipedia.org", "www.g2.com", "techcrunch.com"]);
    expect(reading.candidates.map((candidate) => candidate.category))
      .toEqual(["third_party_profile", "third_party_profile", "media"]);
    const [wikipedia] = reading.candidates;
    expect(wikipedia?.bestPosition).toBe(1);
    expect(wikipedia?.queries).toEqual(["brand_exact", "brand_alternatives"]);
    expect(wikipedia?.url).toBe("https://en.wikipedia.org/wiki/Acme_Analytics");
  });

  it("keeps the queries that answered when one fails", async () => {
    const { serpOrganic } = reader({
      [QUERIES[0]!]: [row(1, "https://en.wikipedia.org/wiki/Acme_Analytics")],
      [QUERIES[1]!]: "throw",
      [QUERIES[2]!]: [row(2, "https://trustpilot.com/review/acme.example")],
    });
    const reading = await readGeoOffsiteSerp(input, { serpOrganic, onCost: () => undefined });
    expect(reading.availability).toBe("partial");
    expect(reading.queries.map((query) => query.status)).toEqual(["ok", "unavailable", "ok"]);
    expect(reading.queries[1]).toMatchObject({ reason: "fetch_failed", resultsObserved: 0 });
    expect(reading.candidates).toHaveLength(2);
    // The two answered queries are priced; the one that was dispatched and
    // never answered is counted, not folded into the total as zero.
    expect(reading).toMatchObject({ costUsd: 0.004, unpricedQueries: 1 });
  });

  it("reports unavailable, not empty, when every query fails", async () => {
    const { serpOrganic } = reader({});
    const reading = await readGeoOffsiteSerp(input, { serpOrganic, onCost: () => undefined });
    // `costUsd: 0` here is the truth about what the provider reported, not a
    // claim that the run was free: three tasks were dispatched and the provider
    // bills a live task it dispatched.
    expect(reading).toMatchObject({ availability: "unavailable", reason: "fetch_failed", candidates: [], costUsd: 0, unpricedQueries: 3 });
    expect(reading.queries.every((query) => query.status === "unavailable")).toBe(true);
  });

  it("reports a dispatched query whose answer never arrived to the cost log, as an unknown price", async () => {
    const onCost = vi.fn();
    const { serpOrganic } = reader({
      [QUERIES[0]!]: [row(1, "https://en.wikipedia.org/wiki/Acme_Analytics")],
      [QUERIES[1]!]: "throw",
      [QUERIES[2]!]: [],
    });
    await readGeoOffsiteSerp(input, { serpOrganic, onCost });
    expect(onCost.mock.calls.map((call) => call[0])).toEqual([0.002, null, 0.002]);
    expect(onCost).toHaveBeenCalledWith(null, "US", QUERIES[1]);
  });

  it("counts nothing unpriced when nothing was dispatched", async () => {
    // The counter has to mean "dispatched but unobserved". A refusal that
    // never reached the provider owes nothing and must not look like a
    // liability.
    const { calls, serpOrganic } = reader({});
    const dependencies = { serpOrganic, onCost: () => undefined };
    for (const refusal of [{ market: "ZZ" }, { language: "xx" }, { brandName: "AB" }]) {
      expect(await readGeoOffsiteSerp({ ...input, ...refusal }, dependencies))
        .toMatchObject({ availability: "unavailable", costUsd: 0, unpricedQueries: 0 });
    }
    expect(calls).toEqual([]);
  });

  it("spends nothing on an unsupported market, language or unmatchable name", async () => {
    const { calls, serpOrganic } = reader({});
    const dependencies = { serpOrganic, onCost: () => undefined };
    expect(await readGeoOffsiteSerp({ ...input, market: "ZZ" }, dependencies))
      .toMatchObject({ availability: "unavailable", reason: "not_applicable" });
    expect(await readGeoOffsiteSerp({ ...input, language: "xx" }, dependencies))
      .toMatchObject({ availability: "unavailable", reason: "unsupported_language" });
    expect(await readGeoOffsiteSerp({ ...input, brandName: "AB" }, dependencies))
      .toMatchObject({ availability: "unavailable", reason: "insufficient_evidence" });
    expect(calls).toEqual([]);
  });

  it("drops a result the source contract could never carry", async () => {
    const { serpOrganic } = reader({
      [QUERIES[0]!]: [
        { rankGroup: 1, domain: "example.com", title: "No URL", url: null },
        { rankGroup: 2, domain: "localhost", title: "Private", url: "http://localhost/admin" },
        row(3, "https://en.wikipedia.org/wiki/Acme_Analytics"),
      ],
      [QUERIES[1]!]: [],
      [QUERIES[2]!]: [],
    });
    const reading = await readGeoOffsiteSerp(input, { serpOrganic, onCost: () => undefined });
    expect(reading.candidates.map((candidate) => candidate.host)).toEqual(["en.wikipedia.org"]);
  });
});
