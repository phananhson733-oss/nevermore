import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
} from "./security-headers.ts";

function asRecord(): Record<string, string> {
  return Object.fromEntries(
    buildSecurityHeaders().map(({ key, value }) => [key, value]),
  );
}

describe("web security headers", () => {
  it("denies framing and MIME sniffing and limits browser capabilities", () => {
    const headers = asRecord();
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=");
  });

  it("ships a production CSP without eval and with locked ancestors/base/forms", () => {
    const csp = buildContentSecurityPolicy(false, "nonce-value");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'nonce-nonce-value' 'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'nonce-nonce-value'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it("adds only the development relaxations required by the Next runtime", () => {
    const csp = buildContentSecurityPolicy(true, "nonce-value");
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("style-src 'self' 'nonce-nonce-value'");
  });

  it("rejects a nonce that could inject another CSP directive", () => {
    expect(() =>
      buildContentSecurityPolicy(false, "bad'; script-src *"),
    ).toThrow(/nonce/i);
  });
});
