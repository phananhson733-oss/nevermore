// @input  -- the brief engine constants and both message bundles
// @output -- a failing test when a threshold the page prints stops matching the engine
// @pos    -- handoff §2 rule 3 / §8 item 34: every threshold is interpolated from constants,
//            the copy is formatted with the real numbers here, and no template carries a digit
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { CONTENT_BRIEF_HANDOFF_MAX_BYTES } from "@sf/public-tools/content-brief/contract";
import {
  CRAWL_MIN_FOR_LENGTH,
  DO_NOT_COVER_CAP,
  ENVELOPE_MS,
  FORMAT_PLURALITY_MIN,
  GSC_LOOKBACK_DAYS,
  INTENT_CONFIRMED_MIN_RATIO,
  INTERNAL_LINKS_CAP,
  LLM_DEADLINE_MS,
  MUST_ANSWER_CAP,
  MUST_ANSWER_MIN_PAGES,
  OUTLINE_CAP,
  OUTLINE_MIN_QUESTIONS,
  RUN_BUDGET_MS,
  SELF_COMPETE_MAX_POSITION,
  SELF_COMPETE_MIN_IMPRESSIONS,
  SERP_DEADLINE_MS,
  CRAWL_DEADLINE_MS,
  SERP_DEPTH,
  SUPPORTING_KEYWORDS_MAX,
} from "@sf/public-tools/content-brief/constants";

import { COVERAGE_WINDOW_DAYS } from "./keyword-coverage-reader.ts";
import en from "../../i18n/messages/en.json" with { type: "json" };
import zh from "../../i18n/messages/zh.json" with { type: "json" };

const BUNDLES = { en, zh } as const;
type Locale = keyof typeof BUNDLES;

function copy(locale: Locale): Record<string, unknown> {
  return BUNDLES[locale].tools.contentBrief as unknown as Record<
    string,
    unknown
  >;
}

function translator(locale: Locale) {
  return createTranslator({
    locale,
    messages: { tools: { contentBrief: copy(locale) } },
    namespace: "tools.contentBrief",
  });
}

function leaf(locale: Locale, path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      copy(locale),
    );
  if (typeof value !== "string")
    throw new Error(`${locale}: ${path} is not a string`);
  return value;
}

/**
 * Every message that names a threshold, the parameter it reads it through,
 * and the constant the engine enforces. The formatted sentence must contain
 * the number; the template must contain the parameter and NOT the number --
 * a digit in the template is a threshold that will drift the first time the
 * constant changes (crawl-copy-honesty.test.ts learned this the hard way).
 */
