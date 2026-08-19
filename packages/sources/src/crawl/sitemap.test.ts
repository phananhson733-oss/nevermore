import { describe, expect, it, vi } from "vitest";
import { collectSitemap, parseSitemapXml } from "./sitemap.ts";
import { parsePage } from "./parse-page.ts";
import { canonicalizeUrl } from "../canonical-url.ts";

/**
 * A sitemap escape that survives parsing becomes a URL nothing links to, and
 * the tools then report that phantom against the site: orphan_candidate in the
 * internal-link audit, sitemap_page_without_observed_inlink in the site audit.
 * XML permits `&#38;` and `&#x26;` everywhere it permits `&amp;`, so all three
 * have to land on the same URL.
 */
describe("parseSitemapXml entity decoding", () => {
  it.each([
    ["&amp;", "https://example.com/a?x=1&amp;y=2"],
    ["decimal &#38;", "https://example.com/a?x=1&#38;y=2"],
    ["hex &#x26;", "https://example.com/a?x=1&#x26;y=2"],
    ["uppercase hex &#X26;", "https://example.com/a?x=1&#X26;y=2"],
  ])("collapses the %s form onto one URL", (_label, loc) => {
    expect(
      parseSitemapXml(`<urlset><url><loc>${loc}</loc></url></urlset>`),
    ).toEqual({
      isIndex: false,
      locs: ["https://example.com/a?x=1&y=2"],
    });
  });

  it("treats the three escapes of one URL as a single member, not three", () => {
    const document = parseSitemapXml(`<urlset>
      <url><loc>https://example.com/a?x=1&amp;y=2</loc></url>
      <url><loc>https://example.com/a?x=1&#38;y=2</loc></url>
      <url><loc>https://example.com/a?x=1&#x26;y=2</loc></url>
    </urlset>`);

    expect(document.locs).toEqual(["https://example.com/a?x=1&y=2"]);
  });

  it("decodes the remaining predefined entities", () => {
    const document = parseSitemapXml(
      `<urlset><url><loc>https://example.com/a?q=&quot;x&quot;&amp;r=&apos;y&apos;</loc></url></urlset>`,
    );

    expect(document.locs).toEqual(["https://example.com/a?q=\"x\"&r='y'"]);
  });

  it("decodes exactly once, so an escaped escape stays escaped", () => {
    // `&amp;#38;` is a document that wants the literal text "&#38;". Chained
    // replaces decode their own output and would hand back a bare "&".
    const document = parseSitemapXml(
      `<urlset><url><loc>https://example.com/a?x=&amp;#38;</loc></url></urlset>`,
    );

    expect(document.locs).toEqual(["https://example.com/a?x=&#38;"]);
  });

  it("drops a loc with a hostile numeric reference rather than inventing a URL", () => {
    // Replacing the bad reference with U+FFFD manufactured a new same-origin
    // URL, so a sitemap could mint thousands of distinct invalid suffixes and
    // spend the whole crawl budget on targets the site never had.
    const document = parseSitemapXml(
      `<urlset>
        <url><loc>https://example.com/a?x=&#xD800;</loc></url>
        <url><loc>https://example.com/b?x=&#999999999;</loc></url>
        <url><loc>https://example.com/good</loc></url>
      </urlset>`,
    );

    expect(document.locs).toEqual(["https://example.com/good"]);
  });

  it.each([
    ["C0 control &#1;", "&#1;"],
    ["noncharacter &#xFFFE;", "&#xFFFE;"],
    ["noncharacter &#xFFFF;", "&#xFFFF;"],
    ["surrogate &#xD800;", "&#xD800;"],
    ["above Unicode &#x110000;", "&#x110000;"],
  ])("drops a loc carrying the XML-invalid %s", (_label, ref) => {
    // A Unicode scalar and an XML character are different sets. C0 controls and
    // the noncharacters are valid scalars that no conforming XML document can
    // contain, so accepting them let a sitemap mint frontier entries out of
    // references it was never allowed to write.
    const document = parseSitemapXml(
      `<urlset>
        <url><loc>https://example.com/bad?x=${ref}</loc></url>
        <url><loc>https://example.com/good</loc></url>
      </urlset>`,
    );

    expect(document.locs).toEqual(["https://example.com/good"]);
  });

  it.each([
    ["tab", "&#9;"],
    ["newline", "&#10;"],
    ["carriage return", "&#13;"],
    ["space", "&#32;"],
    ["last BMP before surrogates", "&#xD7FF;"],
    ["first after surrogates", "&#xE000;"],
    ["replacement char", "&#xFFFD;"],
    ["first astral", "&#x10000;"],
    ["last valid", "&#x10FFFF;"],
  ])("keeps a loc carrying the XML-legal %s", (_label, ref) => {
    // The narrowing must not cost real sitemaps anything: every boundary of the
    // Char production still yields an entry. Not the same as round-tripping —
    // a trailing &#9;/&#10;/&#13;/&#32; is stripped by the same .trim() that
    // handles ordinary sitemap whitespace, which is why this asserts the entry
    // survives rather than that the character does.
    const document = parseSitemapXml(
      `<urlset><url><loc>https://example.com/a?x=${ref}</loc></url></urlset>`,
    );

    expect(document.locs).toHaveLength(1);
  });

  it("leaves an unknown named entity alone rather than dropping it", () => {
    // &nbsp; is an HTML entity, not an XML one. Silently turning it into a
    // space would invent a URL the document did not declare.
    const document = parseSitemapXml(
      `<urlset><url><loc>https://example.com/a?x=&nbsp;1</loc></url></urlset>`,
    );

    expect(document.locs).toEqual(["https://example.com/a?x=&nbsp;1"]);
  });
});

