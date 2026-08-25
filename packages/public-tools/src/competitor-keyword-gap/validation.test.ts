import { describe, expect, it } from "vitest";

import {
  COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS,
  parseCompetitorKeywordGapInput,
} from "./validation.ts";

describe("parseCompetitorKeywordGapInput", () => {
  it("normalizes the site and competitor domains onto one canonical provider shape", () => {
    expect(
      parseCompetitorKeywordGapInput({
        property: "  sc-domain:acme.com  ",
        siteDomain: " https://WWW.Acme.com./ ",
        competitorDomains: ["one.example", "https://www.two.example./"],
        marketCode: "us",
        languageCode: "EN",
      }),
    ).toEqual({
      ok: true,
      value: {
        property: "sc-domain:acme.com",
        siteDomain: "acme.com",
        competitorDomains: ["one.example", "two.example"],
        marketCode: "US",
        languageCode: "en",
      },
    });
  });

  it("accepts exactly five unique competitors and omits an absent optional property", () => {
    expect(
      parseCompetitorKeywordGapInput({
        siteDomain: "acme.com",
        competitorDomains: Array.from(
          { length: COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS },
          (_, index) => `c${index}.example`,
        ),
        marketCode: "US",
        languageCode: "en",
      }),
    ).toEqual({
      ok: true,
      value: {
        siteDomain: "acme.com",
        competitorDomains: [
          "c0.example",
          "c1.example",
          "c2.example",
          "c3.example",
          "c4.example",
        ],
        marketCode: "US",
        languageCode: "en",
      },
    });
  });

  it("accepts an HTTP(S) Search Console URL-prefix property and preserves it exactly after trimming", () => {
    expect(
      parseCompetitorKeywordGapInput({
        property: "  https://www.acme.com:8443/blog/  ",
        siteDomain: "acme.com",
        competitorDomains: ["one.example"],
        marketCode: "US",
        languageCode: "en",
      }),
    ).toEqual({
      ok: true,
      value: {
        property: "https://www.acme.com:8443/blog/",
        siteDomain: "acme.com",
        competitorDomains: ["one.example"],
        marketCode: "US",
        languageCode: "en",
      },
    });
  });

  it("omits an absent acceptSchemaVersion from the parsed value", () => {
    const parsed = parseCompetitorKeywordGapInput({
      siteDomain: "acme.com",
      competitorDomains: ["one.example"],
      marketCode: "US",
      languageCode: "en",
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(Object.hasOwn(parsed.value, "acceptSchemaVersion")).toBe(false);
    }
  });

  it.each([
    ["the current contract version", "competitor_keyword_gap.v3"],
    ["a 64-character version", "v".repeat(64)],
  ])(
    "carries %s through as the declared acceptSchemaVersion",
    (_label, acceptSchemaVersion) => {
      expect(
        parseCompetitorKeywordGapInput({
          siteDomain: "acme.com",
          competitorDomains: ["one.example"],
          marketCode: "US",
          languageCode: "en",
          acceptSchemaVersion,
        }),
      ).toEqual({
        ok: true,
        value: {
          siteDomain: "acme.com",
          competitorDomains: ["one.example"],
          marketCode: "US",
          languageCode: "en",
          acceptSchemaVersion,
        },
      });
    },
  );

  it.each([
    ["an empty acceptSchemaVersion", ""],
    ["a non-string acceptSchemaVersion", 123],
    ["a 65-character acceptSchemaVersion", "v".repeat(65)],
  ])("rejects %s", (_label, acceptSchemaVersion) => {
    expect(
      parseCompetitorKeywordGapInput({
        siteDomain: "acme.com",
        competitorDomains: ["one.example"],
        marketCode: "US",
        languageCode: "en",
        acceptSchemaVersion,
      }),
    ).toEqual({
      ok: false,
      code: "invalid_input",
    });
  });

  it.each([
    ["missing competitors", []],
    [
      "too many competitors",
      Array.from(
        { length: COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS + 1 },
        (_, index) => `c${index}.example`,
      ),
    ],
  ])("rejects %s", (_label, competitorDomains) => {
    expect(
      parseCompetitorKeywordGapInput({
        siteDomain: "acme.com",
        competitorDomains,
        marketCode: "US",
        languageCode: "en",
      }),
    ).toEqual({
      ok: false,
      code: "invalid_input",
    });
  });

  it("rejects duplicate and self competitors after normalization", () => {
    expect(
      parseCompetitorKeywordGapInput({
        siteDomain: "acme.com",
        competitorDomains: ["www.acme.com", "https://www.acme.com"],
        marketCode: "US",
        languageCode: "en",
      }),
    ).toEqual({
      ok: false,
      code: "invalid_input",
    });

    expect(
      parseCompetitorKeywordGapInput({
        siteDomain: "acme.com",
        competitorDomains: ["One.Example", "https://www.one.example/"],
        marketCode: "US",
        languageCode: "en",
      }),
    ).toEqual({
      ok: false,
      code: "invalid_input",
    });
  });

  it.each([
    "ftp://example.com",
    "https://user:pass@example.com",
    "https://example.com:8443",
    "https://example.com:443",
    "http://example.com:80",
    "https://example.com/path",
    "https://example.com/path?query=1",
    "https://example.com?",
    "https://example.com/#hash",
    "https://example.com#",
    "https://127.0.0.1",
    "https://[::1]",
    "localhost",
    "under_score.example",
    "-leading-hyphen.example",
    "trailing-hyphen-.example",
    "not a hostname",
  ])("rejects invalid public competitor host %s", (competitorDomain) => {
    expect(
      parseCompetitorKeywordGapInput({
        siteDomain: "acme.com",
        competitorDomains: [competitorDomain],
        marketCode: "US",
        languageCode: "en",
      }),
    ).toEqual({
      ok: false,
      code: "invalid_input",
    });
  });

  it.each([
    null,
    [],
    "acme.com",
    {},
    {
      siteDomain: 123,
      competitorDomains: ["one.example"],
      marketCode: "US",
      languageCode: "en",
    },
    {
      siteDomain: "acme.com",
      competitorDomains: "one.example",
      marketCode: "US",
      languageCode: "en",
    },
    {
      siteDomain: "acme.com",
      competitorDomains: ["one.example"],
      marketCode: "",
      languageCode: "en",
    },
    {
      siteDomain: "acme.com",
      competitorDomains: ["one.example"],
      marketCode: "US",
      languageCode: "",
    },
    {
      property: 123,
      siteDomain: "acme.com",
      competitorDomains: ["one.example"],
      marketCode: "US",
      languageCode: "en",
    },
  ])("rejects unsupported input shape %#", (input) => {
    expect(parseCompetitorKeywordGapInput(input)).toEqual({
      ok: false,
      code: "invalid_input",
    });
  });

  it.each([
    ["market containing whitespace", { marketCode: "U S" }],
    ["market with the wrong length", { marketCode: "USA" }],
    ["market containing a digit", { marketCode: "U1" }],
    ["non-ASCII market", { marketCode: "美国" }],
    ["language containing whitespace", { languageCode: "e n" }],
    ["language with the wrong length", { languageCode: "eng" }],
    ["language containing a digit", { languageCode: "e1" }],
    ["non-ASCII language", { languageCode: "中文" }],
  ])("rejects %s", (_label, overrides) => {
    expect(
      parseCompetitorKeywordGapInput({
        siteDomain: "acme.com",
        competitorDomains: ["one.example"],
        marketCode: "US",
        languageCode: "en",
        ...overrides,
      }),
    ).toEqual({ ok: false, code: "invalid_input" });
  });

  it.each([
    "javascript:alert(1)",
    "ftp://acme.com/",
    "sc-domain:",
    "sc-domain:acme.com/path",
    "sc-domain:acme.com?query=1",
    "sc-domain:acme.com#fragment",
    "sc-domain:user@acme.com",
    "sc-domain:acme.com:443",
    "sc-domain:127.0.0.1",
    "https://user:pass@acme.com/blog/",
    "https://acme.com/blog/?query=1",
    "https://acme.com/blog/#fragment",
    "https://127.0.0.1/blog/",
  ])("rejects invalid Search Console property %s", (property) => {
    expect(
      parseCompetitorKeywordGapInput({
        property,
        siteDomain: "acme.com",
        competitorDomains: ["one.example"],
        marketCode: "US",
        languageCode: "en",
      }),
    ).toEqual({ ok: false, code: "invalid_input" });
  });
});
