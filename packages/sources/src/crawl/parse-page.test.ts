import { describe, expect, it } from "vitest";
import { directivesIndexable, parsePage } from "./parse-page.ts";

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
});

describe("directivesIndexable", () => {
  it("treats noindex or none as not indexable", () => {
    expect(directivesIndexable([])).toBe(true);
    expect(directivesIndexable(["index", "follow"])).toBe(true);
    expect(directivesIndexable(["noindex"])).toBe(false);
    expect(directivesIndexable(["none"])).toBe(false);
  });
});
