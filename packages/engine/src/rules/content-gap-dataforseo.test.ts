import {
  METRIC_CRAWL_PAGE,
  METRIC_CSV_KEYWORD_GAP,
  type CrawlPageProjection,
} from "@sf/sources";
import { describe, expect, it } from "vitest";
import {
  DiagnosticContext,
  type ObservationView,
} from "../context.ts";
import { parseIcp } from "../icp.ts";
import { contentGapRule } from "./content-gap.ts";

const OBSERVED_AT = "2026-07-20T00:00:00.000Z";

function page(): CrawlPageProjection {
  return {
    fetchUrl: "https://example.com/pricing",
    status: 200,
    finalStatus: 200,
    redirectChain: [],
    canonicalTarget: null,
    robotsIndexable: true,
    robotsDirectives: [],
    title: "Pricing",
    metaDescription: null,
    h1: ["Pricing"],
    headings: [],
    wordCount: null,
    internalOutlinks: [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: null,
    contentType: "text/html",
  };
}

describe("CONTENT-GAP-011 DataForSEO evidence", () => {
  it("keeps vendor provenance and grade B instead of presenting it as CSV", () => {
    const observations: ObservationView[] = [
      {
        metricKey: METRIC_CRAWL_PAGE,
        subjectType: "url",
        subjectRef: "https://example.com/pricing",
        provider: "crawl",
        availability: "available",
        valueJson: page(),
        observedAt: OBSERVED_AT,
      },
      ...Array.from({ length: 10 }, (_, index): ObservationView => ({
        metricKey: METRIC_CSV_KEYWORD_GAP,
        subjectType: "keyword_cluster",
        subjectRef: "project management",
        provider: "dataforseo",
        availability: "available",
        valueJson: {
          keyword: `project management workflow ${index}`,
          clusterKey: "project management",
          searchVolume: 100,
          currentUrl: "https://example.com/workflow",
          currentRank: 8 + index,
          competitorDomain: null,
          competitorRank: null,
          marketCode: "US",
          languageCode: "en",
        },
        observedAt: OBSERVED_AT,
      })),
    ];

    const ctx = DiagnosticContext.build({
      icp: parseIcp({
        productName: "Acme",
        oneLineDescription: "A collaboration workspace",
        siteLanguageCodes: ["en"],
        offers: [],
        useCases: [],
      }),
      deliveryLocale: "en",
      observations,
      coverage: {
        crawl: "available",
        gsc: "unavailable",
        ga4: "unavailable",
        csv: "available",
      },
      capturedAt: {
        crawl: OBSERVED_AT,
        dataforseo: OBSERVED_AT,
      },
    });

    const result = contentGapRule.evaluate(ctx);
    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") return;
    expect(result.candidates[0]?.evidence[0]).toMatchObject({
      sourceProvider: "dataforseo",
      origin: "vendor_observation",
      method: "observed",
      grade: "B",
      observedAt: OBSERVED_AT,
    });
    expect(result.candidates[0]?.evidence[0]?.limitation).toContain(
      "DataForSEO vendor observations",
    );
  });
});
