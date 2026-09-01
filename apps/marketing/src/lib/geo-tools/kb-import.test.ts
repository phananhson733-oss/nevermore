import { describe, expect, it } from "vitest";
import { emptyMarketingWebsiteProfile } from "../account-websites/contracts.ts";
import { normalizeAliasForMatch } from "../agents/geo-alias-match.ts";
import { importGeoKbPayload } from "./kb-import.ts";

function imported(productName: string, origin: string) {
  return importGeoKbPayload({ websiteId: "11111111-1111-4111-8111-111111111111",
    snapshotId: "22222222-2222-4222-8222-222222222222", snapshotRevision: 1, origin,
    profile: { ...emptyMarketingWebsiteProfile(), productName, country: "US", locale: "en-US", categories: ["birth chart calculator"] } });
}

const oversizedCompetitorSource = {
  websiteId: "11111111-1111-4111-8111-111111111111",
  snapshotId: "11111111-1111-4111-8111-111111111112",
  snapshotRevision: 1,
  origin: "https://example.com",
  profile: {
    ...emptyMarketingWebsiteProfile(),
    productName: "Acme",
    directCompetitors: ["one.com", "two.com", "three.com", "four.com", "five.com", "six.com"],
  },
};

describe("bounded measurement prefill", () => {
  it("leaves an oversized source competitor set unselected instead of silently taking the first five", () => {
    const result = importGeoKbPayload(oversizedCompetitorSource);
    expect(result.competitors).toEqual([]);
    expect(oversizedCompetitorSource.profile.directCompetitors).toHaveLength(6);
  });

  it("keeps a within-limit source prefill unconfirmed", () => {
    const result = importGeoKbPayload({
      ...oversizedCompetitorSource,
      profile: { ...oversizedCompetitorSource.profile, directCompetitors: ["one.com", "Two Brand"] },
    });
    expect(result.competitors).toEqual([
      { domain: "one.com", brandName: "", confirmed: false },
      { domain: "", brandName: "Two Brand", confirmed: false },
    ]);
  });
});

describe("knowledge-base alias proposals", () => {
  it("proposes the split brand and canonical hostname without duplicating casing-only variants", () => {
    const result = imported("AstrologyWiki", "https://www.astrologywiki.com");
    expect(result.aliases).toEqual(["AstrologyWiki", "Astrology Wiki", "astrologywiki.com"]);
    expect(new Set(result.aliases.map(normalizeAliasForMatch)).size).toBe(result.aliases.length);
  });
  it("preserves acronym words when proposing a split name", () => {
    expect(imported("APIClient", "https://apiclient.example").aliases).toContain("API Client");
  });
  it("does not invent a single-letter word split for iPhone", () => {
    expect(imported("iPhone", "https://iphone.example").aliases).not.toContain("i Phone");
  });
  it("keeps a matchable two-character CJK brand", () => {
    const result = imported("小米", "https://xiaomi.example");
    expect(result.aliases).toContain("小米");
    expect(result.aliases).toContain("xiaomi.example");
  });
  it("does not truncate long brand text into a different alias", () => {
    const name = "LengthyBrand".repeat(10);
    const result = imported(name, "https://longbrand.example");
    expect(result.aliases).not.toContain(name.slice(0, 80));
    expect(result.aliases).toContain("longbrand.example");
    expect(result.officialName).toBe(name);
  });
  it("retains the existing generic-host-label exclusion", () => {
    const result = imported("Acme", "https://app.example.com");
    expect(result.aliases).not.toContain("app");
    expect(result.aliases).toContain("app.example.com");
  });
});
