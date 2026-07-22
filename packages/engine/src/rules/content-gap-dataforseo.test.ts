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

  it("uses the selected cluster provider snapshot availability instead of merged keyword-gap coverage", () => {
    const crawl: ObservationView = {
      metricKey: METRIC_CRAWL_PAGE,
      subjectType: "url",
      subjectRef: "https://example.com/pricing",
      provider: "crawl",
      availability: "available",
      valueJson: page(),
      observedAt: OBSERVED_AT,
    };
    const keywordRows = (
      provider: "csv" | "dataforseo",
    ): ObservationView[] =>
      Array.from({ length: 10 }, (_, index): ObservationView => ({
        metricKey: METRIC_CSV_KEYWORD_GAP,
        subjectType: "keyword_cluster",
        subjectRef: "project management",
        provider,
        availability: "available",
        valueJson: {
          keyword: `project management workflow ${index}`,
          clusterKey: "project management",
          searchVolume: provider === "dataforseo" ? 100 : 900,
          currentUrl:
            provider === "dataforseo"
              ? "https://example.com/workflow"
              : null,
          currentRank: provider === "dataforseo" ? 8 + index : null,
          competitorDomain:
            provider === "csv" ? "competitor.example" : null,
          competitorRank: provider === "csv" ? 4 + index : null,
          marketCode: "US",
          languageCode: "en",
        },
        observedAt: OBSERVED_AT,
      }));
    const csvObservedAt = "2026-07-20T01:00:00.000Z";
    const dataForSeoObservedAt = "2026-07-20T02:00:00.000Z";

    const cases = [
      {
        observations: [
          crawl,
          ...keywordRows("csv"),
          ...keywordRows("dataforseo"),
        ],
        availabilityByProvider: {
          csv: "available",
          dataforseo: "partial",
        },
        provider: "dataforseo",
        availability: "partial",
        observedAt: dataForSeoObservedAt,
      },
      {
        observations: [
          crawl,
          ...keywordRows("dataforseo"),
          ...keywordRows("csv"),
        ],
        availabilityByProvider: {
          csv: "partial",
          dataforseo: "available",
        },
        provider: "dataforseo",
        availability: "available",
        observedAt: dataForSeoObservedAt,
      },
      {
        observations: [crawl, ...keywordRows("csv")],
        availabilityByProvider: {
          csv: "partial",
          dataforseo: "available",
        },
        provider: "csv",
        availability: "partial",
        observedAt: csvObservedAt,
      },
    ] as const;

    for (const fixture of cases) {
      const ctx = DiagnosticContext.build({
        icp: parseIcp({
          productName: "Acme",
          oneLineDescription: "A collaboration workspace",
          siteLanguageCodes: ["en"],
          offers: [],
          useCases: [],
        }),
        deliveryLocale: "en",
        observations: fixture.observations,
        coverage: {
          crawl: "available",
          gsc: "unavailable",
          ga4: "unavailable",
          // The logical keyword-gap dataset remains available because at least
          // one frozen provider snapshot is complete in every fixture.
          csv: "available",
        },
        availabilityByProvider: fixture.availabilityByProvider,
        capturedAt: {
          crawl: OBSERVED_AT,
          csv: csvObservedAt,
          dataforseo: dataForSeoObservedAt,
        },
      });

      const result = contentGapRule.evaluate(ctx);
      expect(result.status).toBe("candidate");
      if (result.status !== "candidate") continue;
      const evidence = result.candidates[0]?.evidence[0];
      expect(evidence).toMatchObject({
        sourceProvider: fixture.provider,
        availability: fixture.availability,
        observedAt: fixture.observedAt,
      });
      expect(
        result.candidates[0]?.evidence.map(
          (candidateEvidence) => candidateEvidence.sourceProvider,
        ),
      ).toEqual([fixture.provider, "crawl"]);
      expect(evidence?.limitation).toContain(
        fixture.provider === "dataforseo"
          ? "DataForSEO vendor observations"
          : "user-provided CSV data",
      );
      if (fixture.availability === "partial") {
        expect(evidence?.limitation).toContain("snapshot is partial");
      } else {
        expect(evidence?.limitation).not.toContain("snapshot is partial");
      }
    }
  });

  it("deduplicates true provider overlap without dropping market or language demand", () => {
    const crawl: ObservationView = {
      metricKey: METRIC_CRAWL_PAGE,
      subjectType: "url",
      subjectRef: "https://example.com/pricing",
      provider: "crawl",
      availability: "available",
      valueJson: page(),
      observedAt: OBSERVED_AT,
    };
    const csv = Array.from({ length: 10 }, (_, index): ObservationView => ({
      metricKey: METRIC_CSV_KEYWORD_GAP,
      subjectType: "keyword_cluster",
      subjectRef: "project management",
      provider: "csv",
      availability: "available",
      valueJson: {
        keyword: ` Project   Management Workflow ${index} `,
        clusterKey: "project management",
        searchVolume: 900,
        currentUrl: null,
        currentRank: null,
        competitorDomain: "competitor.example",
        competitorRank: 4 + index,
        marketCode: "US",
        languageCode: "en",
      },
      observedAt: OBSERVED_AT,
    })).concat(
      {
        metricKey: METRIC_CSV_KEYWORD_GAP,
        subjectType: "keyword_cluster",
        subjectRef: "project management",
        provider: "csv",
        availability: "available",
        valueJson: {
          keyword: "project portfolio planning",
          clusterKey: "project management",
          searchVolume: 50,
          currentUrl: null,
          currentRank: null,
          competitorDomain: "competitor.example",
          competitorRank: 7,
          marketCode: "US",
          languageCode: "en",
        },
        observedAt: OBSERVED_AT,
      },
      {
        metricKey: METRIC_CSV_KEYWORD_GAP,
        subjectType: "keyword_cluster",
        subjectRef: "project management",
        provider: "csv",
        availability: "available",
        valueJson: {
          keyword: "project management workflow 0",
          clusterKey: "project management",
          searchVolume: 300,
          currentUrl: null,
          currentRank: null,
          competitorDomain: "competitor.example",
          competitorRank: 4,
          marketCode: "GB",
          languageCode: "en-GB",
        },
        observedAt: OBSERVED_AT,
      },
      {
        metricKey: METRIC_CSV_KEYWORD_GAP,
        subjectType: "keyword_cluster",
        subjectRef: "project management",
        provider: "csv",
        availability: "available",
        valueJson: {
          keyword: "project management workflow 0",
          clusterKey: "project management",
          searchVolume: 200,
          currentUrl: null,
          currentRank: null,
          competitorDomain: "competitor.example",
          competitorRank: 4,
          marketCode: "US",
          languageCode: "fr",
        },
        observedAt: OBSERVED_AT,
      },
    );
    const dataForSeo = Array.from(
      { length: 10 },
      (_, index): ObservationView => ({
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
      }),
    );

    const evaluate = (observations: readonly ObservationView[]) => {
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
          csv: OBSERVED_AT,
          dataforseo: OBSERVED_AT,
        },
      });
      expect(ctx.keywordGapProviders.get("project management")).toEqual(
        new Set(["csv", "dataforseo"]),
      );
      return contentGapRule.evaluate(ctx);
    };

    for (const observations of [
      [crawl, ...csv, ...dataForSeo],
      [crawl, ...dataForSeo, ...csv],
    ]) {
      const result = evaluate(observations);
      expect(result.status).toBe("candidate");
      if (result.status !== "candidate") continue;
      expect(result.candidates[0]?.metrics).toEqual({
        clusterKey: "project management",
        keywordCount: 13,
        totalVolume: 1_550,
      });
      const dataForSeoEvidence = result.candidates[0]?.evidence.find(
        (evidence) => evidence.sourceProvider === "dataforseo",
      );
      const csvEvidence = result.candidates[0]?.evidence.find(
        (evidence) => evidence.sourceProvider === "csv",
      );
      expect(dataForSeoEvidence).toMatchObject({
        sourceProvider: "dataforseo",
        origin: "vendor_observation",
        grade: "B",
      });
      expect(dataForSeoEvidence?.claim).toContain(
        "contributes 10 keywords with 1000 combined available monthly search volume",
      );
      expect(dataForSeoEvidence?.claim).not.toContain("13 keywords");
      expect(dataForSeoEvidence?.claim).not.toContain("1550");
      expect(csvEvidence).toMatchObject({
        sourceProvider: "csv",
        origin: "user_provided",
        grade: "C",
      });
      expect(csvEvidence?.claim).toContain(
        "contributes 3 keywords with 550 combined available monthly search volume",
      );
      expect(csvEvidence?.claim).not.toContain("13 keywords");
      expect(csvEvidence?.claim).not.toContain("1550");
      expect(
        result.candidates[0]?.evidence.map(
          (evidence) => evidence.sourceProvider,
        ),
      ).toEqual(["dataforseo", "csv", "crawl"]);
    }
  });

  it("does not turn an unreported provider volume into an observed zero", () => {
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
      {
        metricKey: METRIC_CSV_KEYWORD_GAP,
        subjectType: "keyword_cluster",
        subjectRef: "project management",
        provider: "csv",
        availability: "available",
        valueJson: {
          keyword: "project portfolio planning",
          clusterKey: "project management",
          searchVolume: null,
          currentUrl: null,
          currentRank: null,
          competitorDomain: "competitor.example",
          competitorRank: 7,
          marketCode: "US",
          languageCode: "en",
        },
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
        siteLanguageCodes: ["en"],
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
        csv: OBSERVED_AT,
        dataforseo: OBSERVED_AT,
      },
    });

    const result = contentGapRule.evaluate(ctx);
    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") return;
    expect(result.candidates[0]?.metrics).toEqual({
      clusterKey: "project management",
      keywordCount: 11,
      totalVolume: 1_000,
    });
    const csvEvidence = result.candidates[0]?.evidence.find(
      (evidence) => evidence.sourceProvider === "csv",
    );
    expect(csvEvidence?.claim).toContain("contributes 1 keyword;");
    expect(csvEvidence?.claim).toContain(
      "none of those retained source rows reports monthly search volume",
    );
    expect(csvEvidence?.claim).not.toContain("volume 0");
  });
});
