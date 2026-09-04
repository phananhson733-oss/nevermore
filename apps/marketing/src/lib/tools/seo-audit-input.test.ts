// @input  -- unknown JSON values at the shared SEO audit request boundary
// @output -- proof crawl tier is exact, optional, and fail-closed when present
// @pos    -- focused request-contract tests independent of either HTTP handler

import { describe, expect, it } from "vitest";
import {
  normalizeSeoAuditExtraKeyPages,
  readSeoAuditInput,
  SEO_AUDIT_EXTRA_KEY_PAGE_LIMIT,
} from "./seo-audit-input.ts";

describe("readSeoAuditInput crawl tier", () => {
  it("accepts each supported tier and preserves it exactly", () => {
    for (const tier of ["key-pages", "full-site"] as const) {
      expect(readSeoAuditInput({ url: "acme.test", tier })).toMatchObject({
        ok: true,
        value: { tier },
      });
    }
  });

  it("represents an absent tier as null for the server boundary to resolve", () => {
    expect(readSeoAuditInput({ url: "acme.test" })).toMatchObject({
      ok: true,
      value: { tier: null },
    });
  });

  it.each(["sitewide", "KEY-PAGES", "", null, 1])(
    "rejects a present unsupported tier %j",
    (tier) => {
      expect(readSeoAuditInput({ url: "acme.test", tier })).toEqual({
        ok: false,
      });
    },
  );
});

describe("readSeoAuditInput extra key pages", () => {
  it("represents an absent list as an empty list", () => {
    expect(readSeoAuditInput({ url: "acme.test" })).toMatchObject({
      ok: true,
      value: { extraKeyPages: [] },
    });
  });

  it("accepts at most ten nonblank bounded strings without normalizing early", () => {
    const extraKeyPages = Array.from(
      { length: SEO_AUDIT_EXTRA_KEY_PAGE_LIMIT },
      (_, index) => `  https://acme.test/manual-${index}  `,
    );

    expect(readSeoAuditInput({ url: "acme.test", extraKeyPages })).toMatchObject({
      ok: true,
      value: { extraKeyPages },
    });
  });

  it("rejects a list past the ten-page boundary instead of truncating it", () => {
    expect(
      readSeoAuditInput({
        url: "acme.test",
        extraKeyPages: Array.from(
          { length: SEO_AUDIT_EXTRA_KEY_PAGE_LIMIT + 1 },
          (_, index) => `https://acme.test/manual-${index}`,
        ),
      }),
    ).toEqual({ ok: false });
  });

  it.each([
    null,
    "https://acme.test/manual",
    [""],
    ["   "],
    [42],
    ["x".repeat(2_049)],
  ])("rejects malformed extra page input %j", (extraKeyPages) => {
    expect(readSeoAuditInput({ url: "acme.test", extraKeyPages })).toEqual({
      ok: false,
    });
  });
});

describe("normalizeSeoAuditExtraKeyPages", () => {
  it("normalizes, removes the submitted page, deduplicates, and ASCII sorts", () => {
    expect(
      normalizeSeoAuditExtraKeyPages("https://acme.test/main", [
        "https://acme.test/zeta#section",
        "acme.test/alpha",
        "https://ACME.test/zeta",
        "https://acme.test/main",
      ]),
    ).toEqual({
      ok: true,
      urls: ["https://acme.test/alpha", "https://acme.test/zeta"],
    });
  });

  it.each([
    [["https://other.test/page"], "cross-origin"],
    [["https://user:pass@acme.test/page"], "credentials"],
    [["javascript:alert(1)"], "invalid protocol"],
  ] as const)("rejects the whole list for a %s URL", (extraKeyPages, _case) => {
    expect(
      normalizeSeoAuditExtraKeyPages("https://acme.test/", extraKeyPages),
    ).toEqual({ ok: false });
  });
});
