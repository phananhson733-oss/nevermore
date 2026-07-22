import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./normalize.ts";

describe("normalizeUrl", () => {
  it("preserves a non-root trailing slash because it can select a different resource", () => {
    expect(
      normalizeUrl(" HTTPS://Example.COM:443/products/growth/?plan=pro ")
        ?.url.href,
    ).toBe("https://example.com/products/growth/?plan=pro");
    expect(normalizeUrl("https://example.com/products/growth")?.url.href).toBe(
      "https://example.com/products/growth",
    );
  });

  it("preserves repeated trailing path slashes instead of applying aggregation rules", () => {
    expect(normalizeUrl("https://example.com/docs///")?.url.href).toBe(
      "https://example.com/docs///",
    );
  });

  it("normalizes only default ports through the URL parser", () => {
    expect(normalizeUrl("http://example.com:80/path/")?.url.href).toBe(
      "http://example.com/path/",
    );
    expect(normalizeUrl("https://example.com:443/path/")?.url.href).toBe(
      "https://example.com/path/",
    );
    expect(normalizeUrl("https://example.com:8443/path/")?.url.href).toBe(
      "https://example.com:8443/path/",
    );
  });
});
