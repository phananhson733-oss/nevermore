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

  it("never cuts a character in half", () => {
    const long = `${"a".repeat(MAX_EXTRACT_ENTRY_CHARS - 1)}\u{1F600}`;
    const kept = buildTargetPageExtract(
      projection({ h1: [long], headings: [long] }),
    ).h1[0];

    // Slicing by code unit leaves an orphaned high surrogate, which is
    // corrupted text in the response and can fail the JSONB cache write.
    expect(kept).not.toMatch(/[\uD800-\uDBFF]$/u);
    expect(kept).toBe("a".repeat(MAX_EXTRACT_ENTRY_CHARS - 1));
  });

  it("passes a Latin page's word count straight through", () => {
    expect(buildTargetPageExtract(projection()).staticBodyWords).toBe(1631);
  });

  it("withholds the word count when emoji inflate the code-unit count", () => {
    // 3 CJK of 7 code points is 43%; measured in code units it reads as 27%
    // and slips under the threshold.
    expect(
      buildTargetPageExtract(
        projection({
          bodyExcerpt: "\u5360\u661F\u56FE\u{1F600}\u{1F600}\u{1F600}\u{1F600}",
          wordCount: 1,
        }),
      ).staticBodyWords,
    ).toBeNull();
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

/**
 * The on-page facts the checker reports beyond keyword placement.
 *
 * Split in two on purpose. `response` comes from the crawl's own HTTP journey
 * and is always known once a page was collected. `declared` comes from markup
 * the crawler parses beside the frozen projection, and is optional on the page
 * record — so a crawl that did not carry it reports null rather than a page
 * that declared nothing.
 */
describe("buildTargetPageExtract on-page facts", () => {
  const onPage = {
    lang: "en",
    openGraph: {
      title: "Free Birth Chart Calculator",
      description: "What the card says.",
      image: "https://www.astrologywiki.com/card.png",
    },
    twitterCard: "summary_large_image",
    viewport: "width=device-width, initial-scale=1",
    charset: "utf-8",
    faviconDeclared: true,
    hreflang: ["en"],
    images: {
      total: 4,
      withAlt: 3,
      withEmptyAlt: 1,
      withoutAlt: 0,
      withDimensions: 2,
      lazyLoaded: 1,
    },
    externalLinks: { total: 2, nofollow: 1, blankWithoutNoopener: 0 },
    htmlBytes: 31_744,
    visibleTextBytes: 10_729,
    scriptBytes: 4_096,
    interactive: {
      forms: 1,
      inputs: 3,
      buttons: 1,
      selects: 0,
      textareas: 0,
      canvases: 0,
      media: 0,
      iframes: 0,
    },
    textMetrics: { cjkChars: 0, nonCjkWords: 1_800, denseChars: 9_000 },
    termFrequencies: [
      { size: 1, rows: [{ phrase: "astrology", count: 42 }] },
    ],
  } as const;

  it("reports what the page declared", () => {
    const extract = buildTargetPageExtract(projection(), onPage);

    // `textMetrics` is deliberately not among them: it is how the body was
    // measured, not something the markup declared, and it leaves through
    // `staticBodyUnits` instead.
    const { textMetrics: _measured, termFrequencies: _terms, ...declared } = onPage;
    expect(extract.declared).toEqual(declared);
  });

  it("publishes the body length in units every script can be counted in", () => {
    const latin = buildTargetPageExtract(projection(), onPage);
    expect(latin.staticBodyUnits).toEqual({ units: 1_800, basis: "words" });

    const chinese = buildTargetPageExtract(projection(), {
      ...onPage,
      textMetrics: { cjkChars: 4_200, nonCjkWords: 40, denseChars: 4_300 },
    });
    // A Chinese page used to have no length at all here, which the score read
    // as a page too thin to rank.
    expect(chinese.staticBodyUnits).toEqual({ units: 4_240, basis: "mixed" });
    expect(chinese.staticBodyWords).toBeNull();
  });

  it("decides the withheld word count on the body, not on its opening", () => {
    // English opening, Chinese body. Measured on the 500-character excerpt this
    // page passed the threshold and published a whitespace count of about 40
    // for five thousand characters of Chinese — read downstream as thin.
    const extract = buildTargetPageExtract(
      projection({ bodyExcerpt: "An English opening sentence, and then more." }),
      { ...onPage, textMetrics: { cjkChars: 5_000, nonCjkWords: 40, denseChars: 5_200 } },
    );

    expect(extract.staticBodyWords).toBeNull();
    expect(extract.staticBodyUnits?.units).toBe(5_040);
  });

  it("reports the crawl's own HTTP journey", () => {
    const extract = buildTargetPageExtract(
      projection({
        redirectChain: ["https://astrologywiki.com/"],
        jsonLd: { types: ["Organization", "WebSite"], errorCount: 1 },
        internalOutlinks: [
          { targetSubjectUrl: "https://x.test/a", rel: null, anchorText: "A" },
          { targetSubjectUrl: "https://x.test/b", rel: null, anchorText: null },
        ],
      }),
      onPage,
    );

    expect(extract.response).toEqual({
      status: 200,
      finalStatus: 200,
      redirectHops: 1,
      responseMs: 98,
      contentType: "text/html; charset=utf-8",
      canonicalTarget: "https://www.astrologywiki.com/",
      robotsIndexable: true,
      robotsDirectives: [],
      sitemapMember: true,
      jsonLdTypes: ["Organization", "WebSite"],
      jsonLdErrorCount: 1,
      internalOutlinks: 2,
      internalOutlinksWithoutAnchorText: 1,
    });
  });

  it("says null rather than inventing a page that declared nothing", () => {
    // A crawl record without the side-car: unknown, which is not the same fact
    // as a page carrying no Open Graph tags.
    const extract = buildTargetPageExtract(projection());

    expect(extract.declared).toBeNull();
    expect(extract.response.status).toBe(200);
  });
})
