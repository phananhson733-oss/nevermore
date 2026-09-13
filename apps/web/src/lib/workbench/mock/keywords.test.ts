import { describe, expect, it } from "vitest";
import type { KeywordRow } from "../types.ts";
import { AI_PATTERNS, PATTERNS, classify, opportunity } from "./keywords.ts";

/** Pattern, classifier and score pins. Estimates live in keywords-metrics.test.ts, row assembly in keywords-rows.test.ts. */

const DEFAULT = { intent: "informational", stage: "MOFU", page: "blog" };
const TOFU = { intent: "informational", stage: "TOFU", page: "blog" };
const COMMERCIAL = { intent: "commercial", stage: "BOFU", page: "comparison" };
const TRANSACTIONAL = {
  intent: "transactional",
  stage: "BOFU",
  page: "landing",
};
const NAVIGATIONAL = { intent: "navigational", stage: "BOFU", page: "landing" };

describe("PATTERNS and AI_PATTERNS", () => {
  it("port the prototype templates and fields in order, only the last one marked vs", () => {
    expect(
      PATTERNS.map(({ make, ...fields }) => ({ q: make("x"), ...fields })),
    ).toEqual([
      {
        q: "best x tools",
        intent: "commercial",
        stage: "MOFU",
        page: "listicle",
        engine: "both",
      },
      {
        q: "x alternatives",
        intent: "commercial",
        stage: "BOFU",
        page: "comparison",
        engine: "both",
      },
      {
        q: "free x tool",
        intent: "transactional",
        stage: "BOFU",
        page: "tool",
        engine: "seo",
      },
      {
        q: "x template",
        intent: "informational",
        stage: "MOFU",
        page: "tool",
        engine: "seo",
      },
      {
        q: "how to x",
        intent: "informational",
        stage: "TOFU",
        page: "blog",
        engine: "both",
      },
      {
        q: "what is x",
        intent: "informational",
        stage: "TOFU",
        page: "glossary",
        engine: "geo",
      },
      {
        q: "x checklist",
        intent: "informational",
        stage: "MOFU",
        page: "blog",
        engine: "seo",
      },
      {
        q: "x for startups",
        intent: "commercial",
        stage: "MOFU",
        page: "landing",
        engine: "seo",
      },
      {
        q: "x pricing",
        intent: "transactional",
        stage: "BOFU",
        page: "landing",
        engine: "seo",
      },
      {
        q: "x vs",
        intent: "commercial",
        stage: "BOFU",
        page: "comparison",
        engine: "both",
        vs: true,
      },
    ]);
    expect(
      PATTERNS.filter((pattern) => Object.hasOwn(pattern, "vs")),
    ).toHaveLength(1);
  });

  it("port the AI prompt templates, the third one naming the brand", () => {
    expect(AI_PATTERNS.map((make) => make("crm", "Acme"))).toEqual([
      "which crm tool works best for a small team?",
      "what should I look for in a crm tool?",
      "is Acme good for crm?",
    ]);
  });
});

describe("classify", () => {
  it.each([
    ["ahrefs vs semrush", COMMERCIAL],
    ["ahrefs vs. semrush", COMMERCIAL],
    ["ahrefs versus semrush", COMMERCIAL],
    ["best crm", COMMERCIAL],
    ["top 10 crm", COMMERCIAL],
    ["crm alternative", COMMERCIAL],
    ["crm alternatives", COMMERCIAL],
    ["crm review", COMMERCIAL],
    ["crm reviews", COMMERCIAL],
    ["compare crm tools", COMMERCIAL],
    ["crm comparison", COMMERCIAL],
    ["crm comparisons", COMMERCIAL],
    ["comparisons of crm", COMMERCIAL],
    ["对比 两个工具", COMMERCIAL],
    ["crm 工具对比", COMMERCIAL],
    ["hubspot 替代", COMMERCIAL],
    ["ｂｅｓｔ crm", COMMERCIAL],
    ["2026年best seo工具", COMMERCIAL],
    ["crm best推荐", COMMERCIAL],
    ["スーパーbest crm", COMMERCIAL],
    ["best crm pricing", COMMERCIAL],
    ["价格对比", COMMERCIAL],
    ["crm pricing", TRANSACTIONAL],
    ["crm price", TRANSACTIONAL],
    ["crm prices", TRANSACTIONAL],
    ["crm cost", TRANSACTIONAL],
    ["crm costs", TRANSACTIONAL],
    ["buy crm", TRANSACTIONAL],
    ["free trial crm", TRANSACTIONAL],
    ["free trials crm", TRANSACTIONAL],
    ["crm trial", TRANSACTIONAL],
    ["crm trials", TRANSACTIONAL],
    ["download crm", TRANSACTIONAL],
    ["crm downloads", TRANSACTIONAL],
    ["crm 价格", TRANSACTIONAL],
    ["crm 多少钱", TRANSACTIONAL],
    ["how to rank", TOFU],
    ["What is GEO", TOFU],
    ["why seo matters", TOFU],
    ["when to post", TOFU],
    ["which crm", TOFU],
    ["who uses crm", TOFU],
    ["怎么做 SEO", TOFU],
    ["如何选择 crm", TOFU],
    ["什么是 GEO", TOFU],
    ["how to compare crm pricing", TOFU],
  ])("%s", (query, expected) => {
    expect(classify(query, "Acme")).toEqual(expected);
  });

  it.each([
    "laptop stand",
    "desktop seo",
    "topical authority",
    "top crm",
    "bestow gifts",
    "bestätigen",
    "cvs pharmacy",
    "vsco filters",
    "caprice",
    "pricey",
    "costco",
    "costume ideas",
    "downloadable templates",
    "buyer persona",
    "whatsapp marketing",
    "howdy partner",
    "whenever",
    "somehow",
    "seo 工具怎么选",
  ])("%s falls back to informational / MOFU / blog", (query) => {
    expect(classify(query, "Acme")).toEqual(DEFAULT);
  });

  it("puts the brand first, as a whole word", () => {
    expect(classify("acme login", "Acme")).toEqual(NAVIGATIONAL);
    expect(classify("best acme alternatives", "Acme")).toEqual(NAVIGATIONAL);
    expect(classify("how to cancel ACME", "Acme")).toEqual(NAVIGATIONAL);
    expect(classify("genre music", "Gen")).toEqual(DEFAULT);
    expect(classify("acme login", "")).toEqual(DEFAULT);
    expect(classify("acme login", "   ")).toEqual(DEFAULT);
  });
});

