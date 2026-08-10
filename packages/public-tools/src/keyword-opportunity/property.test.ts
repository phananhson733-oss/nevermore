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

  it("prefers a domain property over a URL-prefix one for the same site", () => {
    // A domain property is a strict superset — both schemes, every subdomain —
    // so it yields the fuller query sample for the same read.
    expect(
      keywordCoverageProperty("https://acme.com/", [
        "https://acme.com/",
        "sc-domain:acme.com",
      ]),
    ).toBe("sc-domain:acme.com");
  });

  it("falls back to a URL-prefix property when no domain property covers the site", () => {
    expect(
      keywordCoverageProperty("https://acme.com/blog/post", [
        "https://acme.com/blog/",
      ]),
    ).toBe("https://acme.com/blog/");
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

  it("compares hosts case-insensitively", () => {
    expect(
      keywordCoverageProperty("https://ACME.com/", ["sc-domain:acme.com"]),
    ).toBe("sc-domain:acme.com");
  });
});
