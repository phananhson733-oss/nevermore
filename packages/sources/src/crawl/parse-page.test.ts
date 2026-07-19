import { describe, expect, it } from "vitest";
import { directivesIndexable, parsePage } from "./parse-page.ts";
import { CRAWL_PROJECTION_LIMITS } from "./types.ts";

const BASE = "https://example.com/";

const HOME_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Example Home</title>
  <meta name="description" content="The example homepage.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://example.com/">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example"}</script>
</head>
<body>
  <nav><a href="/skip-me">nav link</a></nav>
  <h1>Welcome to Example</h1>
  <h2>About us</h2>
  <p>Example builds delightful widgets for delightful people.</p>
  <a href="/about" rel="nofollow">About</a>
  <a href="https://other.com/x">External</a>
  <footer>footer text</footer>
</body>
</html>`;

describe("parsePage", () => {
  it("extracts core content facts from a normal page", () => {
    const page = parsePage(HOME_HTML, BASE);
    expect(page.title).toBe("Example Home");
    expect(page.metaDescription).toBe("The example homepage.");
    expect(page.canonicalTarget).toBe("https://example.com/");
    expect(page.robotsDirectives).toEqual(["index", "follow"]);
    expect(page.robotsIndexable).toBe(true);
    expect(page.h1).toEqual(["Welcome to Example"]);
    expect(page.headings).toContain("Welcome to Example");
    expect(page.headings).toContain("About us");
    expect(page.wordCount).toBeGreaterThan(0);
    expect(page.paragraphs).toContain("Example builds delightful widgets for delightful people.");
    expect(page.bodyExcerpt).not.toBeNull();
    expect(page.jsonLd).toEqual({ types: ["Organization"], errorCount: 0 });
  });

  it("keeps only same-origin outlinks, canonicalized, with rel + anchor text", () => {
    const page = parsePage(HOME_HTML, BASE);
    const targets = page.internalOutlinks.map((link) => link.targetSubjectUrl);
    expect(targets).toContain("https://example.com/about");
    expect(targets).toContain("https://example.com/skip-me");
    expect(targets.some((target) => target.startsWith("https://other.com"))).toBe(false);
    const about = page.internalOutlinks.find((link) => link.targetSubjectUrl === "https://example.com/about");
    expect(about?.rel).toBe("nofollow");
    expect(about?.anchorText).toBe("About");
  });

  it("marks a noindex page as not indexable", () => {
    const html = `<html><head><meta name="robots" content="noindex, nofollow"></head><body><p>x</p></body></html>`;
    const page = parsePage(html, BASE);
    expect(page.robotsDirectives).toEqual(["noindex", "nofollow"]);
    expect(page.robotsIndexable).toBe(false);
  });

  it("counts a JSON-LD block that fails to parse", () => {
    const html = `<html><head><script type="application/ld+json">{ not valid json }</script></head><body></body></html>`;
    const page = parsePage(html, BASE);
    expect(page.jsonLd.errorCount).toBe(1);
    expect(page.jsonLd.types).toEqual([]);
  });

  it("returns null content fields and zero words for an empty document", () => {
    const page = parsePage("", BASE);
    expect(page.title).toBeNull();
    expect(page.metaDescription).toBeNull();
    expect(page.canonicalTarget).toBeNull();
    expect(page.bodyExcerpt).toBeNull();
    expect(page.wordCount).toBe(0);
    expect(page.internalOutlinks).toEqual([]);
  });

  it("supports quoted/unquoted attributes, entities, and accessible anchor names", () => {
    const html = `
      <title>Fish &amp; Chips &#x26; More</title>
      <meta name=description content='A &quot;quoted&quot; summary'>
      <meta name=robots content=' INDEX, , Follow '>
      <link rel='canonical' href='/canonical?utm_source=test'>
      <body>
        <a href='/aria' aria-label=' Accessible label '>ignored</a>
        <a href=/image><img alt=' Image label '></a>
        <a href='/empty'></a>
        <a href='/aria'>duplicate target</a>
        <a href='javascript:alert(1)'>bad scheme</a>
        <a>missing href</a>
        <a href='/blank-rel' rel=' '>Blank relation</a>
        <p>One&nbsp;two &lt;three&gt; &#39;four&#39; &#65;</p>
      </body>`;
    const page = parsePage(html, BASE);
    expect(page.title).toBe("Fish & Chips & More");
    expect(page.metaDescription).toBe('A "quoted" summary');
    expect(page.canonicalTarget).toBe("https://example.com/canonical");
    expect(page.robotsDirectives).toEqual(["index", "follow"]);
    expect(page.paragraphs).toEqual(["One two <three> 'four' A"]);
    expect(page.internalOutlinks).toEqual([
      {
        targetSubjectUrl: "https://example.com/aria",
        rel: null,
        anchorText: "Accessible label",
      },
      {
        targetSubjectUrl: "https://example.com/blank-rel",
        rel: null,
        anchorText: "Blank relation",
      },
      {
        targetSubjectUrl: "https://example.com/empty",
        rel: null,
        anchorText: null,
      },
      {
        targetSubjectUrl: "https://example.com/image",
        rel: null,
        anchorText: "Image label",
      },
    ]);
  });

  it("never crashes on hostile numeric HTML entities and preserves normal decoding", () => {
    const html = `<html>
      <head><title>Hostile &#999999999999; &#-1; &#x110000; &#xD800; &#xZZ;</title></head>
      <body><p>Values &#999999999999; &#-1; &#x110000; &#xD800; &#xZZ; &#65; &#x42;</p></body>
    </html>`;

    expect(() => parsePage(html, BASE)).not.toThrow();
    const page = parsePage(html, BASE);
    expect(page.title).toContain("Hostile");
    expect(page.paragraphs).toHaveLength(1);
    expect(page.paragraphs[0]).toContain("A B");
  });

  it("walks nested JSON-LD graphs and keeps only string type declarations", () => {
    const html = `<script type="application/ld+json">{
      "@context": { "@type": "IgnoredContextType" },
      "@graph": [
        { "@type": ["Article", 42, "WebPage"] },
        { "nested": { "@type": "Organization" } },
        { "@type": 99 }
      ]
    }</script>`;
    expect(parsePage(html, BASE).jsonLd).toEqual({
      types: ["Article", "Organization", "WebPage"],
      errorCount: 0,
    });
  });

  it("fails closed for an invalid page base and canonical target", () => {
    const page = parsePage(
      `<link rel="canonical" href="javascript:alert(1)"><a href="/relative">Relative</a>`,
      "not a URL",
    );
    expect(page.canonicalTarget).toBeNull();
    expect(page.internalOutlinks).toEqual([]);
  });

  it("enforces finite heading, paragraph, excerpt, and outlink projections", () => {
    const headings = Array.from(
      { length: CRAWL_PROJECTION_LIMITS.maxHeadings + 5 },
      (_unused, index) =>
        `<h2>${`Heading ${index} `.padEnd(
          CRAWL_PROJECTION_LIMITS.maxHeadingChars + 50,
          "h",
        )}</h2>`,
    ).join("");
    const paragraphs = Array.from(
      { length: CRAWL_PROJECTION_LIMITS.maxParagraphs + 5 },
      (_unused, index) =>
        `<p>${"x".repeat(
          CRAWL_PROJECTION_LIMITS.maxParagraphChars + 100,
        )} ${index}</p>`,
    ).join("");
    const links = Array.from(
      { length: CRAWL_PROJECTION_LIMITS.maxInternalOutlinks + 5 },
      (_unused, index) =>
        `<a href="/page-${index}" rel="${"r".repeat(
          CRAWL_PROJECTION_LIMITS.maxRelChars + 50,
        )}">${"a".repeat(
          CRAWL_PROJECTION_LIMITS.maxAnchorTextChars + 50,
        )}</a>`,
    ).join("");
    const page = parsePage(`<body>${headings}${paragraphs}${links}</body>`, BASE);
    expect(page.headings).toHaveLength(CRAWL_PROJECTION_LIMITS.maxHeadings);
    expect(page.headings.every((value) => value.length <= CRAWL_PROJECTION_LIMITS.maxHeadingChars)).toBe(true);
    expect(page.paragraphs).toHaveLength(CRAWL_PROJECTION_LIMITS.maxParagraphs);
    expect(page.paragraphs[0]).toHaveLength(CRAWL_PROJECTION_LIMITS.maxParagraphChars);
    expect(page.internalOutlinks).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxInternalOutlinks,
    );
    expect(
      page.internalOutlinks.every(
        (link) =>
          (link.rel?.length ?? 0) <= CRAWL_PROJECTION_LIMITS.maxRelChars &&
          (link.anchorText?.length ?? 0) <=
            CRAWL_PROJECTION_LIMITS.maxAnchorTextChars,
      ),
    ).toBe(true);
    expect(page.bodyExcerpt).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxBodyExcerptChars,
    );
  });

  it("caps every persisted content string and array while preserving safe prefixes", () => {
    const title = "T".repeat(CRAWL_PROJECTION_LIMITS.maxTitleChars + 100);
    const description = "D".repeat(
      CRAWL_PROJECTION_LIMITS.maxMetaDescriptionChars + 100,
    );
    const h1 = Array.from(
      { length: CRAWL_PROJECTION_LIMITS.maxH1 + 3 },
      (_unused, index) =>
        `<h1>${`${index}:`.padEnd(
          CRAWL_PROJECTION_LIMITS.maxH1Chars + 50,
          "H",
        )}</h1>`,
    ).join("");
    const directives = Array.from(
      { length: CRAWL_PROJECTION_LIMITS.maxRobotsDirectives + 3 },
      (_unused, index) =>
        `${index}-${"d".repeat(
          CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars + 50,
        )}`,
    ).join(",");
    const jsonLdTypes = Array.from(
      { length: CRAWL_PROJECTION_LIMITS.maxJsonLdTypes + 3 },
      (_unused, index) =>
        `${index}-${"J".repeat(
          CRAWL_PROJECTION_LIMITS.maxJsonLdTypeChars + 50,
        )}`,
    );
    const page = parsePage(
      `<html><head>
        <title>${title}</title>
        <meta name="description" content="${description}">
        <meta name="robots" content="${directives}">
        <link rel="canonical" href="/${"c".repeat(
          CRAWL_PROJECTION_LIMITS.maxUrlChars + 10,
        )}">
        <script type="application/ld+json">${JSON.stringify({
          "@type": jsonLdTypes,
        })}</script>
      </head><body>${h1}</body></html>`,
      BASE,
    );

    expect(page.title).toBe(title.slice(0, CRAWL_PROJECTION_LIMITS.maxTitleChars));
    expect(page.metaDescription).toBe(
      description.slice(0, CRAWL_PROJECTION_LIMITS.maxMetaDescriptionChars),
    );
    expect(page.canonicalTarget).toBeNull();
    expect(page.robotsDirectives).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxRobotsDirectives,
    );
    expect(
      page.robotsDirectives.every(
        (value) =>
          value.length <= CRAWL_PROJECTION_LIMITS.maxRobotsDirectiveChars,
      ),
    ).toBe(true);
    expect(page.h1).toHaveLength(CRAWL_PROJECTION_LIMITS.maxH1);
    expect(
      page.h1.every(
        (value) => value.length <= CRAWL_PROJECTION_LIMITS.maxH1Chars,
      ),
    ).toBe(true);
    expect(page.jsonLd.types).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxJsonLdTypes,
    );
    expect(
      page.jsonLd.types.every(
        (value) => value.length <= CRAWL_PROJECTION_LIMITS.maxJsonLdTypeChars,
      ),
    ).toBe(true);
  });

  it("drops empty projections and overlong outlink URLs", () => {
    const longHref = `/${"x".repeat(
      CRAWL_PROJECTION_LIMITS.maxUrlChars + 10,
    )}`;
    const page = parsePage(
      `<html><head><title> </title></head><body>
        <h1><span> </span></h1><h2> </h2><p> </p>
        <a href="${longHref}">Long</a>
        <a href="/image"><img alt=""></a>
      </body></html>`,
      BASE,
    );

    expect(page.title).toBeNull();
    expect(page.h1).toEqual([]);
    expect(page.headings).toEqual([]);
    expect(page.paragraphs).toEqual([]);
    expect(page.internalOutlinks).toEqual([
      {
        targetSubjectUrl: "https://example.com/image",
        rel: null,
        anchorText: null,
      },
    ]);
  });

  it("bounds JSON-LD block traversal and discards blank type values", () => {
    const blocks = Array.from(
      { length: CRAWL_PROJECTION_LIMITS.maxJsonLdBlocks + 1 },
      (_unused, index) =>
        `<script type="application/ld+json">${JSON.stringify({
          "@type": index === 0 ? "   " : null,
        })}</script>`,
    ).join("");

    expect(parsePage(blocks, BASE).jsonLd).toEqual({
      types: [],
      errorCount: 0,
    });
  });
});

describe("directivesIndexable", () => {
  it("treats noindex or none as not indexable", () => {
    expect(directivesIndexable([])).toBe(true);
    expect(directivesIndexable(["index", "follow"])).toBe(true);
    expect(directivesIndexable(["noindex"])).toBe(false);
    expect(directivesIndexable(["none"])).toBe(false);
  });
});
