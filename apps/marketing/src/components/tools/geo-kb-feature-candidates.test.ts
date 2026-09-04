import { describe, expect, it } from "vitest";
import { geoProfileFactSource, pendingGeoFeatureFact, pendingGeoProfileFact } from "./geo-kb-feature-candidates.ts";
import { emptyMarketingWebsiteProfile } from "../../lib/account-websites/contracts.ts";

describe("inherited Profile value to pending fact", () => {
  it("keys the fact by the claim, not by the Profile field it came from", () => {
    // `inspectGeoFact` admits a fact only where one page segment carries the
    // key and the value together, and "productName" is on no page. Keying by
    // the field made the fact unverifiable by construction, and printed a
    // field name where the visitor reads a dimension.
    expect(pendingGeoProfileFact("productName", "Acme Analytics", [])).toEqual({
      status: "ready", fact: { key: "Acme Analytics", value: "Acme Analytics", reason: "", sourceUrl: "", observedAt: "" },
    });
    expect(pendingGeoProfileFact("coreFeatures[0]", "Free natal chart calculator", [])).toMatchObject({ fact: { key: "Free natal chart calculator" } });
  });
  it("delegates an exact feature into both the fact key and value without inventing a source", () => {
    expect(pendingGeoFeatureFact("Free natal chart calculator", [])).toEqual({
      status: "ready", fact: { key: "Free natal chart calculator", value: "Free natal chart calculator", reason: "", sourceUrl: "", observedAt: "" },
    });
  });
  it("never overwrites an existing fact or truncates an overlong Profile value", () => {
    const existing = { key: "Chart tool", value: "Existing verified declaration", reason: "" as const, sourceUrl: "https://example.com/tool", observedAt: "2026-08-31" };
    expect(pendingGeoFeatureFact("Chart tool", [existing])).toEqual({ status: "exists" });
    expect(existing.value).toBe("Existing verified declaration");
    expect(pendingGeoFeatureFact("x".repeat(201), [])).toEqual({ status: "too_long" });
    expect(pendingGeoProfileFact("coreFeatures[0]", "x".repeat(201), [])).toEqual({ status: "too_long" });
  });
  it("honors the 24-fact cap and detects normalized key duplicates", () => {
    const facts = Array.from({ length: 24 }, (_, index) => ({ key: `Feature ${index}`, value: "", reason: "lowConfidence" as const, sourceUrl: "", observedAt: "" }));
    expect(pendingGeoFeatureFact("New feature", facts)).toEqual({ status: "full" });
    expect(pendingGeoFeatureFact("FEATURE 0", facts.map(fact => ({ ...fact, value: fact.key })))).toEqual({ status: "exists" });
  });
  it("refuses a claim that matches either half of a row already in the review area", () => {
    // A row with a dimension of its own: "Pricing" is what a page would have to
    // say beside the claim, "Free plan" is the claim.
    const facts = [{ key: "Pricing", value: "Free plan", reason: "" as const, sourceUrl: "https://example.com/pricing", observedAt: "2026-08-31T00:00:00.000Z" }];
    // Comparing against keys alone let this one through, filing the same claim
    // a second time.
    expect(pendingGeoProfileFact("coreFeatures[0]", "Free plan", facts)).toEqual({ status: "exists" });
    // And this one has to be refused for a different reason: the payload keys
    // facts uniquely, so a claim equal to an existing dimension would collide.
    expect(pendingGeoProfileFact("productName", "Pricing", facts)).toEqual({ status: "exists" });
    expect(pendingGeoProfileFact("productName", "Paid plans only", facts)).toMatchObject({ status: "ready" });
  });
  it("normalizes only NFC, case and whitespace when deduplicating by claim", () => {
    const existing = [{ key: "Caf\u00e9   plan", value: "Caf\u00e9   plan", reason: "" as const, sourceUrl: "https://example.com", observedAt: "2026-08-31" }];
    // The same claim twice is the same fact, whichever field offers it, and
    // whichever of the two spellings of an accent it arrives in.
    expect(pendingGeoProfileFact("productName", "CAFE\u0301 plan", existing)).toEqual({ status: "exists" });
    expect(pendingGeoProfileFact("coreFeatures[0]", "CAFE\u0301 plan", existing)).toEqual({ status: "exists" });
    // A hyphen is a different claim, not a different spelling of this one.
    expect(pendingGeoProfileFact("productName", "Cafe-plan", existing)).toEqual({
      status: "ready", fact: { key: "Cafe-plan", value: "Cafe-plan", reason: "", sourceUrl: "", observedAt: "" },
    });
  });
});

