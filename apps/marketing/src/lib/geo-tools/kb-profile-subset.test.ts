import { describe, expect, it } from "vitest";
import { emptyMarketingWebsiteProfile, WEBSITE_PROFILE_FIELD_NAMES, type MarketingWebsiteProfileV1 } from "../account-websites/contracts.ts";
import { GEO_PROFILE_SUBSET_FIELDS, geoProfileSubset, geoProfileSubsetHash, geoProfileSubsetMatches } from "./kb-profile-subset.ts";

function profile(overrides: Partial<MarketingWebsiteProfileV1> = {}): MarketingWebsiteProfileV1 {
  return { ...emptyMarketingWebsiteProfile(), productName: "AstrologyWiki", country: "US", locale: "en", ...overrides };
}

describe("the Profile fields GEO reads", () => {
  it("keeps every field a consumer reads and drops the rest", () => {
    // The list is the contract; this states it so a silent addition or removal
    // has to be a deliberate edit here rather than a quiet change of meaning.
    expect([...GEO_PROFILE_SUBSET_FIELDS]).toEqual([
      "productName", "oneLinePositioning", "coreFeatures", "country", "locale",
      "categories", "buyer", "primaryIcp", "triggerPain", "icpPain",
      "qualificationSignals", "icpInterests", "directCompetitors",
    ]);
    // And every one of them is a real Profile field, not a typo that would
    // project to undefined and be carried as such.
    for (const field of GEO_PROFILE_SUBSET_FIELDS) {
      expect(WEBSITE_PROFILE_FIELD_NAMES).toContain(field);
    }
  });

  it("carries the values, not the whole Profile", () => {
    const subset = geoProfileSubset(profile({ productName: "AstrologyWiki", businessModel: "freemium", primaryCta: "Start", jtbd: "understand my chart" }));

    expect(subset.productName).toBe("AstrologyWiki");
    // Fields nothing reads are absent rather than empty: an absent field
    // cannot be rendered, hashed or size-capped by mistake.
    expect(Object.keys(subset)).not.toContain("businessModel");
    expect(Object.keys(subset)).not.toContain("primaryCta");
    expect(Object.keys(subset)).not.toContain("jtbd");
    expect(Object.keys(subset).length).toBe(GEO_PROFILE_SUBSET_FIELDS.length + 1);
  });

  it("keeps only the provenance a frozen version reports", () => {
    const source = profile({ fieldProvenance: [
      { path: "/productName", source: "public_page", derivation: "observed", confidence: "high", observedAt: null, limitation: null, evidenceUrls: [] },
      { path: "/jtbd", source: "local_inference", derivation: "inferred", confidence: "low", observedAt: null, limitation: null, evidenceUrls: [] },
    ] });

    const subset = geoProfileSubset(source);

    expect(subset.fieldProvenance.map(entry => entry.path)).toEqual(["/productName"]);
  });

  it("changes its digest when a carried value changes", () => {
    const source = profile({ coreFeatures: ["birth chart"] });
    const before = geoProfileSubsetHash(geoProfileSubset(source));

    expect(geoProfileSubsetHash(geoProfileSubset({ ...source, coreFeatures: ["something else"] }))).not.toBe(before);
    // A field the subset does not carry cannot move its digest.
    expect(geoProfileSubsetHash(geoProfileSubset({ ...source, businessModel: "changed" }))).toBe(before);
  });

  it("stops matching when a field it carries changes, and keeps matching when one it drops does", () => {
    const source = profile({ coreFeatures: ["birth chart"] });
    const subset = geoProfileSubset(source);

    expect(geoProfileSubsetMatches(subset, source)).toBe(true);
    // A field outside the subset changing is not a reason to call the copy stale.
    expect(geoProfileSubsetMatches(subset, { ...source, businessModel: "changed" })).toBe(true);
    // One inside it is.
    expect(geoProfileSubsetMatches(subset, { ...source, coreFeatures: ["something else"] })).toBe(false);
  });
});
