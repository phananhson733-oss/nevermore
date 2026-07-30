import { describe, expect, it } from "vitest";
import { normalizeInternalLinkAuditUrl } from "./url.ts";

describe("normalizeInternalLinkAuditUrl", () => {
  it("normalizes a public URL to an origin crawl seed", () => {
    expect(normalizeInternalLinkAuditUrl("https://Acme.com/blog/post?utm=x#section")).toEqual({ ok: true, url: "https://acme.com/" });
  });
  it.each(["localhost", "http://127.0.0.1", "http://[::1]", "https://user:pass@acme.com", "https://example.com"]) ("rejects unsafe or reserved input %s", (value) => {
    expect(normalizeInternalLinkAuditUrl(value)).toEqual({ ok: false, code: "invalid_url" });
  });
});
