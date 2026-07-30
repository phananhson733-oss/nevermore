import { describe, expect, it } from "vitest";
import { normalizeSeoAuditUrl } from "./url.ts";

describe("normalizeSeoAuditUrl", () => {
  it("adds https when a public hostname has no scheme", () => {
    expect(normalizeSeoAuditUrl("www.acme.com/pricing")).toEqual({
      ok: true,
      url: "https://www.acme.com/pricing",
    });
  });

  it.each([
    "",
    "file:///etc/passwd",
    "https://user:secret@acme.com",
    "http://127.0.0.1",
    "http://2130706433",
    "https://[::1]",
    "https://93.184.216.34",
    "http://metadata.google.internal/latest",
    "http://service.local",
    "http://intranet",
    "https://acme.com:8443/private",
    "https://example.com",
  ])("rejects a non-public website candidate: %s", (input) => {
    expect(normalizeSeoAuditUrl(input)).toEqual({
      ok: false,
      code: "invalid_url",
    });
  });

  it("removes fragments without rewriting the submitted path", () => {
    expect(normalizeSeoAuditUrl("https://Acme.COM/a/?q=1#section")).toEqual({
      ok: true,
      url: "https://acme.com/a/?q=1",
    });
  });
});
