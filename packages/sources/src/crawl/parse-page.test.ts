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
    expect(page.htmlLanguage).toEqual({
      declaredTag: "en",
      canonicalTag: "en",
    });
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

  it("canonicalizes a valid html lang without inferring a missing region", () => {
    expect(
      parsePage(`<html lang=" zh-hant-tw "><body>你好</body></html>`, BASE)
        .htmlLanguage,
    ).toEqual({
      declaredTag: "zh-hant-tw",
      canonicalTag: "zh-Hant-TW",
    });
    expect(
      parsePage(`<html lang="en"><body>Hello</body></html>`, BASE)
        .htmlLanguage,
    ).toEqual({
      declaredTag: "en",
      canonicalTag: "en",
    });
  });

  it("retains invalid non-empty declarations as evidence but never canonicalizes them", () => {
    expect(
      parsePage(`<html lang="en_US"><body>Hello</body></html>`, BASE)
        .htmlLanguage,
    ).toEqual({
      declaredTag: "en_US",
      canonicalTag: null,
    });
  });

  it("treats a missing or empty html lang as missing evidence", () => {
    expect(parsePage(`<html><body>Hello</body></html>`, BASE).htmlLanguage).toBe(
      null,
    );
    expect(
      parsePage(`<html lang="  "><body>Hello</body></html>`, BASE).htmlLanguage,
    ).toBe(null);
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

  it("decodes HTML entities in URL-valued attributes exactly once", () => {
    const page = parsePage(
      `<html><head>
        <link rel="canonical" href="/listing?category=case_study&amp;pillar=attribution">
      </head><body>
        <a href="/listing?category=case_study&amp;pillar=attribution">Named</a>
        <a href="/listing?category=case_study&#38;pillar=attribution">Decimal</a>
        <a href="/listing?category=case_study&#x26;pillar=attribution">Hex</a>
        <a href="/literal?value=%26amp%3B">Encoded literal</a>
      </body></html>`,
      BASE,
    );

    expect(page.canonicalTarget).toBe(
      "https://example.com/listing?category=case_study&pillar=attribution",
    );
    expect(page.internalOutlinks.map((link) => link.targetSubjectUrl)).toEqual([
      "https://example.com/listing?category=case_study&pillar=attribution",
      "https://example.com/literal?value=%26amp%3B",
    ]);
  });

  it("keeps subdomains outside the exact same-origin crawl graph", () => {
    const page = parsePage(
      `<body>
        <a href="https://example.com/app">Same-origin path</a>
        <a href="https://app.example.com/">Application subdomain</a>
        <a href="http://example.com/insecure">Different scheme</a>
        <a href="https://example.com:8443/admin">Different port</a>
      </body>`,
      BASE,
    );

    expect(page.internalOutlinks.map((link) => link.targetSubjectUrl)).toEqual([
      "https://example.com/app",
    ]);
  });

  it("keeps exact fetch targets privately while persisted links remain aggregation identities", () => {
    const page = parsePage(
      `<body>
        <a href="/pricing/">Pricing slash</a>
        <a href="/pricing">Pricing no slash</a>
      </body>`,
      BASE,
    );

    expect(page.internalOutlinks).toEqual([
      {
        targetSubjectUrl: "https://example.com/pricing",
        rel: null,
        anchorText: "Pricing slash",
      },
    ]);
    expect(page.internalFetchTargets).toEqual([
      {
        fetchUrl: "https://example.com/pricing",
        subjectUrl: "https://example.com/pricing",
      },
      {
        fetchUrl: "https://example.com/pricing/",
        subjectUrl: "https://example.com/pricing",
      },
    ]);
  });

  it("persists the exact canonical href instead of its slash-folded subject", () => {
    const slashCanonical = parsePage(
      `<html><head><link rel="canonical" href="/docs/"></head></html>`,
      "https://example.com/docs",
    );
    const noSlashCanonical = parsePage(
      `<html><head><link rel="canonical" href="/docs"></head></html>`,
      "https://example.com/docs/",
    );

    expect(slashCanonical.canonicalTarget).toBe("https://example.com/docs/");
    expect(slashCanonical.canonicalFetchTarget).toEqual({
      fetchUrl: "https://example.com/docs/",
      subjectUrl: "https://example.com/docs",
    });
    expect(noSlashCanonical.canonicalTarget).toBe(
      "https://example.com/docs",
    );
    expect(noSlashCanonical.canonicalFetchTarget).toEqual({
      fetchUrl: "https://example.com/docs",
      subjectUrl: "https://example.com/docs",
    });
  });

  it("does not let slash variants starve admitted link subjects from the exact crawl frontier", () => {
    const duplicateSubjects = Math.floor(
      CRAWL_PROJECTION_LIMITS.maxInternalOutlinks / 2,
    );
    const duplicateLinks = Array.from(
      { length: duplicateSubjects },
      (_unused, index) =>
        `<a href="/duplicate-${index}">No slash</a><a href="/duplicate-${index}/">Slash</a>`,
    ).join("");
    const remainingLinks = Array.from(
      {
        length:
          CRAWL_PROJECTION_LIMITS.maxInternalOutlinks - duplicateSubjects,
      },
      (_unused, index) =>
        `<a href="/later-${index}">Later subject</a>`,
    ).join("");

    const page = parsePage(
      `<body>${duplicateLinks}${remainingLinks}</body>`,
      BASE,
    );
    const frontierSubjects = new Set(
      page.internalFetchTargets.map((target) => target.subjectUrl),
    );

    expect(page.internalOutlinks).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxInternalOutlinks,
    );
    expect(frontierSubjects).toEqual(
      new Set(page.internalOutlinks.map((link) => link.targetSubjectUrl)),
    );
    expect(page.internalFetchTargets).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxInternalOutlinks + duplicateSubjects,
    );
  });

  it("keeps both exact variants of the final admitted subject at the projection boundary", () => {
    const earlierSubjects = Array.from(
      { length: CRAWL_PROJECTION_LIMITS.maxInternalOutlinks - 1 },
      (_unused, index) => `<a href="/page-${index}">Page ${index}</a>`,
    ).join("");
    const page = parsePage(
      `<body>${earlierSubjects}
        <a href="/last">Last without slash</a>
        <a href="/last/">Last with slash</a>
        <a href="/overflow">Must not enter bounded subjects</a>
      </body>`,
      BASE,
    );

    expect(page.internalOutlinks).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxInternalOutlinks,
    );
    expect(
      page.internalOutlinks.some(
        (link) => link.targetSubjectUrl === "https://example.com/overflow",
      ),
    ).toBe(false);
    expect(
      page.internalFetchTargets.filter(
        (target) => target.subjectUrl === "https://example.com/last",
      ),
    ).toEqual([
      {
        fetchUrl: "https://example.com/last",
        subjectUrl: "https://example.com/last",
      },
      {
        fetchUrl: "https://example.com/last/",
        subjectUrl: "https://example.com/last",
      },
    ]);
    expect(page.internalFetchTargets).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxInternalOutlinks + 1,
    );
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

