import { describe, expect, it } from "vitest";
import { pendingGeoFeatureFact, pendingGeoProfileFact } from "./geo-kb-feature-candidates.ts";

describe("inherited Profile value to pending fact", () => {
  it("prefills the exact general Profile value but requires a source before save", () => {
    expect(pendingGeoProfileFact("productName", "Acme Analytics", [])).toEqual({
      status: "ready", fact: { key: "productName", value: "Acme Analytics", reason: "", sourceUrl: "", observedAt: "" },
    });
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
    expect(pendingGeoFeatureFact("FEATURE 0", facts)).toEqual({ status: "exists" });
  });
  it("normalizes only NFC, case and whitespace when deduplicating by key", () => {
    const existing = [{ key: "Caf\u00e9   plan", value: "Same value", reason: "" as const, sourceUrl: "https://example.com", observedAt: "2026-08-31" }];
    expect(pendingGeoProfileFact("CAFE\u0301 plan", "New exact value", existing)).toEqual({ status: "exists" });
    expect(pendingGeoProfileFact("Cafe-plan", "Same value", existing)).toEqual({
      status: "ready", fact: { key: "Cafe-plan", value: "Same value", reason: "", sourceUrl: "", observedAt: "" },
    });
  });
});
