import { describe, expect, it } from "vitest";
import { pendingGeoFeatureFact } from "./geo-kb-feature-candidates.ts";

describe("inherited core feature to pending fact", () => {
  it("keeps the exact feature identity but supplies no inferred value or source", () => {
    expect(pendingGeoFeatureFact("Free natal chart calculator", [])).toEqual({
      status: "ready", fact: { key: "Free natal chart calculator", value: "", reason: "lowConfidence", sourceUrl: "", observedAt: "" },
    });
  });
  it("never overwrites an existing fact or truncates an overlong feature", () => {
    const existing = { key: "Chart tool", value: "Existing verified declaration", reason: "" as const, sourceUrl: "https://example.com/tool", observedAt: "2026-08-31" };
    expect(pendingGeoFeatureFact("Chart tool", [existing])).toEqual({ status: "exists" });
    expect(existing.value).toBe("Existing verified declaration");
    expect(pendingGeoFeatureFact("x".repeat(201), [])).toEqual({ status: "too_long" });
  });
  it("honors the 24-fact cap and detects normalized duplicates", () => {
    const facts = Array.from({ length: 24 }, (_, index) => ({ key: `Feature ${index}`, value: "", reason: "lowConfidence" as const, sourceUrl: "", observedAt: "" }));
    expect(pendingGeoFeatureFact("New feature", facts)).toEqual({ status: "full" });
    expect(pendingGeoFeatureFact("FEATURE 0", facts)).toEqual({ status: "exists" });
  });
});