/**
 * On-page facts beyond `crawl.page.v1`.
 *
 * These travel beside the frozen projection rather than inside it — that metric
 * is persisted in the product's normalized_observations and pinned by OpenAPI
 * and Zod, so widening it would be a product-side contract change for facts
 * only the public On-Page Checker reads.
 */
describe("parsePage on-page facts", () => {
  const RICH_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rich page</title>
  <meta property="og:title" content="Rich page for sharing">
  <meta property="og:description" content="What the card says.">
  <meta property="og:image" content="https://example.com/card.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico">
  <link rel="alternate" hreflang="en" href="https://example.com/">
  <link rel="alternate" hreflang="zh-CN" href="https://example.com/zh/">
</head>
<body>
  <h1>Rich page</h1>
  <p>Body copy that is long enough to measure against the markup around it.</p>
  <img src="/a.png" alt="Described">
  <img src="/b.png" alt="">
  <img src="/c.png">
  <a href="https://other.com/one" rel="nofollow">External nofollow</a>
  <a href="https://other.com/two" target="_blank">External blank unsafe</a>
  <a href="https://other.com/three" target="_blank" rel="noopener">External blank safe</a>
  <a href="/internal">Internal</a>
</body>
</html>`;

  it("reads the social and mobile meta a sharing card depends on", () => {
    const page = parsePage(RICH_HTML, BASE);

    expect(page.onPage.openGraph).toEqual({
      title: "Rich page for sharing",
      description: "What the card says.",
      image: "https://example.com/card.png",
    });
    expect(page.onPage.twitterCard).toBe("summary_large_image");
    expect(page.onPage.viewport).toBe("width=device-width, initial-scale=1");
    expect(page.onPage.charset).toBe("utf-8");
    expect(page.onPage.faviconDeclared).toBe(true);
    expect(page.onPage.hreflang).toEqual(["en", "zh-CN"]);
    expect(page.onPage.lang).toBe("en");
  });

  it("counts images by whether alt says anything", () => {
    const page = parsePage(RICH_HTML, BASE);

    // An empty alt is a decorative declaration, not a missing one. Folding the
    // two together would report a correctly-marked decorative image as a defect.
    expect(page.onPage.images).toEqual({
      total: 3,
      withAlt: 1,
      withEmptyAlt: 1,
      withoutAlt: 1,
      withDimensions: 0,
      lazyLoaded: 0,
    });
  });

  it("counts the declarations that reserve a box and defer a fetch", () => {
    const html = `<!doctype html><html><head><title>Media</title></head><body>
      <img src="/a.png" alt="a" width="800" height="600">
      <img src="/b.png" alt="b" width="800">
      <img src="/c.png" alt="c" loading="lazy">
    </body></html>`;
    const page = parsePage(html, BASE);

    // Width without height reserves nothing: the box still collapses.
    expect(page.onPage.images.withDimensions).toBe(1);
    expect(page.onPage.images.lazyLoaded).toBe(1);
  });

  it("counts external links and the ones that open unsafely", () => {
    const page = parsePage(RICH_HTML, BASE);

    expect(page.onPage.externalLinks.total).toBe(3);
    expect(page.onPage.externalLinks.nofollow).toBe(1);
    // target=_blank without noopener hands the opened page a window handle.
    expect(page.onPage.externalLinks.blankWithoutNoopener).toBe(1);
  });

  it("counts external destinations, not anchor elements", () => {
    // The same partner in the nav, the body and the footer. Counted per <a>
    // this read "3 external links" beside an internal figure that dedupes by
    // target and would have called the same thing 1.
    const html = `<!doctype html><html><body>
      <a href="https://partner.com/">Nav</a>
      <a href="https://partner.com/">Body</a>
      <a href="https://partner.com/" target="_blank">Footer</a>
    </body></html>`;
    const page = parsePage(html, BASE);

    expect(page.onPage.externalLinks.total).toBe(1);
    // One unsafe occurrence is one handle handed over, so the destination counts.
    expect(page.onPage.externalLinks.blankWithoutNoopener).toBe(1);
  });

  it("does not call a destination nofollowed when one link follows it", () => {
    const html = `<!doctype html><html><body>
      <a href="https://partner.com/" rel="nofollow">Sponsored slot</a>
      <a href="https://partner.com/">Editorial mention</a>
      <a href="https://other.com/" rel="nofollow">Only ever nofollowed</a>
    </body></html>`;
    const page = parsePage(html, BASE);

    expect(page.onPage.externalLinks.total).toBe(2);
    expect(page.onPage.externalLinks.nofollow).toBe(1);
  });

  it("classifies www and the apex the same way both collectors do", () => {
    // Deliberately NOT folded together. Treating them as one site here while
    // `collectInternalOutlinks` still requires an exact origin made the link
    // vanish from both populations at once — external skipped it as internal,
    // internal skipped it as cross-origin. Widening the internal side instead
    // would change the frozen projection the product persists.
    const html = `<!doctype html><html><body>
      <a href="https://www.example.com/pricing">Pricing</a>
      <a href="https://elsewhere.com/">Elsewhere</a>
    </body></html>`;
    const page = parsePage(html, "https://example.com/");

    expect(page.onPage.externalLinks.total).toBe(2);
    expect(page.internalOutlinks).toHaveLength(0);
  });

  it("measures bytes rather than characters", () => {
    // A page whose visible text is entirely non-ASCII: a character count would
    // report a third of the transferred size and every ratio built on it.
    const cjk = `<!doctype html><html lang="zh"><head><title>标题</title></head><body><p>${"中".repeat(100)}</p></body></html>`;
    const page = parsePage(cjk, BASE);

    expect(page.onPage.htmlBytes).toBe(new TextEncoder().encode(cjk).length);
    expect(page.onPage.visibleTextBytes).toBeGreaterThan(100);
    expect(page.onPage.visibleTextBytes).toBeLessThanOrEqual(
      page.onPage.htmlBytes,
    );
  });

  it("does not lose an attribute to a greater-than sign inside a value", () => {
    // `[^>]*` ended the tag at the first `>` in the source, and `>` is ordinary
    // text inside a value. This image was published as carrying no alt.
    const html = `<!doctype html><html><body><img src="/a.png" title="a > b" alt="Real alt"></body></html>`;
    const page = parsePage(html, BASE);

    expect(page.onPage.images.withAlt).toBe(1);
    expect(page.onPage.images.withoutAlt).toBe(0);
  });

  it("does not read markup that lives inside a script or a template", () => {
    const html = `<!doctype html><html><body>
      <p>Real copy.</p>
      <script>document.write('<img src="/ghost.png">');</script>
      <template><img src="/never-rendered.png"><a href="https://ghost.com/">x</a></template>
      <img src="/real.png" alt="Real">
    </body></html>`;
    const page = parsePage(html, BASE);

    expect(page.onPage.images.total).toBe(1);
    expect(page.onPage.externalLinks.total).toBe(0);
  });

  it("decodes alt before deciding whether it says anything", () => {
    // `alt="&nbsp;"` is a decorative declaration written the long way. Read
    // raw, it looked like a description.
    const html = `<!doctype html><html><body><img src="/a.png" alt="&nbsp;"></body></html>`;
    const page = parsePage(html, BASE);

    expect(page.onPage.images.withEmptyAlt).toBe(1);
    expect(page.onPage.images.withAlt).toBe(0);
  });

  it("accepts a twitter card declared with property=", () => {
    // Twitter's own parser accepts it, so the card works and calling it
    // missing marked the page down for a tag it has.
    const html = `<!doctype html><html><head><meta property="twitter:card" content="summary"></head><body><p>x</p></body></html>`;
    const page = parsePage(html, BASE);

    expect(page.onPage.twitterCard).toBe("summary");
  });

  it("does not honour a declared base, and says so", () => {
    // A browser resolves these against the base. This parser does not, because
    // `canonicalTarget` and `internalOutlinks` are the frozen `crawl.page.v1`
    // metric the product persists — changing what they mean under an unchanged
    // metric key would leave stored observations with no way to say which
    // meaning produced them. Pinned so the gap is a decision, not a surprise.
    const html = `<!doctype html><html><head>
      <base href="https://example.com/shop/">
      <link rel="canonical" href="hats">
    </head><body><a href="caps">Caps</a></body></html>`;
    const page = parsePage(html, "https://example.com/deep/page");

    expect(page.canonicalTarget).toBe("https://example.com/deep/hats");
    expect(page.internalOutlinks.map((link) => link.targetSubjectUrl)).toEqual([
      "https://example.com/deep/caps",
    ]);
  });

  it("counts the elements a visitor can act through", () => {
    const html = `<!doctype html><html><body>
      <form action="/search"><input type="search" name="q"><button type="submit">Go</button></form>
      <canvas id="chart"></canvas>
    </body></html>`;
    const page = parsePage(html, BASE);

    expect(page.onPage.interactive.forms).toBe(1);
    expect(page.onPage.interactive.inputs).toBe(1);
    expect(page.onPage.interactive.buttons).toBe(1);
    expect(page.onPage.interactive.canvases).toBe(1);
  });

  it("measures the whole body in units, not a sample of it", () => {
    // English opening, Chinese body: the old sample-based share read this as
    // a Latin page and published a word count wrong by two orders of magnitude.
    const html = `<!doctype html><html><body><p>An English opening sentence.</p><p>${"中".repeat(400)}</p></body></html>`;
    const page = parsePage(html, BASE);

    expect(page.onPage.textMetrics.cjkChars).toBe(400);
    expect(page.onPage.textMetrics.nonCjkWords).toBe(4);
    expect(page.onPage.textMetrics.denseChars).toBeGreaterThan(400);
    // The whitespace count the projection publishes, for contrast: five.
    expect(page.wordCount).toBe(5);
  });

  it("separates the bytes that are program from the bytes that are content", () => {
    const html = `<!doctype html><html><body><div id="root"></div><script>${"x".repeat(500)}</script></body></html>`;
    const page = parsePage(html, BASE);

    expect(page.onPage.scriptBytes).toBe(500);
    expect(page.onPage.visibleTextBytes).toBe(0);
  });

  it("reports absence as absence rather than as a default", () => {
    const bare = `<!doctype html><html><head><title>Bare</title></head><body><p>Nothing declared.</p></body></html>`;
    const page = parsePage(bare, BASE);

    expect(page.onPage.openGraph).toEqual({
      title: null,
      description: null,
      image: null,
    });
    expect(page.onPage.twitterCard).toBeNull();
    expect(page.onPage.viewport).toBeNull();
    expect(page.onPage.charset).toBeNull();
    expect(page.onPage.faviconDeclared).toBe(false);
    expect(page.onPage.hreflang).toEqual([]);
    expect(page.onPage.lang).toBeNull();
    expect(page.onPage.images.total).toBe(0);
    expect(page.onPage.externalLinks.total).toBe(0);
  });
});

describe("the render-blocking region", () => {
  const blocking = (html: string) => parsePage(html, BASE).onPage.renderBlocking;

  it("reads an explicit head", () => {
    expect(
      blocking(
        `<html><head><link rel=stylesheet href=/a.css><script src=/a.js></script></head><body>x`,
      ),
    ).toEqual({ stylesheets: 1, scripts: 1, measured: true });
  });

  it("reads a minified document that dropped its optional head tags", () => {
    // `<head>` and `</head>` are both optional in HTML5 and html-minifier's
    // removeOptionalTags strips them by default. Matching only the explicit
    // element and falling back to an empty string reported zero blocking
    // resources for a document carrying two — a detector failing toward a pass
    // on a site doing exactly the thing it looks for.
    expect(
      blocking(
        `<!doctype html><html><title>x</title><link rel=stylesheet href=/app.css><script src=/app.js></script><body>hi`,
      ),
    ).toEqual({ stylesheets: 1, scripts: 1, measured: true });
  });

  it("says it could not measure rather than reporting a zero", () => {
    // No head element and no body either: a truncated or non-HTML document.
    // Guessing where the head ended would invent a measurement.
    expect(blocking(`<p>just a fragment</p>`)).toEqual({
      stylesheets: 0,
      scripts: 0,
      measured: false,
    });
  });

  it("still ignores what does not block the first paint", () => {
    expect(
      blocking(
        `<html><head><link rel=stylesheet media=print href=/p.css><script defer src=/d.js></script><script type=module src=/m.js></script></head><body>x`,
      ),
    ).toEqual({ stylesheets: 0, scripts: 0, measured: true });
  });
});

describe("hreflang alternates", () => {
  const alternates = (html: string) => parsePage(html, BASE).onPage;

  it("keeps an alternate whose rel carries surrounding whitespace", () => {
    // `rel=" alternate"` is a valid declaration, and an untrimmed exact match
    // dropped it — toward a clean result, since a dropped alternate is one
    // fewer target that can be found broken.
    const page = alternates(
      `<html><head><link rel=" alternate" hreflang="fr" href="/fr/"></head><body>x`,
    );

    expect(page.hreflangAlternates).toEqual([
      { lang: "fr", href: "https://example.com/fr/" },
    ]);
  });

  it("carries a large international cluster without cutting it", () => {
    const links = Array.from(
      { length: 40 },
      (_, i) => `<link rel="alternate" hreflang="l${i}" href="/l${i}/">`,
    ).join("");
    const page = alternates(`<html><head>${links}</head><body>x`);

    // The list used to stop at 32, a cap borrowed from the robots projection,
    // so a forty-locale cluster with a break at position thirty-five published
    // "100% valid targets" over the first thirty-two.
    expect(page.hreflangAlternates).toHaveLength(40);
    expect(page.hreflangAlternatesTruncated).toBe(false);
  });

  it("says so when its own cap does cut the list", () => {
    const over = CRAWL_PROJECTION_LIMITS.maxHreflangAlternates + 5;
    const links = Array.from(
      { length: over },
      (_, i) => `<link rel="alternate" hreflang="l${i}" href="/l${i}/">`,
    ).join("");
    const page = alternates(`<html><head>${links}</head><body>x`);

    expect(page.hreflangAlternates).toHaveLength(
      CRAWL_PROJECTION_LIMITS.maxHreflangAlternates,
    );
    expect(page.hreflangAlternatesTruncated).toBe(true);
  });
});
