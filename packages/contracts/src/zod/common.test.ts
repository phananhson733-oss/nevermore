import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BCP47_PORTABLE_SCHEMA_PATTERN,
  Bcp47Locale,
  isBcp47LanguageTag,
  MAX_BCP47_LOCALE_LENGTH,
} from "./common.ts";

describe("RFC 5646 BCP-47 language tags", () => {
  it.each([
    "en",
    "zh-CN",
    "zh-Hant-TW",
    "es-419",
    "de-CH-1901",
    "sl-rozaj-biske-1994",
    "zh-cmn-Hans-CN",
    "en-US-u-hc-h12",
    "en-a-myext-b-another",
    "en-US-x-twain",
    "x-private",
    "x-company-locale-42",
    "i-klingon",
    "en-GB-oed",
    "sgn-BE-FR",
  ])("accepts structurally valid tag %s", (tag) => {
    expect(isBcp47LanguageTag(tag)).toBe(true);
    expect(Bcp47Locale.safeParse(tag).success).toBe(true);
  });

  it.each([
    "e",
    "1n",
    "en_US",
    "en-",
    "en--US",
    "en-US-Latn",
    "en-12345-US",
    "en-u",
    "en-u-a",
    "en-x",
    "x",
    "x-123456789",
    "de-1901-1901",
    "en-a-first-a-second",
  ])("rejects malformed or duplicate tag %s", (tag) => {
    expect(isBcp47LanguageTag(tag)).toBe(false);
    expect(Bcp47Locale.safeParse(tag).success).toBe(false);
  });

  it("accepts the documented ceiling and rejects a longer private-use tag", () => {
    const subtags = Array.from({ length: 27 }, () => "abcdefgh");
    const atMostCeiling = `en-x-${subtags.join("-")}`;
    const overCeiling = `${atMostCeiling}-abcdefgh`;

    expect(atMostCeiling.length).toBeLessThanOrEqual(
      MAX_BCP47_LOCALE_LENGTH,
    );
    expect(overCeiling.length).toBeGreaterThan(MAX_BCP47_LOCALE_LENGTH);
    expect(Bcp47Locale.safeParse(atMostCeiling).success).toBe(true);
    expect(Bcp47Locale.safeParse(overCeiling).success).toBe(false);
  });

  it("keeps portable OpenAPI/JSON Schema validation structurally aligned", () => {
    const portable = new RegExp(BCP47_PORTABLE_SCHEMA_PATTERN);
    for (const tag of [
      "en",
      "zh-cmn-Hans-CN",
      "en-US-u-hc-h12",
      "x-company-locale-42",
      "I-KLINGON",
      "EN-gb-OED",
      "SGN-be-NL",
    ]) {
      expect(portable.test(tag), tag).toBe(true);
    }
    for (const tag of [
      "e",
      "1n-US",
      "en-US-Latn",
      "en-u",
      "de-1901-1901",
      "en-a-first-a-second",
    ]) {
      expect(portable.test(tag), tag).toBe(false);
    }
  });

  it("documents the only portable-schema refinement left to runtime", () => {
    const portable = new RegExp(BCP47_PORTABLE_SCHEMA_PATTERN);
    for (const tag of ["sl-rozaj-ROZAJ", "en-a-first-A-second"]) {
      // ECMA-262 patterns have no portable case-insensitive backreference.
      expect(portable.test(tag), tag).toBe(true);
      expect(isBcp47LanguageTag(tag), tag).toBe(false);
    }
  });

  it("publishes the same portable pattern in OpenAPI and the bundle schema", () => {
    const manifestSchema = JSON.parse(
      readFileSync(
        new URL(
          "../../../../schemas/service-bundle-manifest.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { $defs: { locale: { pattern: string } } };
    const openapi = readFileSync(
      new URL("../../../../openapi/mvp.yaml", import.meta.url),
      "utf8",
    );

    expect(manifestSchema.$defs.locale.pattern).toBe(
      BCP47_PORTABLE_SCHEMA_PATTERN,
    );
    expect(openapi).toContain(
      `pattern: '${BCP47_PORTABLE_SCHEMA_PATTERN}'`,
    );
    expect(openapi).toContain(
      "x-signalframe-runtime-refinement: isBcp47LanguageTag",
    );
  });
});
