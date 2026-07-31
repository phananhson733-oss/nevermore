import { describe, expect, it } from "vitest";

import { formatPropertyLabel } from "./property-label.ts";

describe("formatPropertyLabel", () => {
  it("shows a domain property as the domain", () => {
    expect(formatPropertyLabel("sc-domain:astrologywiki.com")).toBe(
      "astrologywiki.com",
    );
  });

  it("drops the scheme and trailing slash from a URL-prefix property", () => {
    expect(formatPropertyLabel("https://example.com/")).toBe("example.com");
    expect(formatPropertyLabel("http://example.com")).toBe("example.com");
  });

  it("keeps a path prefix, because it identifies a different property", () => {
    expect(formatPropertyLabel("https://example.com/blog/")).toBe(
      "example.com/blog",
    );
  });

  it("keeps a subdomain", () => {
    expect(formatPropertyLabel("https://blog.example.com/")).toBe(
      "blog.example.com",
    );
  });

  it("returns anything it does not recognise untouched", () => {
    // A label that quietly drops part of a property is worse than one that
    // looks technical.
    expect(formatPropertyLabel("something-else")).toBe("something-else");
    expect(formatPropertyLabel("sc-domain:")).toBe("sc-domain:");
    expect(formatPropertyLabel("https://[malformed")).toBe("https://[malformed");
  });
});
