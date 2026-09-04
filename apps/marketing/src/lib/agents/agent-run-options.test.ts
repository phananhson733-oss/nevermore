// @input  -- crawl-tier choices, a Profile target URL, and manual URL text/objects
// @output -- proof run options stay bounded, same-origin, deterministic, and Agent-specific
// @pos    -- client-safe contract test shared by the Profile UI and auth-resume guard

import { describe, expect, it } from "vitest";

import {
  AGENT_RUN_EXTRA_KEY_PAGE_LIMIT,
  defaultAgentRunOptions,
  normalizeAgentRunTargetUrl,
  normalizeStoredAgentRunOptions,
  parseAgentExtraKeyPages,
} from "./agent-run-options.ts";

describe("Agent run option defaults", () => {
  it("defaults SEO to key pages and Tech to an unextended full-site run", () => {
    expect(defaultAgentRunOptions("seo")).toEqual({
      tier: "key-pages",
      extraKeyPages: [],
    });
    expect(defaultAgentRunOptions("tech")).toEqual({
      tier: "full-site",
      extraKeyPages: [],
    });
  });
});

describe("normalizeAgentRunTargetUrl", () => {
  it("turns a bare host into one canonical absolute HTTPS page", () => {
    expect(normalizeAgentRunTargetUrl(" astrologywiki.com ")).toBe(
      "https://astrologywiki.com/",
    );
  });

  it("normalizes an absolute page and removes its fragment", () => {
    expect(
      normalizeAgentRunTargetUrl(
        "HTTPS://ASTROLOGYWIKI.COM/path?q=1#section",
      ),
    ).toBe("https://astrologywiki.com/path?q=1");
  });

  it.each([
    "https://user:pass@astrologywiki.com/",
    "https://@astrologywiki.com/",
    "@astrologywiki.com",
    "ftp://astrologywiki.com/",
  ])("rejects an unsafe target %s", (value) => {
    expect(normalizeAgentRunTargetUrl(value)).toBeNull();
  });
});

describe("parseAgentExtraKeyPages", () => {
  it("trims lines, drops blanks and the main page, then canonicalizes, deduplicates, and ASCII sorts", () => {
    expect(
      parseAgentExtraKeyPages(
        "acme.test/main",
        [
          "  https://acme.test/zeta  ",
          "",
          "https://ACME.test/alpha",
          "https://acme.test/zeta",
          "https://acme.test/main",
        ].join("\n"),
      ),
    ).toEqual({
      ok: true,
      extraKeyPages: [
        "https://acme.test/alpha",
        "https://acme.test/zeta",
      ],
    });
  });

  it("rejects more than ten nonblank lines instead of truncating them", () => {
    expect(
      parseAgentExtraKeyPages(
        "https://acme.test/",
        Array.from(
          { length: AGENT_RUN_EXTRA_KEY_PAGE_LIMIT + 1 },
          (_, index) => `https://acme.test/manual-${index}`,
        ).join("\n"),
      ),
    ).toEqual({ ok: false, error: "too_many" });
  });

  it.each([
    ["acme.test/path", "relative URL"],
    ["ftp://acme.test/path", "non-HTTP protocol"],
    ["https://user:pass@acme.test/path", "credentials"],
    ["https://@acme.test/path", "empty credentials component"],
    ["https://acme.test/path#fragment", "fragment"],
    ["https://acme.test/path#", "empty fragment component"],
    [`https://acme.test/${"x".repeat(2_049)}`, "over-length URL"],
  ])("rejects a %s as invalid", (value, _case) => {
    expect(parseAgentExtraKeyPages("https://acme.test/", value)).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("distinguishes a valid cross-origin URL from malformed input", () => {
    expect(
      parseAgentExtraKeyPages(
        "https://acme.test/",
        "https://other.test/manual",
      ),
    ).toEqual({ ok: false, error: "cross_origin" });
  });

  it.each([
    [
      "apex to www",
      "https://www.acme.test/main",
      "https://acme.test/manual?q=1",
      "https://www.acme.test/manual?q=1",
    ],
    [
      "www to apex",
      "https://acme.test/main",
      "https://www.acme.test/manual?q=1",
      "https://acme.test/manual?q=1",
    ],
    [
      "HTTP to HTTPS input",
      "http://acme.test/main",
      "https://www.acme.test/manual?q=1",
      "http://acme.test/manual?q=1",
    ],
  ])(
    "accepts a safe %s site variant and rebases it to the target origin",
    (_label, targetUrl, manualUrl, expectedUrl) => {
      expect(parseAgentExtraKeyPages(targetUrl, manualUrl)).toEqual({
        ok: true,
        extraKeyPages: [expectedUrl],
      });
    },
  );

  it("rejects an HTTPS downgrade even for the same host", () => {
    expect(
      parseAgentExtraKeyPages(
        "https://acme.test/",
        "http://www.acme.test/manual",
      ),
    ).toEqual({ ok: false, error: "cross_origin" });
  });
});

describe("normalizeStoredAgentRunOptions", () => {
  it("accepts a safe SEO snapshot and preserves its deterministic manual set", () => {
    expect(
      normalizeStoredAgentRunOptions("seo", "https://acme.test/", {
        tier: "full-site",
        extraKeyPages: [
          "https://acme.test/alpha",
          "https://acme.test/zeta",
        ],
      }),
    ).toEqual({
      tier: "full-site",
      extraKeyPages: [
        "https://acme.test/alpha",
        "https://acme.test/zeta",
      ],
    });
  });

  it.each([
    [{ tier: "wide", extraKeyPages: [] }, "unknown tier"],
    [{ tier: "key-pages", extraKeyPages: ["https://other.test/"] }, "cross origin"],
    [
      {
        tier: "key-pages",
        extraKeyPages: [
          "https://acme.test/a",
          "https://acme.test/a",
        ],
      },
      "duplicate",
    ],
    [
      {
        tier: "key-pages",
        extraKeyPages: Array.from(
          { length: AGENT_RUN_EXTRA_KEY_PAGE_LIMIT + 1 },
          (_, index) => `https://acme.test/${index}`,
        ),
      },
      "too many",
    ],
    [
      { tier: "full-site", extraKeyPages: ["https://acme.test/a"] },
      "Tech manual page",
    ],
    [{ tier: "key-pages", extraKeyPages: [] }, "Tech shallow tier"],
  ])("fails closed on a malformed stored snapshot: %s", (value, _case) => {
    const agent = String(_case).startsWith("Tech") ? "tech" : "seo";
    expect(
      normalizeStoredAgentRunOptions(agent, "https://acme.test/", value),
    ).toBeNull();
  });
});
