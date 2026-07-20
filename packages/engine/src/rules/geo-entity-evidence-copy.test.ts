import type { CrawlPageProjection } from "@sf/sources";
import { METRIC_CRAWL_PAGE } from "@sf/sources";
import { describe, expect, it } from "vitest";
import { DiagnosticContext } from "../context.ts";
import { parseIcp } from "../icp.ts";
import { geoEntityRule } from "./geo-entity.ts";

const PAGE: CrawlPageProjection = {
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
  wordCount: 100,
  internalOutlinks: [],
  jsonLd: { types: ["Product"], errorCount: 0 },
  sitemapMember: false,
  bodyExcerpt: null,
  paragraphs: ["A straightforward product description without numeric proof."],
  responseMs: 10,
  contentType: "text/html",
};

describe("GEO-ENTITY-001 evidence copy", () => {
  it("describes complete entity coverage positively when only proof is missing", () => {
    const observedAt = "2026-07-20T00:00:00.000Z";
    const ctx = DiagnosticContext.build({
      icp: parseIcp({ siteLanguageCodes: ["en"] }),
      deliveryLocale: "en",
      observations: [
        {
          metricKey: METRIC_CRAWL_PAGE,
          subjectType: "url",
          subjectRef: "https://example.com/pricing",
          provider: "crawl",
          availability: "available",
          valueJson: PAGE,
          observedAt,
        },
      ],
      coverage: {
        crawl: "available",
        gsc: "unavailable",
        ga4: "unavailable",
        csv: "unavailable",
      },
      capturedAt: { crawl: observedAt },
    });

    const result = geoEntityRule.evaluate(ctx);
    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") return;
    const claim = result.candidates[0]?.evidence[0]?.claim;
    expect(claim).toContain("all expose at least one structured entity type");
    expect(claim).not.toContain("0 expose no structured entity types");
  });
});
