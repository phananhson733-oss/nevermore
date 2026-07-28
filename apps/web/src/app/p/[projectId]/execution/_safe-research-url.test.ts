import { describe, expect, it } from "vitest";

import { safeResearchSourceHref } from "./_safe-research-url.ts";

describe("safeResearchSourceHref", () => {
  it.each([
    [
      "https://authority.example/report?q=seo",
      "https://authority.example/report?q=seo",
    ],
    [
      "http://legacy.example/evidence",
      "http://legacy.example/evidence",
    ],
  ])("keeps a credential-free HTTP(S) source link", (value, expected) => {
    expect(safeResearchSourceHref(value)).toBe(expected);
  });

  it.each([
    null,
    "",
    " javascript:alert(1)",
    "data:text/html,unsafe",
    "ftp://authority.example/report",
    "https://user:secret@authority.example/report",
    "https://authority.example/report\njavascript:alert(1)",
    `https://authority.example/${"x".repeat(2048)}`,
  ])("fails closed for an unsafe or malformed source link", (value) => {
    expect(safeResearchSourceHref(value)).toBeNull();
  });
});
