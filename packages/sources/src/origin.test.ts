import { describe, expect, it } from "vitest";
import { normalizeSiteOrigin } from "./origin.ts";

describe("normalizeSiteOrigin", () => {
  it("normalizes an origin without changing its semantic target", () => {
    expect(normalizeSiteOrigin(" HTTPS://Example.COM:443/ ")).toEqual({
      origin: "https://example.com",
      host: "example.com",
    });
    expect(normalizeSiteOrigin("http://Example.COM:80/")).toEqual({
      origin: "http://example.com",
      host: "example.com",
    });
  });

  it("rejects non-standard ports at project-origin admission", () => {
    expect(normalizeSiteOrigin("https://example.com:8443/")).toBeNull();
    expect(normalizeSiteOrigin("http://example.com:2375/")).toBeNull();
  });

  it("rejects components an origin-only Site row would otherwise discard", () => {
    expect(normalizeSiteOrigin("https://example.com/blog")).toBeNull();
    expect(normalizeSiteOrigin("https://example.com/blog/")).toBeNull();
    expect(normalizeSiteOrigin("https://example.com/?campaign=secret")).toBeNull();
    expect(normalizeSiteOrigin("https://example.com/#section")).toBeNull();
  });
});