describe("carrying the archived source of an inherited value", () => {
  const base = emptyMarketingWebsiteProfile();
  const profile = { ...base, coreFeatures: ["Free birth chart calculator"], fieldProvenance: [
    { path: "/coreFeatures" as const, derivation: "observed" as const, confidence: "high" as const, source: "public_page" as const,
      observedAt: "2026-08-31T05:34:14.891Z", evidenceUrls: ["https://www.astrologywiki.com/en/tools"], limitation: null },
    { path: "/productName" as const, derivation: "declared" as const, confidence: "high" as const, source: "user_edit" as const,
      observedAt: null, evidenceUrls: [], limitation: null },
    { path: "/oneLinePositioning" as const, derivation: "observed" as const, confidence: "high" as const, source: "public_page" as const,
      observedAt: "not a timestamp", evidenceUrls: ["https://www.astrologywiki.com/"], limitation: null },
    { path: "/valueProposition" as const, derivation: "inferred" as const, confidence: "high" as const, source: "public_page" as const,
      observedAt: "2026-08-31T05:34:14.891Z", evidenceUrls: ["https://www.astrologywiki.com/en/"], limitation: null },
    { path: "/businessModel" as const, derivation: "observed" as const, confidence: "high" as const, source: "public_page" as const,
      observedAt: "2026-08-31T05:34:14.891Z", evidenceUrls: ["https://www.astrologywiki.com/en/pricing", "https://www.astrologywiki.com/en/"], limitation: null },
    { path: "/primaryCta" as const, derivation: "observed" as const, confidence: "high" as const, source: "public_page" as const,
      observedAt: "2026-08-31T05:34:14.891Z", evidenceUrls: ["javascript:alert(1)"], limitation: null },
  ] };
  it("reads the page and time recorded for an indexed list entry", () => {
    expect(geoProfileFactSource(profile, "coreFeatures[0]")).toEqual({ sourceUrl: "https://www.astrologywiki.com/en/tools", observedAt: "2026-08-31T05:34:14.891Z" });
  });
  it("refuses a field with no fetched page behind it", () => {
    expect(geoProfileFactSource(profile, "productName")).toBeNull();
  });
  it("refuses a time the fact schema would reject", () => {
    expect(geoProfileFactSource(profile, "oneLinePositioning")).toBeNull();
  });
  it("refuses a value the archive recorded as an inference rather than an observation", () => {
    expect(geoProfileFactSource(profile, "valueProposition")).toBeNull();
  });
  it("refuses to pick one page out of several recorded for the same field", () => {
    expect(geoProfileFactSource(profile, "businessModel")).toBeNull();
  });
  it("refuses an evidence address that is not a public page", () => {
    expect(geoProfileFactSource(profile, "primaryCta")).toBeNull();
  });
  it("prefills a candidate with that source and still leaves it pending", () => {
    const candidate = pendingGeoProfileFact("coreFeatures[0]", "Free birth chart calculator", [], geoProfileFactSource(profile, "coreFeatures[0]"));
    expect(candidate).toMatchObject({ status: "ready", fact: { sourceUrl: "https://www.astrologywiki.com/en/tools", observedAt: "2026-08-31T05:34:14.891Z", reason: "" } });
  });
});
