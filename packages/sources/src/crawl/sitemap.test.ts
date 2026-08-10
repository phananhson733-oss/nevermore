import { describe, expect, it, vi } from "vitest";
import { collectSitemap, parseSitemapXml } from "./sitemap.ts";

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

  it("degrades a hostile numeric reference instead of throwing mid-crawl", () => {
    const document = parseSitemapXml(
      `<urlset><url><loc>https://example.com/a?x=&#xD800;&#999999999;</loc></url></urlset>`,
    );

    expect(document.locs).toEqual(["https://example.com/a?x=��"]);
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
