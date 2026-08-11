// @input  -- every union the keyword map can emit, and both message bundles
// @output -- a failing test when any member has no copy in either locale
// @pos    -- the guard between "type-checks" and "throws in front of a visitor"
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import {
  KEYWORD_OPPORTUNITY_AVAILABILITY_STATES,
  KEYWORD_OPPORTUNITY_COVERAGE_STATES,
  KEYWORD_OPPORTUNITY_ERROR_CODES,
  KEYWORD_OPPORTUNITY_WITHHELD_REASONS,
} from "@sf/public-tools/keyword-opportunity/types";
import { KEYWORD_OPPORTUNITY_CHECKS } from "@sf/public-tools/keyword-opportunity/next-checks";
import { KEYWORD_MARKET_LOCATIONS } from "./keyword-providers.ts";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";

/**
 * Driven off the exported value lists rather than a hand-written copy of them.
 *
 * The lists are proved complete against their unions at compile time, so
 * adding a union member grows this test's coverage automatically — which is
 * the whole reason those lists exist. A second hand-maintained list here would
 * reintroduce exactly the drift they were added to prevent.
 */
const BUNDLES = { en, zh } as const;

function namespace(locale: keyof typeof BUNDLES): Record<string, unknown> {
  const tools = BUNDLES[locale].tools as Record<string, unknown>;
  const map = tools["keywordMap"];
  expect(map, `tools.keywordMap missing from ${locale}.json`).toBeTypeOf(
    "object",
  );
  return map as Record<string, unknown>;
}

function group(
  locale: keyof typeof BUNDLES,
  key: string,
): Record<string, unknown> {
  const value = namespace(locale)[key];
  expect(value, `tools.keywordMap.${key} missing from ${locale}.json`).toBeTypeOf(
    "object",
  );
  return value as Record<string, unknown>;
}

/** Every key path the two files must agree on, so neither locale drifts. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => keyPaths(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

describe("keyword map copy", () => {
  it.each(["en", "zh"] as const)(
    "renders every coverage state in %s",
    (locale) => {
      // The state the reader sees on every single row. A missing one throws
      // MISSING_MESSAGE mid-table, and only for the visitors whose own data
      // produced it.
      const copy = group(locale, "coverage");
      for (const state of KEYWORD_OPPORTUNITY_COVERAGE_STATES) {
        expect(copy[state], `coverage.${state}`).toBeTypeOf("string");
      }
    },
  );

  it.each(["en", "zh"] as const)(
    "renders every withheld reason in %s",
    (locale) => {
      const copy = group(locale, "withheld");
      for (const reason of KEYWORD_OPPORTUNITY_WITHHELD_REASONS) {
        expect(copy[reason], `withheld.${reason}`).toBeTypeOf("string");
      }
    },
  );

  it.each(["en", "zh"] as const)("renders every check in %s", (locale) => {
    // The advice layer. Every row carries at least one, so a hole here is a
    // hole on a row the tool is asking someone to act on.
    const copy = group(locale, "checks");
    for (const check of KEYWORD_OPPORTUNITY_CHECKS) {
      expect(copy[check], `checks.${check}`).toBeTypeOf("string");
    }
  });

  it.each(["en", "zh"] as const)(
    "renders every availability state in %s",
    (locale) => {
      const copy = group(locale, "availability");
      for (const state of KEYWORD_OPPORTUNITY_AVAILABILITY_STATES) {
        expect(copy[state], `availability.${state}`).toBeTypeOf("string");
      }
    },
  );

  it.each(["en", "zh"] as const)("renders every error code in %s", (locale) => {
    // Plus the fallback the surface uses for a code it does not recognise —
    // without it, an unplanned code renders as a crash instead of a sentence.
    const copy = group(locale, "errors");
    for (const code of [...KEYWORD_OPPORTUNITY_ERROR_CODES, "unknown"]) {
      expect(copy[code], `errors.${code}`).toBeTypeOf("string");
    }
  });

  it.each(["en", "zh"] as const)(
    "names every market the API will accept in %s",
    (locale) => {
      // The select is built from this allow-list at request time, so a market
      // without a label renders an empty option the visitor cannot identify.
      const copy = group(locale, "markets");
      for (const market of Object.keys(KEYWORD_MARKET_LOCATIONS)) {
        expect(copy[market], `markets.${market}`).toBeTypeOf("string");
      }
    },
  );

  it("carries the same keys in both locales", () => {
    // A key in one bundle and not the other is a MISSING_MESSAGE for exactly
    // the visitors on that locale, and nothing else in the suite can see it.
    expect(keyPaths(namespace("zh")).sort()).toEqual(
      keyPaths(namespace("en")).sort(),
    );
  });
});