describe("collectSitemap with escaped member URLs", () => {
  it("admits a numeric-escaped member as the URL the site meant", async () => {
    const onMember = vi.fn();
    const projection = await collectSitemap(
      "https://example.com",
      ["https://example.com/sitemap.xml"],
      {
        fetchText: async () =>
          `<urlset><url><loc>https://example.com/p?a=1&#38;b=2</loc></url></urlset>`,
        onMember,
      },
    );

    expect(projection.subjectUrls).toEqual(["https://example.com/p?a=1&b=2"]);
    expect(onMember).toHaveBeenCalledWith({
      fetchUrl: "https://example.com/p?a=1&b=2",
      subjectUrl: "https://example.com/p?a=1&b=2",
    });
  });
});

describe("collectSitemap exact fetch identities", () => {
  it("reports exact fetch targets internally without changing the persisted projection", async () => {
    const onMember = vi.fn();
    const projection = await collectSitemap(
      "https://example.com",
      ["https://example.com/sitemap.xml"],
      {
        fetchText: async () => `<urlset>
          <url><loc>https://example.com/docs/</loc></url>
          <url><loc>https://example.com/docs</loc></url>
        </urlset>`,
        onMember,
      },
    );

    expect(projection).toEqual({
      fetched: true,
      urlCount: 1,
      subjectUrls: ["https://example.com/docs"],
      complete: true,
    });
    expect(onMember).toHaveBeenCalledTimes(2);
    expect(onMember).toHaveBeenNthCalledWith(1, {
      fetchUrl: "https://example.com/docs/",
      subjectUrl: "https://example.com/docs",
    });
    expect(onMember).toHaveBeenNthCalledWith(2, {
      fetchUrl: "https://example.com/docs",
      subjectUrl: "https://example.com/docs",
    });
  });
});

/**
 * The sitemap and the page parser have to agree on what a URL is.
 *
 * They are two entrances to the same frontier: a URL declared in the sitemap
 * and the same URL written as a link must canonicalize to one subject. When
 * they disagree, the sitemap copy looks like a page nothing links to — which
 * is exactly the false orphan_candidate this decoding work set out to remove.
 */
/**
 * The one place they deliberately disagree.
 *
 * `&nbsp;` is an HTML entity, not an XML one. The page parser resolves it
 * because a browser would; the sitemap parser leaves it verbatim rather than
 * inventing a character the document never declared. A URL containing it would
 * therefore canonicalize differently from either entrance — the exception is
 * recorded here so "the parsers agree" is never read as unconditional.
 */
