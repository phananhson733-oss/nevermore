// @input  -- estimated traffic for the domains on one sampled results page
// @output -- proof 9.3 decides, and never turns a provider gap into an opening
// @pos    -- coverage for the last check the paid seam unlocked

import { describe, expect, it } from "vitest";

import {
  buildSerpShapeRecords,
  LOW_TRAFFIC_ETV_CEILING,
  type SerpShapeRaw,
} from "../seo-audit/serp-shape.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

const TARGET = "https://acme.test/page";

function sample(
  domainTraffic: SerpShapeRaw["domainTraffic"],
): SerpShapeRaw {
  return {
    keyword: "natal chart",
    itemTypes: ["organic"],
    unresolvedItemCount: 0,
    organicCount: 10,
    domainTraffic,
    marketCode: "US",
    languageCode: "en",
  };
}

function check(domainTraffic: SerpShapeRaw["domainTraffic"]) {
  return evaluateAgentAuditScope("page", {
    availability: "available",
    records: buildSerpShapeRecords(sample(domainTraffic)),
    targetUrl: TARGET,
    targetInspected: true,
    inspectedTargetUrl: TARGET,
  }).checks.find((entry) => entry.check.id === "9.3");
}

const big = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    domain: `big${i}.test`,
    organicEtv: 500_000,
  }));

describe("9.3 — is anyone on page one small enough to displace", () => {
  it("passes when at least one page-one site is small", () => {
    expect(
      check([
        ...big(9),
        { domain: "small.test", organicEtv: LOW_TRAFFIC_ETV_CEILING - 1 },
      ])?.result,
    ).toBe("pass");
  });

  it("reports it when every page-one site is large", () => {
    // A Tip, not a Warning: a hard query is not something the site did wrong.
    expect(check(big(10))?.result).toBe("tip");
  });

  it("does not count a domain the provider said nothing about as small", () => {
    // Null is "we know nothing", and reading it as low traffic manufactures
    // the very opening this check exists to find — turning every provider gap
    // into a false "this query is winnable".
    const record = buildSerpShapeRecords(
      sample([...big(9), { domain: "unknown.test", organicEtv: null }]),
    ).find((entry) => entry.id === "page_one_without_a_low_traffic_site");

    expect(record?.observations).toEqual([]);
  });

  it("refuses the negative verdict when a domain went unsized", () => {
    // "Nobody on page one is small" is a claim about all ten domains. One
    // unresolved domain could be the small competitor, so the claim cannot be
    // made from the subset the provider happened to size.
    expect(
      check([...big(9), { domain: "unknown.test", organicEtv: null }])?.result,
    ).toBe("excluded");
  });

  it("still reports the negative when every domain was sized", () => {
    expect(check(big(10))?.result).toBe("tip");
  });

  it("still finds a small site even when others went unsized", () => {
    // A positive finding is decisive from a subset: seeing one small domain
    // proves one exists. Only the negative needs the full set.
    expect(
      check([
        ...big(8),
        { domain: "unknown.test", organicEtv: null },
        { domain: "small.test", organicEtv: 10 },
      ])?.result,
    ).toBe("pass");
  });

  it("does not judge a market with no traffic-estimate source", () => {
    // Null domainTraffic is an unsized page one, not an unwinnable one.
    expect(check(null)?.result).toBe("excluded");
  });

  it("does not judge when nothing on page one could be sized", () => {
    expect(
      check([
        { domain: "a.test", organicEtv: null },
        { domain: "b.test", organicEtv: null },
      ])?.result,
    ).toBe("excluded");
  });
});
