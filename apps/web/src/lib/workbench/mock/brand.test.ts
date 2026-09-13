import { describe, expect, it } from "vitest";
import { BRAND_PLACEHOLDER, brandOrPlaceholder } from "./brand.ts";
import * as profile from "./profile.ts";

describe("brandOrPlaceholder", () => {
  it("returns a typed brand", () => {
    expect(brandOrPlaceholder("Acme")).toBe("Acme");
  });

  it("returns the bracket placeholder for a blank brand", () => {
    expect(BRAND_PLACEHOLDER).toBe("[品牌]");
    expect(brandOrPlaceholder("")).toBe("[品牌]");
    expect(brandOrPlaceholder(" \t\n")).toBe("[品牌]");
  });

  it("is the same binding profile.ts re-exports, so its importers are unchanged", () => {
    expect(profile.brandOrPlaceholder).toBe(brandOrPlaceholder);
    expect(profile.BRAND_PLACEHOLDER).toBe(BRAND_PLACEHOLDER);
  });
});
