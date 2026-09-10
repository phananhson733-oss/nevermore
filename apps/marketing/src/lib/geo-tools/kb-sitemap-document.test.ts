import { describe, expect, it } from "vitest";

import { readGeoSitemapDocument } from "./kb-sitemap-document.ts";

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

describe("readGeoSitemapDocument", () => {
  it("reads an ordinary sitemap", () => {
    expect(readGeoSitemapDocument(`<?xml version="1.0"?><urlset xmlns="${SITEMAP_NS}"><url><loc>https://example.com/</loc></url><url><loc>https://example.com/a</loc></url></urlset>`))
      .toEqual({ root: "urlset", locations: ["https://example.com/", "https://example.com/a"] });
  });

  it("reads a namespace-prefixed sitemap, which is an ordinary one", () => {
    expect(readGeoSitemapDocument(`<?xml version="1.0"?><sm:urlset xmlns:sm="${SITEMAP_NS}"><sm:url><sm:loc>https://example.com/</sm:loc></sm:url></sm:urlset>`))
      .toEqual({ root: "urlset", locations: ["https://example.com/"] });
  });

  /**
   * Google's image extension puts the address of a PICTURE inside the `<url>`
   * that shows it. A classifier that accepts any prefix on `<loc>` counts that
   * picture as another page of the site: one page plus one photo was published
   * as "your sitemap lists 2 URLs".
   */
  it("does not count an image's address as a page", () => {
    expect(readGeoSitemapDocument(`<?xml version="1.0"?><urlset xmlns="${SITEMAP_NS}" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>https://example.com/</loc><image:image><image:loc>https://example.com/photo.jpg</image:loc></image:image></url></urlset>`))
      .toEqual({ root: "urlset", locations: ["https://example.com/"] });
  });

  /** The protocol REQUIRES this escaping, so a sitemap that obeys it must read. */
  it("decodes the entities a sitemap is required to escape", () => {
    expect(readGeoSitemapDocument(`<urlset xmlns="${SITEMAP_NS}"><url><loc>https://example.com/?a=1&amp;b=2</loc></url></urlset>`).locations)
      .toEqual(["https://example.com/?a=1&b=2"]);
  });

  it("reads CDATA as the address it contains", () => {
    expect(readGeoSitemapDocument(`<urlset><url><loc><![CDATA[https://example.com/]]></loc></url></urlset>`).locations)
      .toEqual(["https://example.com/"]);
  });

  it("drops an empty location instead of resolving it against the site", () => {
    // `new URL("", target)` is the target. An empty `<loc>` used to become the
    // home page, listed and counted.
    expect(readGeoSitemapDocument(`<urlset><url><loc></loc></url><url><loc>   </loc></url></urlset>`).locations).toEqual([]);
  });

  it.each([
    ["a comment naming urlset above a real index", `<?xml version="1.0"?><!-- <urlset> --><sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>`, "sitemapindex", ["https://example.com/a.xml"]],
    ["a sitemap nested in an error document", `<error><urlset><url><loc>https://example.com/</loc></url></urlset></error>`, null, []],
    ["a sitemap quoted in a comment", `<error><!-- <urlset><url><loc>https://example.com/</loc></url></urlset> --></error>`, null, []],
    ["an element whose name merely starts with urlset", `<urlset-error><loc>https://example.com/</loc></urlset-error>`, null, []],
    ["a doctype carrying an internal subset", `<!DOCTYPE urlset [<!ELEMENT urlset ANY>]><urlset><url><loc>https://example.com/</loc></url></urlset>`, "urlset", ["https://example.com/"]],
    ["an HTML shell", `<html><body><p>Not found</p></body></html>`, null, []],
  ])("decides by the document root: %s", (_name, body, root, locations) => {
    expect(readGeoSitemapDocument(body)).toEqual({ root, locations });
  });

  /** A `<loc>` that is not owned by a `<url>` is not a page of the site. */
  it("ignores a loc outside the element that owns one", () => {
    expect(readGeoSitemapDocument(`<urlset><loc>https://example.com/stray</loc><url><loc>https://example.com/</loc></url></urlset>`).locations)
      .toEqual(["https://example.com/"]);
  });
});
