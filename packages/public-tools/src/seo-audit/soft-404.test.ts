// @input  -- collected pages with real body text in both scripts
// @output -- proof the detection needs both signals, and that CJK is safe
// @pos    -- unit coverage for the rule behind two Blocker-capable checks

import { describe, expect, it } from "vitest";

import { softNotFoundVerdict } from "./soft-404.ts";
import type { SeoAuditPage } from "./types.ts";

function page(overrides: {
  readonly title?: string | null;
  readonly bodyText?: string | null;
  readonly finalStatus?: number;
  readonly noAssets?: boolean;
}): SeoAuditPage {
  return {
    url: "https://acme.test/p",
    subjectUrl: "https://acme.test/p",
    finalUrl: "https://acme.test/p",
    depth: 1,
    initialStatus: 200,
    finalStatus: overrides.finalStatus ?? 200,
    redirectHops: 0,
    contentType: "text/html",
    robotsDirectiveState: "noindex_not_observed",
    canonicalTarget: "https://acme.test/p",
    title: overrides.title ?? "Title",
    metaDescription: null,
    h1Count: 1,
    headingsCount: 1,
    wordCount: 10,
    inboundLinks: 1,
    outboundLinks: 1,
    sitemapMember: true,
    jsonLdTypes: [],
    jsonLdErrorCount: 0,
  };
}

/** What the raw crawl carried for that page, which is where body text lives. */
/** The whole body's measure, as the raw crawl now carries it. */
function metrics(overrides: {
  readonly title?: string | null;
  readonly bodyText?: string | null;
  readonly finalStatus?: number;
  readonly noAssets?: boolean;
}) {
  if (overrides.noAssets) return null;
  const text = overrides.bodyText ?? "Short body.";
  const cjk = text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/gu);
  const cjkChars = cjk === null ? 0 : cjk.length;
  const rest = text.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/gu, "");
  return { cjkChars, nonCjkWords: rest.split(/\s+/u).filter(Boolean).length };
}

/** Opening text, which is where the phrase is looked for. */
function opening(overrides: {
  readonly title?: string | null;
  readonly bodyText?: string | null;
  readonly finalStatus?: number;
  readonly noAssets?: boolean;
}) {
  return overrides.noAssets ? null : (overrides.bodyText ?? "Short body.");
}

/** Enough words to clear the floor without being about anything. */
const LONG_LATIN = Array.from({ length: 250 }, (_, i) => `word${i}`).join(" ");
/** Enough Chinese characters to clear the floor, and NO spaces at all. */
const LONG_CJK = "内容".repeat(150);

describe("softNotFoundVerdict", () => {
  it("reports a page that says it is missing and has nothing else", () => {
    const verdict = softNotFoundVerdict(page({ title: "404 - Page not found", bodyText: "Sorry, nothing here." }), metrics({ title: "404 - Page not found", bodyText: "Sorry, nothing here." }), opening({ title: "404 - Page not found", bodyText: "Sorry, nothing here." }));

    expect(verdict?.matchedPhrase).toBe("404");
    expect(verdict?.bodyUnits.basis).toBe("words");
  });

  it("does not report a short page that says nothing of the kind", () => {
    // A pricing page with six words and a table is a short page, which other
    // checks report. Condemning it here would make a Blocker out of brevity.
    expect(
      softNotFoundVerdict(page({ title: "Pricing", bodyText: "Two plans." }), metrics({ title: "Pricing", bodyText: "Two plans." }), opening({ title: "Pricing", bodyText: "Two plans." })),
    ).toBeNull();
  });

  it("does not report an article about error pages", () => {
    // The phrase is present and deliberate. Without the body floor this is the
    // false positive that would fail a healthy page at Blocker severity.
    expect(
      softNotFoundVerdict(page({ title: "How to fix 404 errors", bodyText: LONG_LATIN }), metrics({ title: "How to fix 404 errors", bodyText: LONG_LATIN }), opening({ title: "How to fix 404 errors", bodyText: LONG_LATIN })),
    ).toBeNull();
  });

  it("does not read a footer link as the page's own statement", () => {
    // "404" in a footer appears on entirely healthy sites, so only the title
    // and the opening of the body are searched.
    const text = `${"Real content here. ".repeat(5)}${"filler ".repeat(60)} 404`;
    expect(
      softNotFoundVerdict(
        page({ title: "Guide", bodyText: text }),
        metrics({ bodyText: text }),
        text,
      ),
    ).toBeNull();
  });

  it("never fires on a page that did not answer 200", () => {
    expect(
      softNotFoundVerdict(page({ title: "404", bodyText: "Nothing", finalStatus: 404 }), metrics({ title: "404", bodyText: "Nothing", finalStatus: 404 }), opening({ title: "404", bodyText: "Nothing", finalStatus: 404 })),
    ).toBeNull();
  });

  it("returns nothing rather than guessing when the body was not captured", () => {
    expect(softNotFoundVerdict(page({ title: "404", noAssets: true }), metrics({ title: "404", noAssets: true }), opening({ title: "404", noAssets: true }))).toBeNull();
  });

  describe("Chinese pages", () => {
    it("does not condemn a full Chinese page that has no spaces in it", () => {
      // This is the whole reason the measure is not a whitespace word count.
      // `LONG_CJK` splits into ONE word, so a word floor would put every page
      // of a Chinese site below it — and A4 is a Blocker, on a product whose
      // own site is Chinese first.
      expect(LONG_CJK.split(/\s+/).filter(Boolean)).toHaveLength(1);
      expect(
        softNotFoundVerdict(page({ title: "产品定价", bodyText: LONG_CJK }), metrics({ title: "产品定价", bodyText: LONG_CJK }), opening({ title: "产品定价", bodyText: LONG_CJK })),
      ).toBeNull();
    });

    it("does not condemn a long Chinese page that mentions the phrase", () => {
      expect(
        softNotFoundVerdict(page({ title: "页面不存在时该怎么办", bodyText: LONG_CJK }), metrics({ title: "页面不存在时该怎么办", bodyText: LONG_CJK }), opening({ title: "页面不存在时该怎么办", bodyText: LONG_CJK })),
      ).toBeNull();
    });

    it("still reports a real Chinese soft 404", () => {
      const verdict = softNotFoundVerdict(page({ title: "页面不存在", bodyText: "抱歉，你访问的页面不存在。" }), metrics({ title: "页面不存在", bodyText: "抱歉，你访问的页面不存在。" }), opening({ title: "页面不存在", bodyText: "抱歉，你访问的页面不存在。" }));

      expect(verdict?.matchedPhrase).toBe("页面不存在");
      // Not "words": full-width punctuation is not a CJK unit, so a page of
      // Chinese prose reports "mixed". What matters is that the characters
      // were counted at all — under a whitespace split this body is 1 unit and
      // so is a 3000-character article.
      expect(verdict?.bodyUnits.basis).toBe("mixed");
      expect(verdict?.bodyUnits.units).toBeGreaterThan(5);
    });
  });
});
