import { describe, expect, it } from "vitest";
import {
  buildCrawlSiteLanguageSummary,
  CRAWL_SITE_LANGUAGE_EVIDENCE_LIMIT,
  CRAWL_SITE_LANGUAGE_SUMMARY_VERSION,
  CRAWL_SITE_LANGUAGE_SUMMARY_VERSION_V1,
  parseCrawlSiteLanguageSnapshotSummary,
  projectableSiteLanguageTag,
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
      dominantTag: "en-US",
      tagCounts: [{ canonicalTag: "en-US", declaredPageCount: 2 }],
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
    expect(projectableSiteLanguageTag(summary)).toBe("en-US");
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

/**
 * A bilingual site is the ordinary case this projection used to lose entirely:
 * the status stays honest at `conflicting`, and the counted declarations still
 * name which language the site is mostly written in.
 */
describe("multilingual site language declarations", () => {
  function pages(tags: readonly string[]) {
    return tags.map((canonicalTag, index) => ({
      fetchUrl: `https://example.com/page-${String(index).padStart(3, "0")}`,
      declaration: { declaredTag: canonicalTag, canonicalTag },
    }));
  }

  it("reports the dominant tag and per-tag counts without claiming resolution", () => {
    const summary = buildCrawlSiteLanguageSummary(
      pages(["zh-Hans", "en", "en", "zh-Hans", "en"]),
    );

    expect(summary.status).toBe("conflicting");
    expect(summary.languageTag).toBeNull();
    expect(summary.canonicalTags).toEqual(["en", "zh-Hans"]);
    expect(summary.tagCounts).toEqual([
      { canonicalTag: "en", declaredPageCount: 3 },
      { canonicalTag: "zh-Hans", declaredPageCount: 2 },
    ]);
    expect(summary.dominantTag).toBe("en");
    expect(projectableSiteLanguageTag(summary)).toBe("en");
  });

  it("breaks a tied count deterministically but refuses to project a coin flip", () => {
    const summary = buildCrawlSiteLanguageSummary(pages(["fr", "en"]));
    const reversed = buildCrawlSiteLanguageSummary(pages(["en", "fr"]));

    expect(summary.dominantTag).toBe("en");
    expect(reversed.dominantTag).toBe("en");
    expect(summary.tagCounts).toEqual([
      { canonicalTag: "en", declaredPageCount: 1 },
      { canonicalTag: "fr", declaredPageCount: 1 },
    ]);
    expect(projectableSiteLanguageTag(summary)).toBeNull();
    expect(projectableSiteLanguageTag(reversed)).toBeNull();
  });

  it.each(["missing", "invalid"] as const)(
    "keeps %s evidence unprojectable",
    (status) => {
      const summary = buildCrawlSiteLanguageSummary(
        status === "missing"
          ? [{ fetchUrl: "https://example.com/", declaration: null }]
          : [
              {
                fetchUrl: "https://example.com/",
                declaration: { declaredTag: "en_US", canonicalTag: null },
              },
              {
                fetchUrl: "https://example.com/about",
                declaration: { declaredTag: "en", canonicalTag: "en" },
              },
            ],
      );

      expect(summary.status).toBe(status);
      expect(projectableSiteLanguageTag(summary)).toBeNull();
    },
  );
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

  it("rejects a dominant tag that contradicts its own counts", () => {
    const siteLanguage = buildCrawlSiteLanguageSummary([
      {
        fetchUrl: "https://example.com/",
        declaration: { declaredTag: "en", canonicalTag: "en" },
      },
      {
        fetchUrl: "https://example.com/fr",
        declaration: { declaredTag: "fr", canonicalTag: "fr" },
      },
      {
        fetchUrl: "https://example.com/fr/pricing",
        declaration: { declaredTag: "fr", canonicalTag: "fr" },
      },
    ]);

    expect(siteLanguage.dominantTag).toBe("fr");
    expect(parseCrawlSiteLanguageSnapshotSummary({ siteLanguage })).toEqual(
      siteLanguage,
    );
    for (const broken of [
      { ...siteLanguage, dominantTag: "en" },
      { ...siteLanguage, dominantTag: null },
      {
        ...siteLanguage,
        tagCounts: [
          { canonicalTag: "en", declaredPageCount: 1 },
          { canonicalTag: "fr", declaredPageCount: 9 },
        ],
      },
      {
        ...siteLanguage,
        tagCounts: [{ canonicalTag: "fr", declaredPageCount: 2 }],
      },
    ]) {
      expect(() =>
        parseCrawlSiteLanguageSnapshotSummary({ siteLanguage: broken }),
      ).toThrow("Crawl site-language snapshot summary is invalid.");
    }
  });

  /**
   * Frozen v1 snapshots predate the counts. They are read under their own exact
   * shape and report the counts as unknown rather than as zero, so nothing
   * downstream can mistake "we never counted" for "no page declared it".
   */
  it("reads a historical v1 summary without inventing counts for it", () => {
    const v1 = {
      schemaVersion: CRAWL_SITE_LANGUAGE_SUMMARY_VERSION_V1,
      status: "conflicting",
      languageTag: null,
      pagesAnalyzed: 2,
      declaredPageCount: 2,
      missingPageCount: 0,
      invalidDeclarationCount: 0,
      canonicalTags: ["en", "fr"],
      evidence: [
        {
          fetchUrl: "https://example.com/",
          declaredTag: "en",
          canonicalTag: "en",
        },
        {
          fetchUrl: "https://example.com/fr",
          declaredTag: "fr",
          canonicalTag: "fr",
        },
      ],
      omittedEvidenceCount: 0,
    };

    const parsed = parseCrawlSiteLanguageSnapshotSummary({ siteLanguage: v1 });
    expect(parsed).toMatchObject({
      schemaVersion: CRAWL_SITE_LANGUAGE_SUMMARY_VERSION_V1,
      status: "conflicting",
      dominantTag: null,
      tagCounts: null,
    });
    expect(projectableSiteLanguageTag(parsed!)).toBeNull();
  });

  it.each([
    [
      "a v1 summary carrying v2 members",
      {
        schemaVersion: CRAWL_SITE_LANGUAGE_SUMMARY_VERSION_V1,
        dominantTag: "en",
        tagCounts: [{ canonicalTag: "en", declaredPageCount: 1 }],
      },
    ],
    ["a v2 summary missing its counts", { tagCounts: undefined }],
    ["an unknown future version", { schemaVersion: "crawl.site-language.v9" }],
  ])("rejects %s", (_label, overrides) => {
    const siteLanguage: Record<string, unknown> = {
      ...buildCrawlSiteLanguageSummary([
        {
          fetchUrl: "https://example.com/",
          declaration: { declaredTag: "en", canonicalTag: "en" },
        },
      ]),
      ...overrides,
    };
    if (siteLanguage["tagCounts"] === undefined)
      delete siteLanguage["tagCounts"];

    expect(() =>
      parseCrawlSiteLanguageSnapshotSummary({ siteLanguage }),
    ).toThrow("Crawl site-language snapshot summary is invalid.");
  });
});
