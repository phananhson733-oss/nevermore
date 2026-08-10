import { describe, expect, it } from "vitest";

import { keywordCoverageProperty } from "./property.ts";

describe("keywordCoverageProperty", () => {
  it("matches a domain property to the site it covers", () => {
    // The shipped bug: the site URL went to Search Console unchanged, so every
    // read was refused and the coverage stage went silently unavailable on
    // every run. Search Console is addressed by property, never by site URL.
    expect(
      keywordCoverageProperty("https://acme.com", ["sc-domain:acme.com"]),
    ).toBe("sc-domain:acme.com");
  });

  it("treats a domain property as covering its subdomains", () => {
    // That is what a domain property means in Search Console: every host under
    // it, on either scheme. A visitor who verified the apex should not be told
    // their blog is unreadable.
    expect(
      keywordCoverageProperty("https://blog.acme.com/posts", [
        "sc-domain:acme.com",
      ]),
    ).toBe("sc-domain:acme.com");
  });

  it("does not let a domain property claim a site that merely ends with it", () => {
    // `notacme.com` ends with `acme.com` as a string and is a different
    // registrable domain. Matching it would read one visitor's site against
    // another's property.
    expect(
      keywordCoverageProperty("https://notacme.com", ["sc-domain:acme.com"]),
    ).toBeNull();
  });

  it("prefers the most specific domain property when several cover the site", () => {
    // The subdomain's own property holds exactly this site's traffic; the
    // apex mixes in every other host and would report coverage the reader
    // cannot act on.
    expect(
      keywordCoverageProperty("https://blog.acme.com/", [
        "sc-domain:acme.com",
        "sc-domain:blog.acme.com",
      ]),
    ).toBe("sc-domain:blog.acme.com");
  });

  it("prefers a URL-prefix property over a domain one covering the same site", () => {
    // The coverage read asks for queries with no page filter, so the property
    // named decides the scope of the answer. A domain property also carries
    // http and every subdomain, and a query another scope served would come
    // back looking like this site already serves it — which does not mislabel
    // the row, it deletes it. Narrow beats broad.
    expect(
      keywordCoverageProperty("https://acme.com/", [
        "sc-domain:acme.com",
        "https://acme.com/",
      ]),
    ).toBe("https://acme.com/");
  });

  it("does not answer a subdomain question out of the parent domain's property when a narrower one exists", () => {
    expect(
      keywordCoverageProperty("https://blog.acme.com/", [
        "sc-domain:acme.com",
        "https://blog.acme.com/",
      ]),
    ).toBe("https://blog.acme.com/");
  });

  it("keeps path comparison case-sensitive while the host stays case-insensitive", () => {
    // Paths are case-sensitive per the URL standard: `/Blog/` is a different
    // resource from `/blog/`, and its queries are not in that property.
    expect(
      keywordCoverageProperty("https://acme.com/Blog/post", [
        "https://acme.com/blog/",
      ]),
    ).toBeNull();
    expect(
      keywordCoverageProperty("https://ACME.com/blog/post", [
        "https://acme.com/blog/",
      ]),
    ).toBe("https://acme.com/blog/");
  });

  it("falls back to a URL-prefix property when no domain property covers the site", () => {
    expect(
      keywordCoverageProperty("https://acme.com/blog/post", [
        "https://acme.com/blog/",
      ]),
    ).toBe("https://acme.com/blog/");
  });

  it("prefers the property that is the site over one that starts beneath it", () => {
    // `/blog/` and `/blog` are both granted and both cover a request about
    // `/blog`, but the longer one's scope begins below the URL asked about —
    // reading it would answer with the descendants' queries. Longest-path
    // alone picks exactly the wrong one.
    expect(
      keywordCoverageProperty("https://acme.com/blog", [
        "https://acme.com/blog/",
        "https://acme.com/blog",
      ]),
    ).toBe("https://acme.com/blog");
  });

  it("refuses a URL-prefix property carrying credentials, a query or a fragment", () => {
    // Not something Search Console issues, and the string is handed back
    // verbatim — so accepting one lets a malformed narrow entry beat a valid
    // domain property and turn a working read into a failed one.
    for (const property of [
      "https://user:pass@acme.com/",
      "https://acme.com/?utm=1",
      "https://acme.com/#top",
    ]) {
      expect(
        keywordCoverageProperty("https://acme.com/", [
          property,
          "sc-domain:acme.com",
        ]),
        property,
      ).toBe("sc-domain:acme.com");
    }
  });

  it("picks the longest URL prefix that still contains the site", () => {
    expect(
      keywordCoverageProperty("https://acme.com/blog/post", [
        "https://acme.com/",
        "https://acme.com/blog/",
      ]),
    ).toBe("https://acme.com/blog/");
  });

  it("does not let a URL prefix claim a sibling path that shares its opening", () => {
    // `/blog` must not match `/blogging`: the comparison is on a path segment
    // boundary, not on raw string prefixes.
    expect(
      keywordCoverageProperty("https://acme.com/blogging/x", [
        "https://acme.com/blog",
      ]),
    ).toBeNull();
  });

  it("keeps URL-prefix properties scheme-sensitive", () => {
    // Search Console verifies http and https separately, and the http
    // property holds none of the https traffic.
    expect(
      keywordCoverageProperty("https://acme.com/", ["http://acme.com/"]),
    ).toBeNull();
  });

  it("keeps a URL-prefix match when the site URL carries a root-label dot", () => {
    // The parser strips a trailing dot from a bare domain but leaves it on a
    // URL's host. Without normalizing both, this site would lose its exact
    // prefix match and fall through to the broader domain property — the
    // direction that over-reports coverage and deletes rows.
    expect(
      keywordCoverageProperty("https://acme.com./blog/post", [
        "sc-domain:acme.com",
        "https://acme.com/blog/",
      ]),
    ).toBe("https://acme.com/blog/");
  });

  it("does not let a URL-prefix property claim a site on another port", () => {
    // A URL-prefix property is bound to its origin, port included.
    expect(
      keywordCoverageProperty("https://acme.com:8443/", ["https://acme.com/"]),
    ).toBeNull();
  });

  it("still matches a domain property regardless of the site's port", () => {
    // A domain property covers the host, and a port is not part of a host.
    expect(
      keywordCoverageProperty("https://acme.com:8443/", ["sc-domain:acme.com"]),
    ).toBe("sc-domain:acme.com");
  });

  it("returns null when the grant covers no property for the site", () => {
    // Also the ownership check: without a match there is no property whose
    // queries we are entitled to read, and the caller must report the stage as
    // unread rather than substitute an empty result.
    expect(
      keywordCoverageProperty("https://acme.com", [
        "sc-domain:other.com",
        "https://different.example/",
      ]),
    ).toBeNull();
  });

  it("returns null for a grant that covers nothing at all", () => {
    expect(keywordCoverageProperty("https://acme.com", [])).toBeNull();
  });

  it("refuses a site URL it cannot parse rather than guessing a host", () => {
    expect(
      keywordCoverageProperty("acme.com", ["sc-domain:acme.com"]),
    ).toBeNull();
  });

  it("ignores a property entry that is neither a domain property nor a URL", () => {
    // Google returns what it returns; a shape we do not recognise must not
    // become a match by accident.
    expect(
      keywordCoverageProperty("https://acme.com", ["acme.com", "sc-domain:"]),
    ).toBeNull();
  });

  it("matches an internationalized domain in either encoding", () => {
    // Search Console answers in punycode. A literal comparison would miss
    // every non-ASCII domain and tell the visitor the stage went unread for a
    // property they plainly hold.
    expect(
      keywordCoverageProperty("https://例え.jp/", ["sc-domain:例え.jp"]),
    ).toBe("sc-domain:例え.jp");
    expect(
      keywordCoverageProperty("https://例え.jp/", ["sc-domain:xn--r8jz45g.jp"]),
    ).toBe("sc-domain:xn--r8jz45g.jp");
  });

  it("refuses a domain property carrying anything but a host", () => {
    // The URL parser would silently drop the path, port or credentials and
    // hand back a host that matches — turning a malformed entry into a match.
    for (const property of [
      "sc-domain:acme.com/blog",
      "sc-domain:acme.com:8443",
      "sc-domain:user@acme.com",
      // The parser treats a backslash as a path separator and trims
      // surrounding whitespace, so both would otherwise reduce to `acme.com`
      // and match.
      "sc-domain:acme.com\\evil",
      "sc-domain:acme.com ",
    ]) {
      expect(
        keywordCoverageProperty("https://acme.com/", [property]),
        property,
      ).toBeNull();
    }
  });

  it("compares hosts case-insensitively", () => {
    expect(
      keywordCoverageProperty("https://ACME.com/", ["sc-domain:acme.com"]),
    ).toBe("sc-domain:acme.com");
  });
});
