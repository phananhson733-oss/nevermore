import { describe, expect, it } from "vitest";

import type { CrawlPageProjection } from "@sf/sources/crawl-public-preview";

import {
  buildTargetPageExtract,
  MAX_EXTRACT_ENTRY_CHARS,
  MAX_EXTRACT_H1,
  MAX_EXTRACT_SUB_HEADINGS,
} from "./extract.ts";

function projection(
  overrides: Partial<CrawlPageProjection> = {},
): CrawlPageProjection {
  return {
    fetchUrl: "https://www.astrologywiki.com/",
    status: 200,
    finalStatus: 200,
    redirectChain: [],
    canonicalTarget: "https://www.astrologywiki.com/",
    robotsIndexable: true,
    robotsDirectives: [],
    title: "Free Birth Chart Calculator",
    metaDescription: "Free birth chart calculator and readings.",
    h1: ["Free Birth Chart & Astrology Readings"],
    headings: [
      "Free Birth Chart & Astrology Readings",
      "What a free birth chart can show you",
      "How to calculate an accurate natal chart",
    ],
    wordCount: 1631,
    internalOutlinks: [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: true,
    bodyExcerpt: "A birth chart is a map of the sky at your moment of birth.",
    paragraphs: [],
    responseMs: 98,
    contentType: "text/html; charset=utf-8",
    ...overrides,
  };
}

describe("buildTargetPageExtract", () => {
  it("carries the page's own text through unchanged", () => {
    const extract = buildTargetPageExtract(projection());
    expect(extract.url).toBe("https://www.astrologywiki.com/");
    expect(extract.title).toBe("Free Birth Chart Calculator");
    expect(extract.metaDescription).toBe(
      "Free birth chart calculator and readings.",
    );
    expect(extract.openingText).toBe(
      "A birth chart is a map of the sky at your moment of birth.",
    );
  });

  it("derives sub-headings by removing the H1 texts from the heading list", () => {
    expect(buildTargetPageExtract(projection()).subHeadings).toEqual([
      "What a free birth chart can show you",
      "How to calculate an accurate natal chart",
    ]);
  });

  it("removes one heading per H1 occurrence, not every equal string", () => {
    const extract = buildTargetPageExtract(
      projection({
        h1: ["Repeated"],
        headings: ["Repeated", "Repeated", "Unique"],
      }),
    );
    // Only one of the two equal headings belongs to the H1.
    expect(extract.subHeadings).toEqual(["Repeated", "Unique"]);
  });

  it("reports sub-headings as underivable when the H1 collector hit its cap", () => {
    const extract = buildTargetPageExtract(
      projection({
        h1: Array.from({ length: 20 }, (_unused, index) => `H1 ${index}`),
        headings: ["H1 0", "A real H2"],
      }),
    );
    // Past the cap the heading list may hold H1s we can no longer identify,
    // so subtracting would silently delete real sub-headings.
    expect(extract.subHeadings).toBeNull();
  });

  it("keeps an empty sub-heading list distinct from an underivable one", () => {
    const extract = buildTargetPageExtract(
      projection({ h1: ["Only"], headings: ["Only"] }),
    );
    expect(extract.subHeadings).toEqual([]);
  });

  it("caps the lists and flags that it did", () => {
    const extract = buildTargetPageExtract(
      projection({
        h1: Array.from({ length: 15 }, (_unused, i) => `H1 ${i}`),
        headings: Array.from({ length: 90 }, (_unused, i) => `H ${i}`),
      }),
    );
    expect(extract.h1).toHaveLength(MAX_EXTRACT_H1);
    expect(extract.subHeadings).toHaveLength(MAX_EXTRACT_SUB_HEADINGS);
    expect(extract.truncatedLists).toBe(true);
  });

  it("does not flag truncation when nothing was cut", () => {
    expect(buildTargetPageExtract(projection()).truncatedLists).toBe(false);
  });

  it("truncates an over-long entry", () => {
    const long = "x".repeat(MAX_EXTRACT_ENTRY_CHARS + 50);
    const extract = buildTargetPageExtract(
      projection({ h1: [long], headings: [long] }),
    );
    expect(extract.h1[0]).toHaveLength(MAX_EXTRACT_ENTRY_CHARS);
    expect(extract.truncatedLists).toBe(true);
  });

  it("passes a Latin page's word count straight through", () => {
    expect(buildTargetPageExtract(projection()).staticBodyWords).toBe(1631);
  });

  it("withholds the word count for a page written without word gaps", () => {
    // Whitespace splitting would call this whole body one word.
    const extract = buildTargetPageExtract(
      projection({
        bodyExcerpt: "出生星盘是你出生那一刻天空的地图，这份指南解释如何阅读它。",
        wordCount: 1,
      }),
    );
    expect(extract.staticBodyWords).toBeNull();
  });

  it("keeps the word count for a mostly-Latin page with some CJK", () => {
    const extract = buildTargetPageExtract(
      projection({
        bodyExcerpt: "A birth chart is a map of the sky 占星 at your moment.",
        wordCount: 1200,
      }),
    );
    expect(extract.staticBodyWords).toBe(1200);
  });

  it("keeps a null word count null", () => {
    expect(
      buildTargetPageExtract(projection({ wordCount: null })).staticBodyWords,
    ).toBeNull();
  });

  it("maps absent text to null rather than an empty string", () => {
    const extract = buildTargetPageExtract(
      projection({ title: null, metaDescription: null, bodyExcerpt: null }),
    );
    expect(extract.title).toBeNull();
    expect(extract.metaDescription).toBeNull();
    expect(extract.openingText).toBeNull();
  });
});
