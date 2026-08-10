import { describe, expect, it } from "vitest";
import {
  PAGE_VALUE_DEPTH_PENALTY_STEP,
  PAGE_VALUE_FOREIGN_LOCALE_PENALTY,
  PAGE_VALUE_MIN_CRAWLABLE_SCORE,
  PAGE_VALUE_OFF_TOPIC_PENALTY,
  PAGE_VALUE_PRODUCT_SCORE_THRESHOLD,
  pageValueBreakdown,
  pageValueIsCrawlable,
  pageValueIsProductPage,
  pageValueScore,
} from "./page-value.ts";

const EN = { targetLanguage: "en" } as const;
const DE = { targetLanguage: "de" } as const;

describe("pageValueScore tiers", () => {
  it.each([
    ["homepage", "/", 10],
    ["homepage without a slash", "", 10],
    ["pricing", "/pricing", 9],
    ["plans", "/plans", 9],
    ["german pricing", "/preise", 9],
    ["product", "/product", 8],
    ["features", "/features", 8],
    ["use cases", "/use-cases", 8],
    ["how it works", "/how-it-works", 8],
    ["german solutions", "/loesungen", 8],
    ["about", "/about", 7],
    ["customers", "/customers", 7],
    ["integrations", "/integrations", 7],
    ["faq", "/faq", 6],
    ["tools", "/tools", 6],
    ["unrecognised shallow path", "/anything-else", 0],
  ])("scores the %s tier", (_label, path, expected) => {
    expect(pageValueScore(path, EN)).toBe(expected);
  });

  it("treats a trailing slash and a query as the same path", () => {
    expect(pageValueScore("/pricing/", EN)).toBe(9);
    expect(pageValueScore("/pricing?utm_source=x#top", EN)).toBe(9);
  });

  it("percent-decodes a segment before matching it", () => {
    expect(pageValueScore("/%C3%BCber-uns", DE)).toBe(7);
  });

  it("scores a malformed percent escape rather than dropping the path", () => {
    expect(pageValueScore("/%E0%A4%A", EN)).toBe(0);
  });
});

describe("off-topic sections", () => {
  it("pushes an article section below the crawlable floor", () => {
    const blog = pageValueBreakdown("/blog", EN);
    expect(blog.offTopicPenalty).toBe(PAGE_VALUE_OFF_TOPIC_PENALTY);
    expect(blog.score).toBe(-6);
    expect(pageValueIsCrawlable(blog.score)).toBe(false);
  });

  it("charges the penalty once, however many segments hit it", () => {
    expect(pageValueBreakdown("/blog/tags/news", EN).offTopicPenalty).toBe(
      PAGE_VALUE_OFF_TOPIC_PENALTY,
    );
  });

  it("catches an article section buried under a neutral parent", () => {
    // /resources/blog/x -> 0 section, -6 off-topic, -4 depth.
    expect(pageValueScore("/resources/blog/how-to", EN)).toBe(-10);
  });

  it("recognises the german equivalents", () => {
    expect(pageValueScore("/datenschutz", DE)).toBe(-6);
    expect(pageValueScore("/karriere", DE)).toBe(-6);
  });
});

describe("locale prefixes", () => {
  it("does not penalise the target language", () => {
    const scored = pageValueBreakdown("/de/preise", DE);
    expect(scored.localeSegment).toBe("de");
    expect(scored.foreignLocalePenalty).toBe(0);
    expect(scored.score).toBe(9);
  });

  it("penalises another market's locale prefix", () => {
    const scored = pageValueBreakdown("/de/pricing", EN);
    expect(scored.foreignLocalePenalty).toBe(PAGE_VALUE_FOREIGN_LOCALE_PENALTY);
    expect(scored.score).toBe(1);
  });

  it("matches a region-tagged locale on its primary subtag", () => {
    expect(pageValueBreakdown("/de-ch/preise", DE).foreignLocalePenalty).toBe(0);
    expect(pageValueBreakdown("/en-us/pricing", DE).foreignLocalePenalty).toBe(
      PAGE_VALUE_FOREIGN_LOCALE_PENALTY,
    );
  });

  it("compares only the primary subtag of the target language", () => {
    expect(
      pageValueBreakdown("/de/preise", { targetLanguage: "DE-AT" })
        .foreignLocalePenalty,
    ).toBe(0);
  });

  it("does not read an ordinary two-letter segment as a locale", () => {
    // `/us` and `/ai` match the BCP-47 shape but are not language subtags.
    expect(pageValueBreakdown("/us/pricing", EN).localeSegment).toBeNull();
    expect(pageValueBreakdown("/ai/features", EN).localeSegment).toBeNull();
  });

  it("does not read a hyphenated word as a region-tagged locale", () => {
    expect(pageValueBreakdown("/go-to/pricing", EN).localeSegment).toBeNull();
  });

  it("keeps the locale-only homepage at the homepage tier", () => {
    expect(pageValueScore("/de/", DE)).toBe(10);
    expect(pageValueScore("/de/", EN)).toBe(2);
  });

  it("reports null rather than an empty string when there is no locale", () => {
    expect(pageValueBreakdown("/pricing", EN).localeSegment).toBeNull();
  });
});

describe("depth", () => {
  it("charges one step at depth two and two steps at depth three", () => {
    expect(pageValueBreakdown("/solutions", EN).depthPenalty).toBe(0);
    expect(pageValueBreakdown("/solutions/teams", EN).depthPenalty).toBe(
      PAGE_VALUE_DEPTH_PENALTY_STEP,
    );
    expect(
      pageValueBreakdown("/solutions/teams/enterprise", EN).depthPenalty,
    ).toBe(PAGE_VALUE_DEPTH_PENALTY_STEP * 2);
  });

  it("does not keep charging past depth three", () => {
    expect(pageValueBreakdown("/a/b/c/d/e", EN).depthPenalty).toBe(
      PAGE_VALUE_DEPTH_PENALTY_STEP * 2,
    );
  });

  it("measures depth after the locale prefix is removed", () => {
    expect(pageValueBreakdown("/de/pricing", EN).depth).toBe(1);
    expect(pageValueBreakdown("/de/pricing", EN).segments).toEqual(["pricing"]);
  });
});

describe("thresholds", () => {
  it("counts the about tier and up as product pages", () => {
    expect(PAGE_VALUE_PRODUCT_SCORE_THRESHOLD).toBe(7);
    expect(pageValueIsProductPage(pageValueScore("/about", EN))).toBe(true);
    expect(pageValueIsProductPage(pageValueScore("/faq", EN))).toBe(false);
  });

  it("admits an unrecognised shallow path but not a negative one", () => {
    expect(PAGE_VALUE_MIN_CRAWLABLE_SCORE).toBe(0);
    expect(pageValueIsCrawlable(0)).toBe(true);
    expect(pageValueIsCrawlable(-1)).toBe(false);
  });

  it("sums exactly the four reported terms", () => {
    const scored = pageValueBreakdown("/fr/blog/pricing/x", EN);
    expect(scored.score).toBe(
      scored.sectionScore +
        scored.offTopicPenalty +
        scored.foreignLocalePenalty +
        scored.depthPenalty,
    );
  });
});
