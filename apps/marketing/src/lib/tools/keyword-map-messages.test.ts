// @input  -- every union the keyword map can emit, and both message bundles
// @output -- a failing test when any member has no copy in either locale
// @pos    -- the guard between "type-checks" and "throws in front of a visitor"
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import {
  KEYWORD_OPPORTUNITY_AVAILABILITY_STATES,
  KEYWORD_OPPORTUNITY_COVERAGE_STATES,
  KEYWORD_OPPORTUNITY_ERROR_CODES,
  KEYWORD_OPPORTUNITY_INCOMPLETE_REASONS,
  KEYWORD_OPPORTUNITY_WITHHELD_REASONS,
  KEYWORD_STAGE_GSC_COVERAGE_TRUNCATED,
  KEYWORD_STAGE_SERP_INTERPRETATION,
  KEYWORD_STAGE_SERP_SAMPLE_PARTIAL,
} from "@sf/public-tools/keyword-opportunity/types";
import type {
  KeywordOpportunityAiOverviewAssessment,
  KeywordOpportunityAiOverviewAvailability,
  KeywordOpportunityCommunitySource,
  KeywordOpportunityDecisionDiscount,
  KeywordOpportunityProviderIntent,
  KeywordOpportunitySerpIntent,
  KeywordOpportunitySignal,
  KeywordOpportunitySignalState,
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

type CopyEnums = {
  readonly intents: KeywordOpportunityProviderIntent | KeywordOpportunitySerpIntent;
  readonly signalNames: KeywordOpportunitySignal;
  readonly signalStates: KeywordOpportunitySignalState;
  readonly communitySources: KeywordOpportunityCommunitySource;
  readonly aioAvailability: KeywordOpportunityAiOverviewAvailability;
  readonly aioAssessments: KeywordOpportunityAiOverviewAssessment;
  readonly discounts: KeywordOpportunityDecisionDiscount;
};

const COPY_ENUMS = {
  intents: [
    "informational",
    "navigational",
    "commercial",
    "transactional",
    "mixed",
  ],
  signalNames: [
    "young_domain",
    "low_organic_traffic_domain",
    "community_result",
  ],
  signalStates: ["observed", "not_observed", "unavailable"],
  communitySources: ["provider_item_type", "domain_fallback"],
  aioAvailability: ["observed", "not_observed", "unavailable"],
  aioAssessments: ["complete", "partial", "not_answered", "unavailable"],
  discounts: ["ai_overview_answer_discount"],
} as const satisfies {
  readonly [Group in keyof CopyEnums]: readonly CopyEnums[Group][];
};

type AssertComplete<Union extends string, Values extends readonly string[]> =
  Exclude<Union, Values[number]> extends never
    ? true
    : Exclude<Union, Values[number]>;

const COPY_ENUMS_ARE_COMPLETE: {
  readonly [Group in keyof CopyEnums]: AssertComplete<
    CopyEnums[Group],
    (typeof COPY_ENUMS)[Group]
  >;
} = {
  intents: true,
  signalNames: true,
  signalStates: true,
  communitySources: true,
  aioAvailability: true,
  aioAssessments: true,
  discounts: true,
};
void COPY_ENUMS_ARE_COMPLETE;

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
  it("does not infer billing or refund state from the generic unknown error", () => {
    const unknownEn = group("en", "errors")["unknown"];
    const unknownZh = group("zh", "errors")["unknown"];
    const readingEn = namespace("en")["readingBody"];
    const readingZh = namespace("zh")["readingBody"];

    expect(unknownEn).toBe(
      "Something went wrong on our side. This run did not produce a usable report. Try again.",
    );
    expect(unknownZh).toBe(
      "我们这边出了问题，本次没有产出可用报告。请重试。",
    );
    expect(String(unknownEn).toLowerCase()).not.toMatch(/charg|bill|refund/u);
    expect(String(unknownZh)).not.toMatch(/计费|扣费|退款/u);
    expect(readingEn).toBe(
      "Fetching a bounded context of up to 20 pages and reading the positioning from them. This is not a whole-site crawl and does not call the search-data provider.",
    );
    expect(readingZh).toBe(
      "抓取最多 20 个页面的有限上下文并从中读出定位；这不是全站完整抓取，也不会调用搜索数据源。",
    );
  });

  it.each(["en", "zh"] as const)(
    "renders every v2 evidence enum in %s",
    (locale) => {
      for (const [groupName, values] of Object.entries(COPY_ENUMS)) {
        const copy = group(locale, groupName);
        for (const value of values) {
          expect(copy[value], `${groupName}.${value}`).toBeTypeOf("string");
        }
      }
    },
  );

  it.each(["en", "zh"] as const)(
    "renders every coverage state in %s",
    (locale) => {
      // The state the reader sees on every single row. A missing one renders
      // as its own dotted key path mid-table — next-intl resolves an unknown
      // key to its name rather than throwing — and only for the visitors
      // whose own data produced it.
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

  it.each(["en", "zh"] as const)(
    "renders every incomplete reason in %s",
    (locale) => {
      const copy = group(locale, "incomplete");
      for (const reason of KEYWORD_OPPORTUNITY_INCOMPLETE_REASONS) {
        expect(copy[reason], `incomplete.${reason}`).toBeTypeOf("string");
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
    "names a truncated GSC coverage read in %s",
    (locale) => {
      expect(group(locale, "stages")[KEYWORD_STAGE_GSC_COVERAGE_TRUNCATED])
        .toBeTypeOf("string");
    },
  );

  it.each(["en", "zh"] as const)(
    "names a partially completed SERP plan in %s",
    (locale) => {
      expect(group(locale, "stages")[KEYWORD_STAGE_SERP_SAMPLE_PARTIAL])
        .toBeTypeOf("string");
    },
  );

  it.each(["en", "zh"] as const)(
    "names unavailable SERP interpretation in %s",
    (locale) => {
      expect(group(locale, "stages")[KEYWORD_STAGE_SERP_INTERPRETATION])
        .toBeTypeOf("string");
    },
  );

  it("states temporary Workflow persistence without claiming project history", () => {
    expect(String(namespace("en")["persistenceBoundary"])).toContain(
      "expires after 24 hours",
    );
    expect(String(namespace("en")["persistenceBoundary"])).toContain(
      "Vercel's plan-level retention",
    );
    expect(String(namespace("zh")["persistenceBoundary"])).toContain(
      "24 小时后失效",
    );
    expect(String(namespace("en")["connectBody"])).not.toContain(
      "nothing is stored",
    );
    expect(String(namespace("zh")["connectBody"])).not.toContain(
      "不在服务器上留存任何数据",
    );
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
    // Plus the fallback the surface uses for a code it does not recognise.
    // Without it the visitor reads "tools.keywordMap.errors.something" where a
    // sentence belongs, which is quieter than a crash and no more use.
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
    // A key in one bundle and not the other puts a raw dotted key path in
    // front of exactly the visitors on that locale, and nothing else in the
    // suite can see it.
    expect(keyPaths(namespace("zh")).sort()).toEqual(
      keyPaths(namespace("en")).sort(),
    );
  });
});
