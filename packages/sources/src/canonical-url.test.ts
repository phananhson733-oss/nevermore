import { describe, expect, it } from "vitest";
import {
  CANONICAL_URL_METHOD_VERSION,
  canonicalizeUrl,
  subjectUrlOf,
} from "./canonical-url.ts";

describe("canonicalizeUrl", () => {
  it("normalizes authority, path escapes, tracking parameters, sorting, and fragments", () => {
    expect(
      canonicalizeUrl(
        "HTTPS://ExAmPle.COM:443/a/../b/%7euser/%2f?z=2&a=3&a=1&utm_source=x&GCLID=y&FBCLID=z&msclkid=q#fragment",
      ),
    ).toEqual({
      fetchUrl: "https://example.com/b/~user/%2F?a=1&a=3&z=2",
      subjectUrl: "https://example.com/b/~user/%2F?a=1&a=3&z=2",
    });
  });

  it("keeps a non-default port and removes only the subject trailing slash", () => {
    expect(canonicalizeUrl("http://EXAMPLE.com:8080/path/?b=2&a=1")).toEqual({
      fetchUrl: "http://example.com:8080/path/?a=1&b=2",
      subjectUrl: "http://example.com:8080/path?a=1&b=2",
    });
  });

  it("resolves relative inputs and removes a query made only of tracking keys", () => {
    expect(
      canonicalizeUrl("../guide/?utm_medium=email", "https://example.com/docs/start"),
    ).toEqual({
      fetchUrl: "https://example.com/guide/",
      subjectUrl: "https://example.com/guide",
    });
  });

  it("normalizes IDNA hosts and preserves the root path", () => {
    expect(canonicalizeUrl("https://BÜCHER.example/%41?")).toEqual({
      fetchUrl: "https://xn--bcher-kva.example/A",
      subjectUrl: "https://xn--bcher-kva.example/A",
    });
  });

  it("sorts duplicate query keys deterministically in either input order", () => {
    const expected = {
      fetchUrl: "https://example.com/?a=9&b=1&b=1&b=2&z=0",
      subjectUrl: "https://example.com/?a=9&b=1&b=1&b=2&z=0",
    };

    expect(canonicalizeUrl("https://example.com/?z=0&b=2&b=1&b=1&a=9")).toEqual(
      expected,
    );
    expect(canonicalizeUrl("https://example.com/?a=9&b=1&b=1&b=2&z=0")).toEqual(
      expected,
    );
  });

  it.each(["not a URL", "mailto:test@example.com", "ftp://example.com/file"])(
    "rejects unsupported or malformed input %s",
    (rawUrl) => {
      expect(canonicalizeUrl(rawUrl)).toBeNull();
    },
  );

  it("returns just the stable subject projection", () => {
    expect(subjectUrlOf("https://example.com/path/?utm_campaign=sale&x=1")).toBe(
      "https://example.com/path?x=1",
    );
    expect(subjectUrlOf("invalid")).toBeNull();
    expect(CANONICAL_URL_METHOD_VERSION).toBe("canonical_url.v1");
  });
});
