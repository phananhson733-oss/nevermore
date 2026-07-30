import { describe, expect, it } from "vitest";
import {
  buildCrawlSiteLanguageSummary,
  CRAWL_SITE_LANGUAGE_EVIDENCE_LIMIT,
  CRAWL_SITE_LANGUAGE_SUMMARY_VERSION,
  parseCrawlSiteLanguageSnapshotSummary,
} from "./site-language.ts";

describe("buildCrawlSiteLanguageSummary", () => {
  it("resolves one repeated canonical declaration and preserves bounded page evidence", () => {
    const summary = buildCrawlSiteLanguageSummary([
      {
        fetchUrl: "https://example.com/",
        declaration: { declaredTag: "en-us", canonicalTag: "en-US" },
      },
      {
        fetchUrl: "https://example.com/pricing",
        declaration: { declaredTag: "en-US", canonicalTag: "en-US" },
      },
      {
        fetchUrl: "https://example.com/contact",
        declaration: null,
      },
    ]);

    expect(summary).toEqual({
      schemaVersion: CRAWL_SITE_LANGUAGE_SUMMARY_VERSION,
      status: "resolved",
      languageTag: "en-US",
      pagesAnalyzed: 3,
      declaredPageCount: 2,
      missingPageCount: 1,
      invalidDeclarationCount: 0,
      canonicalTags: ["en-US"],
      evidence: [
        {
          fetchUrl: "https://example.com/",
          declaredTag: "en-us",
          canonicalTag: "en-US",
        },
        {
          fetchUrl: "https://example.com/pricing",
          declaredTag: "en-US",
          canonicalTag: "en-US",
        },
      ],
      omittedEvidenceCount: 0,
    });
  });

  it.each([
    [
      "missing",
      [
        { fetchUrl: "https://example.com/", declaration: null },
        { fetchUrl: "https://example.com/about", declaration: null },
      ],
    ],
    [
      "invalid",
      [
        {
          fetchUrl: "https://example.com/",
          declaration: { declaredTag: "en_US", canonicalTag: null },
        },
        {
          fetchUrl: "https://example.com/about",
          declaration: { declaredTag: "en", canonicalTag: "en" },
        },
      ],
    ],
    [
      "conflicting",
      [
        {
          fetchUrl: "https://example.com/",
          declaration: { declaredTag: "en", canonicalTag: "en" },
        },
        {
          fetchUrl: "https://example.com/fr",
          declaration: { declaredTag: "fr", canonicalTag: "fr" },
        },
      ],
    ],
  ] as const)(
    "does not resolve %s site-level evidence",
    (status, evidence) => {
      const summary = buildCrawlSiteLanguageSummary(evidence);
      expect(summary.status).toBe(status);
      expect(summary.languageTag).toBeNull();
    },
  );

  it("bounds trace samples without hiding the all-page decision counts", () => {
    const evidence = Array.from(
      { length: CRAWL_SITE_LANGUAGE_EVIDENCE_LIMIT + 3 },
      (_unused, index) => ({
        fetchUrl: `https://example.com/page-${index}`,
        declaration: {
          declaredTag: "en",
          canonicalTag: "en",
        },
      }),
    );

    const summary = buildCrawlSiteLanguageSummary(evidence);
    expect(summary.pagesAnalyzed).toBe(evidence.length);
    expect(summary.declaredPageCount).toBe(evidence.length);
    expect(summary.evidence).toHaveLength(
      CRAWL_SITE_LANGUAGE_EVIDENCE_LIMIT,
    );
    expect(summary.omittedEvidenceCount).toBe(3);
  });
});

describe("parseCrawlSiteLanguageSnapshotSummary", () => {
  it("accepts the versioned siteLanguage member and rejects malformed evidence", () => {
    const siteLanguage = buildCrawlSiteLanguageSummary([
      {
        fetchUrl: "https://example.com/",
        declaration: { declaredTag: "en", canonicalTag: "en" },
      },
    ]);
    expect(
      parseCrawlSiteLanguageSnapshotSummary({ siteLanguage }),
    ).toEqual(siteLanguage);
    expect(parseCrawlSiteLanguageSnapshotSummary({})).toBeNull();
    expect(() =>
      parseCrawlSiteLanguageSnapshotSummary({
        siteLanguage: { ...siteLanguage, languageTag: "fr" },
      }),
    ).toThrow("Crawl site-language snapshot summary is invalid.");
  });

  it("rejects a resolved tag that contradicts its sampled html declaration", () => {
    const siteLanguage = buildCrawlSiteLanguageSummary([
      {
        fetchUrl: "https://example.com/",
        declaration: { declaredTag: "en", canonicalTag: "en" },
      },
    ]);

    expect(() =>
      parseCrawlSiteLanguageSnapshotSummary({
        siteLanguage: {
          ...siteLanguage,
          evidence: [
            {
              fetchUrl: "https://example.com/",
              declaredTag: "fr",
              canonicalTag: "fr",
            },
          ],
        },
      }),
    ).toThrow("Crawl site-language snapshot summary is invalid.");
  });
});