describe("sitemap and page-parser decoding, known exception", () => {
  it("resolves &nbsp; on the page side and keeps it verbatim in a sitemap", () => {
    const fromSitemap = parseSitemapXml(
      `<urlset><url><loc>https://e.com/a?x=&nbsp;1</loc></url></urlset>`,
    ).locs[0];
    const fromHref = JSON.stringify(
      parsePage(
        `<html><body><a href="/a?x=&nbsp;1">x</a></body></html>`,
        "https://e.com/",
      ),
    ).match(/https:\/\/e\.com\/[^"\\]*/)?.[0];

    expect(fromSitemap).toBe("https://e.com/a?x=&nbsp;1");
    expect(fromHref).toBe("https://e.com/a?x=+1");
  });
});

describe("sitemap and page-parser decoding agree", () => {
  it.each([
    ["&apos;", "/o&apos;neill"],
    ["&amp;", "/a?x=1&amp;y=2"],
    ["&quot;", "/q?s=&quot;x&quot;"],
    ["decimal", "/a?x=1&#38;y=2"],
    ["hex", "/a?x=1&#x26;y=2"],
    // Nested escapes are where the two parsers last diverged: a chain of
    // replaces decodes its own output, so `&amp;lt;` became `<` on the href
    // side while the sitemap's single scan correctly stopped at `&lt;`. The
    // single-layer cases above all passed while this was broken, which is
    // exactly the false confidence a guard is supposed to prevent.
    ["nested &amp;lt;", "/a?x=&amp;lt;"],
    ["nested &amp;apos;", "/a?x=&amp;apos;"],
    ["nested &amp;quot;", "/a?x=&amp;quot;"],
    ["nested &amp;#x3C;", "/a?x=&amp;#x3C;"],
    ["nested &amp;#38;", "/a?x=&amp;#38;"],
    ["double-nested &amp;amp;lt;", "/a?x=&amp;amp;lt;"],
  ])(
    "resolves the %s form to one subject from either entrance",
    (_label, path) => {
      // parseSitemapXml hands back the raw loc; collectSitemap is what runs it
      // through canonicalizeUrl. Compare the canonical forms, which is what the
      // frontier and every finding are keyed on.
      const fromSitemap = canonicalizeUrl(
        parseSitemapXml(
          `<urlset><url><loc>https://e.com${path}</loc></url></urlset>`,
        ).locs[0]!,
        "https://e.com/",
      )?.subjectUrl;
      const fromHref = JSON.stringify(
        parsePage(
          `<html><body><a href="${path}">x</a></body></html>`,
          "https://e.com/",
        ),
      ).match(/https:\/\/e\.com\/[^"\\]*/)?.[0];

      expect(fromSitemap).toBeDefined();
      expect(fromHref).toBe(fromSitemap);
    },
  );
});

/**
 * The count cannot tell a small sitemap from a truncated one.
 *
 * Every early exit here removes members and leaves nothing behind in
 * `urlCount`, so a reader that infers completeness from the length is inferring
 * it from the wrong number. Index coverage divides by this list against a rail
 * that publishes a Blocker below 70%, which makes the difference between a
 * population and a sample that looks like one a published falsehood.
 */
describe("collectSitemap reports whether it degraded", () => {
  const index = (children: readonly string[]) =>
    `<sitemapindex>${children
      .map((url) => `<sitemap><loc>${url}</loc></sitemap>`)
      .join("")}</sitemapindex>`;
  const urlset = (urls: readonly string[]) =>
    `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;

  const collect = (documents: Readonly<Record<string, string | null>>) =>
    collectSitemap("https://example.com", ["https://example.com/sitemap.xml"], {
      fetchText: async (url: string) => documents[url] ?? null,
    });

  it("is complete when every referenced child answered", async () => {
    const projection = await collect({
      "https://example.com/sitemap.xml": index([
        "https://example.com/a.xml",
        "https://example.com/b.xml",
      ]),
      "https://example.com/a.xml": urlset(["https://example.com/one"]),
      "https://example.com/b.xml": urlset(["https://example.com/two"]),
    });

    expect(projection.complete).toBe(true);
    expect(projection.urlCount).toBe(2);
  });

  it("is incomplete when a child did not answer, however many siblings did", async () => {
    // The shape that published a measured 100%: nine indexed URLs in the child
    // that answered, ninety-one excluded ones in the child that timed out, and
    // a length that fits the publication cap either way.
    const projection = await collect({
      "https://example.com/sitemap.xml": index([
        "https://example.com/a.xml",
        "https://example.com/b.xml",
      ]),
      "https://example.com/a.xml": urlset(["https://example.com/one"]),
      "https://example.com/b.xml": null,
    });

    expect(projection.complete).toBe(false);
    // The members it did read are still returned; what changes is the claim
    // anyone may make about them.
    expect(projection.urlCount).toBe(1);
    expect(projection.fetched).toBe(true);
  });

  it("is incomplete when the document cap stopped the walk", async () => {
    const children = Array.from(
      { length: 60 },
      (_, i) => `https://example.com/c${i}.xml`,
    );
    const documents: Record<string, string> = {
      "https://example.com/sitemap.xml": index(children),
    };
    for (const [i, child] of children.entries()) {
      documents[child] = urlset([`https://example.com/p${i}`]);
    }

    const projection = await collect(documents);

    expect(projection.complete).toBe(false);
  });

  it("is not complete when nothing was read at all", async () => {
    // "Complete reading of nothing" is not a population either.
    const projection = await collect({});

    expect(projection.fetched).toBe(false);
    expect(projection.complete).toBe(false);
  });

  it("stays complete when an off-origin loc is skipped", async () => {
    // Skipping a URL that is not part of this site's sitemap drops nothing the
    // population contains, so it is not a degradation.
    const projection = await collect({
      "https://example.com/sitemap.xml": urlset([
        "https://example.com/one",
        "https://cdn.other.test/two",
      ]),
    });

    expect(projection.complete).toBe(true);
    expect(projection.urlCount).toBe(1);
  });
});
