import { describe, expect, it } from "vitest";
import {
  classifyGrowthMapPageType,
  deriveGrowthMapUrlOpportunityRank,
  PAGE_TYPE_VERSION,
  URL_OPPORTUNITY_RANK_VERSION,
} from "./growth-map-derivations.ts";

function classify(
  normalizedUrl: string,
  projection: Record<string, unknown> | null = null,
  declaredLanguageCodes?: readonly string[],
) {
  return classifyGrowthMapPageType({
    normalizedUrl,
    projection,
    ...(declaredLanguageCodes ? { declaredLanguageCodes } : {}),
  });
}

describe("page_type.v1", () => {
  it("keeps a stable versioned identity", () => {
    expect(PAGE_TYPE_VERSION).toBe("page_type.v1");
  });

  it.each([
    { url: "https://example.test/", expected: "home" },
    { url: "https://example.test/zh/", expected: "home" },
    { url: "https://example.test/en", expected: "home" },
    { url: "https://example.test/wiki/aries-rising/", expected: "documentation" },
    // The bilingual site that motivated the fixed locale whitelist: its
    // Site.language_codes is empty, so a declared-only prefix list would have
    // dropped every /zh/ page into the unclassified bucket.
    { url: "https://example.test/zh/wiki/aries", expected: "documentation" },
    { url: "https://example.test/docs/api/auth", expected: "documentation" },
    { url: "https://example.test/blog/2026/mercury", expected: "blog" },
    { url: "https://example.test/integrations/slack", expected: "integration" },
    { url: "https://example.test/compare/notion", expected: "comparison" },
    { url: "https://example.test/templates/invoice", expected: "template" },
    { url: "https://example.test/resources/ebook", expected: "resource" },
    { url: "https://example.test/customers/acme", expected: "trust" },
    { url: "https://example.test/solutions/agencies", expected: "solution" },
    { url: "https://example.test/products/reporting", expected: "product" },
    { url: "https://example.test/pricing", expected: "commercial" },
    { url: "https://example.test/no/pricing", expected: "commercial" },
    { url: "https://example.test/notion-vs-obsidian", expected: "comparison" },
    { url: "https://example.test/customer-onboarding/", expected: null },
  ])("classifies $url as $expected", ({ url, expected }) => {
    expect(classify(url)).toBe(expected);
  });

  it("lets the outermost section win so a nested slug cannot reclassify it", () => {
    expect(classify("https://example.test/resources/blog/post")).toBe(
      "resource",
    );
    expect(classify("https://example.test/docs/pricing")).toBe("documentation");
  });

  it("never strips a real section that merely looks short", () => {
    // "vs" is two letters but is not a language subtag, so it stays a segment.
    expect(classify("https://example.test/vs/notion")).toBe("comparison");
    expect(classify("https://example.test/api/reference")).toBe(
      "documentation",
    );
  });

  it("adds the frozen declared Site languages to the stripped prefixes", () => {
    // A locale landing page only resolves to "home" once its prefix segment is
    // recognised; an undeclared, non-standard tag stays unclassified.
    const url = "https://example.test/xx/";
    expect(classify(url)).toBeNull();
    expect(classify(url, null, ["xx-YY"])).toBe("home");
    expect(classify("https://example.test/zh/")).toBe("home");
  });

  it("falls back to frozen structured data only when the path says nothing", () => {
    expect(
      classify("https://example.test/shop-item-42", {
        jsonLd: { types: ["Product"], errorCount: 0 },
      }),
    ).toBe("product");
    expect(
      classify("https://example.test/2026/05/mercury", {
        jsonLd: { types: ["https://schema.org/BlogPosting"], errorCount: 0 },
      }),
    ).toBe("blog");
    expect(
      classify("https://example.test/2026/05/mercury", {
        jsonLd: { types: ["FAQPage"], errorCount: 0 },
      }),
    ).toBe("documentation");
    // The path is authoritative: structured data cannot override /wiki/.
    expect(
      classify("https://example.test/wiki/aries", {
        jsonLd: { types: ["Product"], errorCount: 0 },
      }),
    ).toBe("documentation");
  });

  it("treats a frozen non-HTML document as a resource", () => {
    expect(
      classify("https://example.test/media/2026-report.pdf", {
        contentType: "application/pdf",
      }),
    ).toBe("resource");
  });

  it("answers null rather than guessing when nothing deterministic matched", () => {
    expect(classify("not-a-url")).toBeNull();
    expect(classify("https://example.test/customer-onboarding")).toBeNull();
    expect(
      classify("https://example.test/customer-onboarding", {
        jsonLd: { types: ["WebPage"], errorCount: 0 },
        contentType: "text/html; charset=utf-8",
      }),
    ).toBeNull();
    expect(
      classify("https://example.test/customer-onboarding", {
        jsonLd: "not-an-object",
      }),
    ).toBeNull();
  });
});

