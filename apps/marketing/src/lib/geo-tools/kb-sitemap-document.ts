// @input -- the bytes that answered a sitemap address
// @output -- which kind of sitemap document it is, and the addresses it lists
import * as cheerio from "cheerio";

/**
 * What a sitemap document is, and what it lists.
 *
 * Three hand-rolled classifiers preceded this one and each was wrong in its own
 * way, which is the argument for parsing rather than matching:
 *
 *  - Testing `<urlset` against the whole BODY accepted `<!-- <urlset> -->`
 *    sitting above a real `<sitemapindex>`, and filed that index's child
 *    sitemap FILES as the site's pages -- the exact defect the test was added
 *    to prevent. It also accepted a sitemap quoted inside an error document.
 *  - Requiring a bare `<urlset` rejected `<sm:urlset>`, an ordinary sitemap:
 *    the protocol's element is namespaced and a prefix is legal.
 *  - Accepting any prefix on `<loc>` then counted `<image:loc>` -- the address
 *    of a PICTURE on a page, from Google's image-sitemap extension -- as
 *    another page of the site.
 *
 * `\b` after an element name is not the end of the name either:
 * `<urlset-error>` satisfies it. And a `<!DOCTYPE urlset [ ... ]>` internal
 * subset is not skipped by a regex that stops at the first `>`.
 *
 * So: parse the document, take the ROOT element's local name, and take only
 * the `<loc>` elements whose parent is the `<url>` (or `<sitemap>`) that owns
 * them. The parser also decodes the entities the protocol requires -- a
 * location written `?a=1&amp;b=2`, which is how a sitemap must escape it,
 * previously survived as literal `&amp;` and matched no page the run had read.
 */
export interface GeoSitemapDocument {
  /** The root element's local name, or null when it is neither sitemap kind. */
  readonly root: "urlset" | "sitemapindex" | null;
  /** Non-empty `<loc>` values, in document order, entities decoded. */
  readonly locations: readonly string[];
}

/** An element's name without its namespace prefix. XML names are case-sensitive. */
function localName(name: string | undefined): string {
  const value = name ?? "";
  const colon = value.lastIndexOf(":");
  return colon === -1 ? value : value.slice(colon + 1);
}

export function readGeoSitemapDocument(body: string): GeoSitemapDocument {
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(body, { xmlMode: true });
  } catch {
    return { root: null, locations: [] };
  }
  const rootElement = $.root().children().toArray().find((node) => node.type === "tag");
  const rootName = localName(rootElement?.tagName);
  const root = rootName === "urlset" || rootName === "sitemapindex" ? rootName : null;
  if (root === null) return { root: null, locations: [] };
  // `<urlset>` owns `<url>`; `<sitemapindex>` owns `<sitemap>`. Anything else
  // holding a `<loc>` -- an image, a video, a news extension -- is describing
  // something on a page, not a page.
  const owner = root === "urlset" ? "url" : "sitemap";
  const locations: string[] = [];
  $(rootElement).find("*").each((_index, element) => {
    if (localName(element.tagName) !== "loc") return;
    const parent = element.parent;
    if (parent === null || parent.type !== "tag" || localName(parent.tagName) !== owner) return;
    const value = $(element).text().trim();
    if (value !== "") locations.push(value);
  });
  return { root, locations };
}
