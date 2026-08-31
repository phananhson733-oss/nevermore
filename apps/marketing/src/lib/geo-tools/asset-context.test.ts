import { describe, expect, it } from "vitest";
import { isSupportedGeoQuestionLanguage } from "./asset-context.ts";

describe("GEO question language support", () => {
  it.each(["en", "en-US", "en-GB", "EN"]) ("supports the English registry for %s", (language) => {
    expect(isSupportedGeoQuestionLanguage(language)).toBe(true);
  });
  it.each(["", "zh", "ja", "th", "en_US", "English", " en "]) ("does not silently replace %s with English", (language) => {
    expect(isSupportedGeoQuestionLanguage(language)).toBe(false);
  });
});