describe("url_opportunity_rank.v1", () => {
  it("keeps a stable versioned identity", () => {
    expect(URL_OPPORTUNITY_RANK_VERSION).toBe("url_opportunity_rank.v1");
  });

  it.each([
    // Rule 1: critical never moves.
    { severity: "critical", coverageCount: 1, findingCount: 1, band: "critical" },
    { severity: "critical", coverageCount: 900, findingCount: 9, band: "critical" },
    // Rule 2/3: high is promoted by blast radius or stacking.
    { severity: "high", coverageCount: 1, findingCount: 1, band: "high" },
    { severity: "high", coverageCount: 49, findingCount: 2, band: "high" },
    { severity: "high", coverageCount: 50, findingCount: 1, band: "critical" },
    { severity: "high", coverageCount: 1, findingCount: 3, band: "critical" },
    // Rule 4/5/6: the medium-only content site finally separates.
    { severity: "medium", coverageCount: 354, findingCount: 1, band: "high" },
    { severity: "medium", coverageCount: 6, findingCount: 1, band: "medium" },
    { severity: "medium", coverageCount: 1, findingCount: 3, band: "medium" },
    { severity: "medium", coverageCount: 2, findingCount: 1, band: "low" },
    { severity: "medium", coverageCount: 1, findingCount: 1, band: "low" },
    // Rule 7/8: low is only lifted by a genuinely site-wide defect.
    { severity: "low", coverageCount: 50, findingCount: 1, band: "medium" },
    { severity: "low", coverageCount: 49, findingCount: 9, band: "low" },
  ] as const)(
    "bands $severity with coverage $coverageCount and $findingCount findings as $band",
    ({ severity, coverageCount, findingCount, band }) => {
      expect(
        deriveGrowthMapUrlOpportunityRank({
          severity,
          coverageCount,
          findingCount,
        }),
      ).toBe(band);
    },
  );

  it("separates a structural defect from a single-page one at equal severity", () => {
    const structural = deriveGrowthMapUrlOpportunityRank({
      severity: "medium",
      coverageCount: 354,
      findingCount: 1,
    });
    const isolated = deriveGrowthMapUrlOpportunityRank({
      severity: "medium",
      coverageCount: 1,
      findingCount: 1,
    });
    expect(structural).toBe("high");
    expect(isolated).toBe("low");
    expect(structural).not.toBe(isolated);
  });

  it("refuses inputs that cannot describe a real Opportunity", () => {
    for (const input of [
      { severity: "medium", coverageCount: 0, findingCount: 1 },
      { severity: "medium", coverageCount: 1, findingCount: 0 },
      { severity: "medium", coverageCount: 1.5, findingCount: 1 },
      { severity: "unknown", coverageCount: 1, findingCount: 1 },
    ] as const) {
      expect(() =>
        deriveGrowthMapUrlOpportunityRank(input as never),
      ).toThrow(/inconsistent/i);
    }
  });
});
