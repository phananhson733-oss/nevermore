import { describe, expect, it } from "vitest";
import {
  isUrlOwnedByFirstPartySite,
  normalizeFirstPartySiteOrigin,
} from "./first-party-site.ts";

describe("first-party site URL ownership", () => {
  it.each([
    ["exact hostname", "https://acme.example", "https://acme.example/pricing"],
    [
      "case and default HTTPS port",
      "HTTPS://ACME.EXAMPLE:443",
      "https://acme.example/product",
    ],
    [
      "default HTTP port",
      "http://acme.example:80",
      "http://acme.example:80/post",
    ],
    [
      "protocol change on the owned hostname",
      "http://acme.example",
      "https://acme.example/product",
    ],
    [
      "fully-qualified trailing dot",
      "https://acme.example.",
      "https://acme.example./guide",
    ],
    [
      "a dotted shared-suffix hostname exactly",
      "https://github.io",
      "https://github.io/guide",
    ],
  ])("accepts an owned %s", (_label, siteOrigin, candidateUrl) => {
    expect(isUrlOwnedByFirstPartySite(siteOrigin, candidateUrl)).toBe(true);
  });

  it.each([
    ["unverified subdomain", "https://docs.acme.example/page"],
    ["sibling", "https://beta.example/page"],
    ["lookalike prefix", "https://evilacme.example/page"],
    ["lookalike suffix", "https://acme.example.attacker.test/page"],
    ["Unicode homograph", "https://аcme.example/page"],
    ["unrelated host", "https://attacker.test/page"],
    ["userinfo before unrelated host", "https://acme.example@attacker.test/page"],
    ["userinfo before owned host", "https://attacker.test@acme.example/page"],
    ["non-HTTP protocol", "ftp://acme.example/page"],
    ["relative URL", "/page"],
  ])("rejects a %s page URL", (_label, candidateUrl) => {
    expect(
      isUrlOwnedByFirstPartySite("https://acme.example", candidateUrl),
    ).toBe(false);
  });

  it.each([
    ["a single-label suffix", "https://com", "https://evil.com/page"],
    [
      "a shared-platform child",
      "https://github.io",
      "https://victim.github.io/page",
    ],
  ])(
    "does not widen %s into first-party ownership",
    (_label, siteOrigin, candidateUrl) => {
      expect(isUrlOwnedByFirstPartySite(siteOrigin, candidateUrl)).toBe(
        false,
      );
    },
  );

  it("fails closed when the site origin itself is malformed", () => {
    expect(
      isUrlOwnedByFirstPartySite(
        "https://admin@acme.example",
        "https://acme.example/page",
      ),
    ).toBe(false);
  });
});

describe("strict first-party site-origin normalization", () => {
  it.each([
    [
      "case, padding, default port and trailing slash",
      "  HTTPS://ACME.EXAMPLE:443/  ",
      "https://acme.example",
    ],
    [
      "a non-default port",
      "http://Acme.Example:8080",
      "http://acme.example:8080",
    ],
    [
      "an exact dotted shared-suffix hostname",
      "https://github.io",
      "https://github.io",
    ],
  ])("canonicalizes %s", (_label, raw, expected) => {
    expect(normalizeFirstPartySiteOrigin(raw)).toBe(expected);
  });

  it.each([
    ["a path", "https://acme.example/path"],
    ["a query", "https://acme.example/?tenant=acme"],
    ["a fragment", "https://acme.example/#section"],
    ["a single-label public suffix", "https://com"],
    ["a single-label host", "https://localhost"],
    ["an IP literal", "https://127.0.0.1"],
  ])("rejects %s", (_label, raw) => {
    expect(normalizeFirstPartySiteOrigin(raw)).toBeNull();
  });
});