describe("opportunity", () => {
  type ScoreInput = Parameters<typeof opportunity>[0];
  /** MOFU 16 + seo 4 + min(30, log10(1001) * 9) = 27.0039 + (100 - 48) * 0.25 = 13 → 60.0039. */
  const BASE: ScoreInput = {
    stage: "MOFU",
    engine: "seo",
    volume: 1000,
    kd: 48,
    source: "generated",
    gscStatus: "unknown",
  };
  const score = (overrides: Partial<ScoreInput>): number =>
    opportunity({ ...BASE, ...overrides });

  it("pins the baseline as a whole value, far enough from both clamp ends", () => {
    expect(opportunity(BASE)).toBe(60);
    expect(opportunity(BASE)).toBeGreaterThanOrEqual(10);
    expect(opportunity(BASE)).toBeLessThanOrEqual(70);
  });

  it("adds 20 for borderline, takes 6 for ranked, adds 12 for a GSC source", () => {
    const base = opportunity(BASE);
    expect(base).toBeGreaterThanOrEqual(10);
    expect(base).toBeLessThanOrEqual(70);
    expect(score({ gscStatus: "borderline" })).toBe(base + 20);
    expect(score({ gscStatus: "ranked" })).toBe(base - 6);
    expect(score({ gscStatus: "gap" })).toBe(base);
    expect(score({ source: "gsc" })).toBe(base + 12);
    const { gscStatus: _omitted, ...withoutStatus } = BASE;
    expect(opportunity(withoutStatus)).toBe(base);
  });

  it("weights stage and engine", () => {
    expect(score({ stage: "BOFU" })).toBe(68);
    expect(score({ stage: "TOFU" })).toBe(52);
    expect(score({ engine: "both" })).toBe(64);
    expect(score({ engine: "geo" })).toBe(60);
  });

  it("caps the volume term at 30 and reads kd inside [0, 100]", () => {
    expect(score({ volume: 1_000_000_000 })).toBe(63);
    expect(score({ volume: 0 })).toBe(33);
    expect(score({ kd: 0 })).toBe(72);
    expect(score({ kd: 100 })).toBe(47);
  });

  it("treats non-finite or out-of-range volume and kd as missing, never NaN", () => {
    expect(score({ volume: -5 })).toBe(33);
    expect(score({ volume: Number.NaN })).toBe(33);
    expect(score({ volume: Number.POSITIVE_INFINITY })).toBe(33);
    expect(score({ kd: Number.NaN })).toBe(47);
    expect(score({ kd: -5 })).toBe(47);
    expect(score({ kd: 150 })).toBe(47);
    expect(score({ volume: Number.NaN, kd: Number.NaN })).toBe(20);
  });

  it("clamps to an integer in [0, 100], the lowest possible score being 6", () => {
    expect(
      score({
        stage: "BOFU",
        engine: "both",
        volume: 1_000_000_000,
        kd: 0,
        source: "gsc",
        gscStatus: "borderline",
      }),
    ).toBe(100);
    expect(
      score({
        stage: "TOFU",
        engine: "seo",
        volume: Number.NaN,
        kd: Number.NaN,
        source: "generated",
        gscStatus: "ranked",
      }),
    ).toBe(6);
    for (const stage of ["TOFU", "MOFU", "BOFU"] as const) {
      for (const gscStatus of [
        "ranked",
        "borderline",
        "gap",
        "unknown",
      ] as const) {
        for (const volume of [Number.NaN, -1, 0, 10, 5000, 1e12]) {
          for (const kd of [Number.NaN, 0, 50, 100, 101]) {
            const value = score({
              stage,
              gscStatus,
              volume,
              kd,
              source: "gsc",
              engine: "both",
            });
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  });

  it("ignores the AI Overview flag", () => {
    const row: KeywordRow = {
      q: "seo",
      seed: "seo",
      intent: "informational",
      stage: "MOFU",
      page: "blog",
      engine: "seo",
      source: "generated",
      volume: 1000,
      kd: 48,
      cpc: "1.00",
      aio: false,
      score: 0,
      slug: "/blog/seo",
    };
    const withAio: KeywordRow = { ...row, aio: true };
    expect(opportunity(withAio)).toBe(opportunity(row));
    // @ts-expect-error opportunity takes no aio: the prototype's random +6 is gone.
    expect(opportunity({ ...BASE, aio: true })).toBe(60);
  });
});