const THRESHOLD_COPY: readonly {
  readonly path: string;
  readonly values: Readonly<Record<string, number | string>>;
  readonly pinned: readonly (readonly [string, number])[];
}[] = [
  {
    path: "fields.supporting.hint",
    values: { max: SUPPORTING_KEYWORDS_MAX },
    pinned: [["max", SUPPORTING_KEYWORDS_MAX]],
  },
  {
    path: "fields.supporting.count",
    values: { count: 2, max: SUPPORTING_KEYWORDS_MAX },
    pinned: [["max", SUPPORTING_KEYWORDS_MAX]],
  },
  {
    path: "validation.supportingLimit",
    values: { max: SUPPORTING_KEYWORDS_MAX },
    pinned: [["max", SUPPORTING_KEYWORDS_MAX]],
  },
  {
    path: "errors.too_many_supporting_keywords",
    values: { max: SUPPORTING_KEYWORDS_MAX },
    pinned: [["max", SUPPORTING_KEYWORDS_MAX]],
  },
  {
    path: "form.intro",
    values: { depth: SERP_DEPTH },
    pinned: [["depth", SERP_DEPTH]],
  },
  {
    path: "running.elapsed",
    values: { seconds: 3, budget: RUN_BUDGET_MS / 1_000 },
    pinned: [["budget", RUN_BUDGET_MS / 1_000]],
  },
  {
    path: "run.elapsed",
    values: { elapsed: 21.4, budget: RUN_BUDGET_MS / 1_000 },
    pinned: [["budget", RUN_BUDGET_MS / 1_000]],
  },
  {
    path: "intent.confirmedRule",
    values: {
      depth: SERP_DEPTH,
      ratio: Math.round(INTENT_CONFIRMED_MIN_RATIO * 100),
    },
    pinned: [
      ["depth", SERP_DEPTH],
      ["ratio", Math.round(INTENT_CONFIRMED_MIN_RATIO * 100)],
    ],
  },
  {
    path: "format.plurality",
    values: { count: 6, returned: 10, min: FORMAT_PLURALITY_MIN },
    pinned: [["min", FORMAT_PLURALITY_MIN]],
  },
  {
    path: "format.belowThreshold",
    values: {
      min: FORMAT_PLURALITY_MIN,
      distribution: "guide 4 / listicle 3 / forum 3",
    },
    pinned: [["min", FORMAT_PLURALITY_MIN]],
  },
  {
    path: "length.insufficient",
    values: { min: CRAWL_MIN_FOR_LENGTH, attempted: 4 },
    pinned: [["min", CRAWL_MIN_FOR_LENGTH]],
  },
  {
    path: "length.insufficientUnknown",
    values: { min: CRAWL_MIN_FOR_LENGTH },
    pinned: [["min", CRAWL_MIN_FOR_LENGTH]],
  },
  {
    path: "mustAnswer.empty",
    values: { min: MUST_ANSWER_MIN_PAGES, observed: 10 },
    pinned: [["min", MUST_ANSWER_MIN_PAGES]],
  },
  {
    path: "mustAnswer.budget",
    values: {
      candidates: 14,
      shown: MUST_ANSWER_CAP,
      cap: MUST_ANSWER_CAP,
      hidden: 6,
    },
    pinned: [["cap", MUST_ANSWER_CAP]],
  },
  {
    path: "outline.insufficient_evidence",
    values: { min: OUTLINE_MIN_QUESTIONS, cap: OUTLINE_CAP },
    pinned: [["min", OUTLINE_MIN_QUESTIONS]],
  },
  {
    path: "outline.validation_failed",
    values: { min: OUTLINE_MIN_QUESTIONS, cap: OUTLINE_CAP },
    pinned: [["cap", OUTLINE_CAP]],
  },
  {
    path: "links.reason.validation_failed",
    values: { cap: INTERNAL_LINKS_CAP },
    pinned: [["cap", INTERNAL_LINKS_CAP]],
  },
  {
    path: "verdict.create.not_observed",
    values: { days: GSC_LOOKBACK_DAYS },
    pinned: [["days", GSC_LOOKBACK_DAYS]],
  },
  {
    path: "verdict.create.below_impression_floor",
    values: {
      days: GSC_LOOKBACK_DAYS,
      minImpressions: SELF_COMPETE_MIN_IMPRESSIONS,
    },
    pinned: [
      ["days", GSC_LOOKBACK_DAYS],
      ["minImpressions", SELF_COMPETE_MIN_IMPRESSIONS],
    ],
  },
  {
    path: "verdict.create.beyond_position_cap",
    values: {
      page: "example.com/a",
      position: "45.0",
      maxPosition: SELF_COMPETE_MAX_POSITION,
    },
    pinned: [["maxPosition", SELF_COMPETE_MAX_POSITION]],
  },
  {
    path: "verdict.update.self_compete",
    values: {
      page: "example.com/a",
      position: "12.0",
      impressions: "80",
      maxPosition: SELF_COMPETE_MAX_POSITION,
    },
    pinned: [["maxPosition", SELF_COMPETE_MAX_POSITION]],
  },
  {
    path: "wontSay.noWithdraw",
    values: { minPages: MUST_ANSWER_MIN_PAGES, languages: "zh / ja / ko / th" },
    pinned: [["minPages", MUST_ANSWER_MIN_PAGES]],
  },
  {
    path: "actions.generateDraftFailed.too_large",
    values: { maxKb: CONTENT_BRIEF_HANDOFF_MAX_BYTES / 1024 },
    pinned: [["maxKb", CONTENT_BRIEF_HANDOFF_MAX_BYTES / 1024]],
  },
];

describe("content brief threshold copy", () => {
  for (const locale of ["en", "zh"] as const) {
    const t = translator(locale);
    for (const { path, values, pinned } of THRESHOLD_COPY) {
      it(`${locale}: ${path} reads its threshold through a parameter`, () => {
        const template = leaf(locale, path);
        const formatted = t(path as never, values as never);
        for (const [parameter, expected] of pinned) {
          // The template names the parameter...
          expect(template, `${path} lacks {${parameter}}`).toContain(
            `{${parameter}}`,
          );
          // ...and never carries the number itself, so it cannot drift.
          expect(template, `${path} hard-codes ${expected}`).not.toMatch(
            new RegExp(`(?<![\\d.{])${expected}(?![\\d}])`),
          );
          // ...and the formatted sentence carries the engine's value.
          expect(formatted).toContain(String(expected));
        }
        // No parameter survived formatting as a literal brace.
        expect(formatted).not.toMatch(/\{[a-zA-Z]+\}/);
      });
    }
  }

  it("pins the do-not-cover cap through the same links sentence", () => {
    // One sentence serves both link cards; it must format for either cap.
    const formatted = translator("en")(
      "links.reason.validation_failed" as never,
      {
        cap: DO_NOT_COVER_CAP,
      } as never,
    );
    expect(formatted).toContain(String(DO_NOT_COVER_CAP));
  });
});

describe("content brief constant arithmetic", () => {
  it("fits the three paid stages and the envelope inside the run budget", () => {
    expect(
      SERP_DEADLINE_MS + CRAWL_DEADLINE_MS + LLM_DEADLINE_MS + ENVELOPE_MS,
    ).toBeLessThanOrEqual(RUN_BUDGET_MS);
  });

  it("uses the same Search Console window as the keyword coverage reader", () => {
    // The package cannot import the app, so the app asserts the equality.
    expect(GSC_LOOKBACK_DAYS).toBe(COVERAGE_WINDOW_DAYS);
  });

  it("caps the outline above the minimum questions it needs", () => {
    expect(OUTLINE_CAP).toBeGreaterThanOrEqual(OUTLINE_MIN_QUESTIONS);
    expect(MUST_ANSWER_CAP).toBeGreaterThanOrEqual(OUTLINE_MIN_QUESTIONS);
  });
});
