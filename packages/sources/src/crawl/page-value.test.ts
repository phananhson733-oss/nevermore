import { describe, expect, it } from "vitest";
import {
  PAGE_VALUE_DEPTH_PENALTY_STEP,
  PAGE_VALUE_FOREIGN_LOCALE_PENALTY,
  PAGE_VALUE_MIN_CONTEXT_CANDIDATE_SCORE,
  PAGE_VALUE_MIN_CRAWLABLE_SCORE,
  PAGE_VALUE_OFF_TOPIC_PENALTY,
  PAGE_VALUE_PRODUCT_SCORE_THRESHOLD,
  pageValueBreakdown,
  pageValueIsContextCandidate,
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
    expect(pageValueIsContextCandidate(blog)).toBe(false);
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
  it("preserves the public numeric crawlable-score predicate", () => {
    expect(PAGE_VALUE_MIN_CRAWLABLE_SCORE).toBe(0);
    expect(pageValueIsCrawlable(0)).toBe(true);
    expect(pageValueIsCrawlable(-1)).toBe(false);
  });

  it("exposes a distinct context-candidate predicate", () => {
    expect(pageValueIsContextCandidate).toBeTypeOf("function");
  });

  it("counts the about tier and up as product pages", () => {
    expect(PAGE_VALUE_PRODUCT_SCORE_THRESHOLD).toBe(7);
    expect(pageValueIsProductPage(pageValueScore("/about", EN))).toBe(true);
    expect(pageValueIsProductPage(pageValueScore("/faq", EN))).toBe(false);
  });

  it("admits paths whose only penalty is their depth", () => {
    const depthTwo = pageValueBreakdown("/story-generators/fantasy", EN);
    const depthThree = pageValueBreakdown(
      "/rpg-tools/npc-generator/free",
      EN,
    );

    expect(depthTwo).toMatchObject({
      sectionScore: 0,
      offTopicPenalty: 0,
      foreignLocalePenalty: 0,
      depthPenalty: PAGE_VALUE_DEPTH_PENALTY_STEP,
      score: PAGE_VALUE_DEPTH_PENALTY_STEP,
    });
    expect(pageValueIsContextCandidate(depthTwo)).toBe(true);
    expect(depthThree).toMatchObject({
      sectionScore: 0,
      offTopicPenalty: 0,
      foreignLocalePenalty: 0,
      depthPenalty: PAGE_VALUE_DEPTH_PENALTY_STEP * 2,
      score: PAGE_VALUE_DEPTH_PENALTY_STEP * 2,
    });
    expect(pageValueIsContextCandidate(depthThree)).toBe(true);
  });

  it.each([
    ["blog", "/blog/post"],
    ["legal", "/privacy"],
    ["foreign locale", "/fr/story-generators/fantasy"],
  ])("keeps %s paths out of context candidates", (_label, path) => {
    expect(pageValueIsContextCandidate(pageValueBreakdown(path, EN))).toBe(
      false,
    );
  });

  it.each([
    ["an off-topic section under about", "/about/careers", "offTopicPenalty"],
    ["an off-topic section under faq", "/faq/news", "offTopicPenalty"],
    ["a foreign-locale about page", "/fr/about", "foreignLocalePenalty"],
    ["a foreign-locale pricing page", "/fr/pricing", "foreignLocalePenalty"],
  ] as const)(
    "rejects %s even when its total score reaches the crawlable floor",
    (_label, path, penalty) => {
      const scored = pageValueBreakdown(path, EN);

      expect(scored.score).toBeGreaterThanOrEqual(
        PAGE_VALUE_MIN_CONTEXT_CANDIDATE_SCORE,
      );
      expect(scored[penalty]).toBeLessThan(0);
      expect(pageValueIsContextCandidate(scored)).toBe(false);
    },
  );

  it("sets the context-candidate floor to the maximum depth-only penalty", () => {
    expect(PAGE_VALUE_MIN_CONTEXT_CANDIDATE_SCORE).toBe(
      PAGE_VALUE_DEPTH_PENALTY_STEP * 2,
    );
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
