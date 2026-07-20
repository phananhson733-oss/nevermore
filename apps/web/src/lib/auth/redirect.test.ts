import { describe, expect, it } from "vitest";
import { safePostLoginPath } from "./redirect.ts";

const APP_ORIGIN = "https://app.example";

describe("safePostLoginPath", () => {
  it.each([
    "/",
    "/p/00000000-0000-4000-8000-000000000001/report?outputLocale=zh-CN",
    "/new-project#details",
  ])("preserves a normalized same-origin path: %s", (value) => {
    expect(safePostLoginPath(value)).toBe(value);
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example/phish",
    "/\tevil.example/phish",
    "/\nevil.example/phish",
    "/\revil.example/phish",
    "\\evil.example/phish",
    "javascript:alert(1)",
    "",
    null,
    new File([], "next.txt"),
  ])("falls back for an ambiguous or cross-origin target: %s", (value) => {
    expect(safePostLoginPath(value)).toBe("/");
  });

  it("never returns a path that WHATWG URL parsing resolves off-origin", () => {
    const malicious = [
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "//evil.example",
      "https://evil.example",
    ];

    for (const value of malicious) {
      const result = safePostLoginPath(value);
      expect(new URL(result, APP_ORIGIN).origin).toBe(APP_ORIGIN);
    }
  });

  it("rejects unbounded redirect state", () => {
    expect(safePostLoginPath(`/${"a".repeat(2_048)}`)).toBe("/");
  });
});
