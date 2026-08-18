// @input  -- hostile URLs, doubled www, root dots, credentials, and long links
// @output -- proof one host rule and one citation-URL rule are used everywhere
// @pos    -- focused tests for the shared GEO URL normalization

import { describe, expect, it } from "vitest";

import {
  GEO_MAX_URL_LENGTH,
  geoCitationDomain,
  isGeoTargetCitation,
  isNormalizedGeoCitationUrl,
  isNormalizedGeoHost,
  normalizeGeoCitationUrl,
  normalizeGeoHost,
} from "./geo-url.ts";

describe("normalizeGeoHost", () => {
  it.each([
    ["acme.test", "acme.test"],
    ["ACME.test", "acme.test"],
    ["www.acme.test", "acme.test"],
    ["www.www.acme.test", "acme.test"],
    ["acme.test.", "acme.test"],
    ["https://www.acme.test/pricing?a=1#b", "acme.test"],
    ["http://ACME.test:8080/x", "acme.test"],
  ] as const)("reduces %s to %s", (input, expected) => {
    expect(normalizeGeoHost(input)).toBe(expected);
  });

  it.each([
    "",
    "localhost",
    "acme",
    "acme test.com",
    "acme.test/path",
    "ftp://acme.test",
    "javascript:alert(1)",
    `${"a".repeat(250)}.example.test`,
  ])("refuses %s", (input) => {
    expect(normalizeGeoHost(input)).toBeNull();
  });

  it("accepts only its own output shape", () => {
    expect(isNormalizedGeoHost("acme.test")).toBe(true);
    for (const other of ["www.acme.test", "ACME.test", "acme.test.", "", 1]) {
      expect(isNormalizedGeoHost(other)).toBe(false);
    }
  });
});

describe("normalizeGeoCitationUrl", () => {
  it("canonicalizes only the parts that preserve identity", () => {
    expect(normalizeGeoCitationUrl("HTTP://Example.COM:80/a/../b?x=1#f")).toBe(
      "http://example.com/b?x=1#f",
    );
  });

  it("keeps the query string, which is part of what was cited", () => {
    expect(
      normalizeGeoCitationUrl("https://acme.test/post?utm_source=chatgpt"),
    ).toBe("https://acme.test/post?utm_source=chatgpt");
  });

  it("keeps the fragment, which the export packet strips separately", () => {
    expect(normalizeGeoCitationUrl("https://acme.test/guide#pricing")).toBe(
      "https://acme.test/guide#pricing",
    );
  });

  it("punycodes an internationalized host", () => {
    expect(normalizeGeoCitationUrl("https://exämple.test/a")).toBe(
      "https://xn--exmple-cua.test/a",
    );
  });

  it.each([
    ["a non-string", 42],
    ["an empty string", ""],
    ["a bare host", "acme.test"],
    ["a non-http scheme", "ftp://acme.test/x"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,hi"],
    ["credentials", "https://user:pw@acme.test/x"],
    ["a username alone", "https://user@acme.test/x"],
    ["a host with no dot", "https://localhost/x"],
  ] as const)("refuses %s", (_label, input) => {
    expect(normalizeGeoCitationUrl(input)).toBeNull();
  });

  it("refuses a URL longer than the report can carry", () => {
    const long = `https://acme.test/${"a".repeat(GEO_MAX_URL_LENGTH)}`;

    expect(long.length).toBeGreaterThan(GEO_MAX_URL_LENGTH);
    expect(normalizeGeoCitationUrl(long)).toBeNull();
  });

  it("accepts only its own output shape", () => {
    expect(isNormalizedGeoCitationUrl("https://acme.test/b?x=1")).toBe(true);
    for (const other of [
      "HTTPS://ACME.test/b?x=1",
      "https://acme.test/a/../b",
      "acme.test",
      42,
    ]) {
      expect(isNormalizedGeoCitationUrl(other)).toBe(false);
    }
  });
});

describe("geoCitationDomain and ownership", () => {
  it("recomputes the domain from the URL", () => {
    expect(geoCitationDomain("https://www.acme.test/pricing")).toBe("acme.test");
  });

  it("treats www and bare host as the same site", () => {
    expect(isGeoTargetCitation("https://www.acme.test/x", "acme.test")).toBe(
      true,
    );
  });

  it("does not treat a subdomain as owned", () => {
    // `blog.acme.test` may be a hosted platform and `status.acme.test` a
    // vendor's page; counting either as the customer's own citation would
    // manufacture evidence the run does not have.
    expect(isGeoTargetCitation("https://blog.acme.test/x", "acme.test")).toBe(
      false,
    );
    expect(isGeoTargetCitation("https://acme.test.evil.test/x", "acme.test")).toBe(
      false,
    );
  });

  it("distinguishes two paths on the same host", () => {
    const first = normalizeGeoCitationUrl("https://acme.test/a");
    const second = normalizeGeoCitationUrl("https://acme.test/b");

    expect(first).not.toBe(second);
    expect(geoCitationDomain(first!)).toBe(geoCitationDomain(second!));
  });
});
