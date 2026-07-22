import { METRIC_CRAWL_PAGE, METRIC_CSV_KEYWORD_GAP, type CrawlPageProjection } from "@sf/sources";
import { describe, expect, it } from "vitest";
import {
  DiagnosticContext,
  type CoverageInput,
  type ObservationView,
} from "../context.ts";
import { parseIcp, type EngineIcp } from "../icp.ts";
import { runPipeline } from "../pipeline.ts";
import { contentGapRule } from "./content-gap.ts";

const OBSERVED_AT = "2026-07-18T00:00:00.000Z";

/** A qualifying cluster: 10 keywords, 1400 combined volume, top = first keyword. */
const QUALIFYING_CLUSTER: readonly (readonly [string, number | null])[] = [
  ["project management software", 500],
  ["project management tool", 100],
  ["project management app", 100],
  ["project tracking", 100],
  ["task management", 100],
  ["team planning", 100],
  ["gantt chart tool", 100],
  ["kanban board", 100],
  ["sprint planning", 100],
  ["work management", 100],
];
const DIVERGENT_CLUSTER: readonly (readonly [string, number])[] = [
  ["cheap seo tool", 1_000],
  ...Array.from({ length: 9 }, (_, index) => [
    `enterprise platform variant ${index}`,
    100,
  ] as const),
];

function icpOf(overrides: Record<string, unknown>): EngineIcp {
  return parseIcp({
    productName: "Acme",
    oneLineDescription: "A collaboration workspace",
    siteLanguageCodes: ["en"],
    offers: [],
    useCases: [],
    ...overrides,
  });
}

function makePage(
  overrides: Partial<CrawlPageProjection> & { readonly fetchUrl: string },
): CrawlPageProjection {
  return {
    status: 200,
    finalStatus: 200,
    redirectChain: [],
    canonicalTarget: null,
    robotsIndexable: true,
    robotsDirectives: [],
    title: null,
    metaDescription: null,
    h1: [],
    headings: [],
    wordCount: null,
    internalOutlinks: [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: null,
    contentType: "text/html",
    ...overrides,
  };
}

function crawlObs(subjectUrl: string, page: CrawlPageProjection): ObservationView {
  return {
    metricKey: METRIC_CRAWL_PAGE,
    subjectType: "url",
    subjectRef: subjectUrl,
    provider: "crawl",
    availability: "available",
    valueJson: page,
    observedAt: OBSERVED_AT,
  };
}

function makeKw(clusterKey: string, keyword: string, searchVolume: number | null): unknown {
  return {
    keyword,
    clusterKey,
    searchVolume,
    currentUrl: null,
    currentRank: null,
    competitorDomain: null,
    competitorRank: null,
    marketCode: "us",
    languageCode: "en",
  };
}

function clusterObs(
  clusterKey: string,
  specs: readonly (readonly [string, number | null])[],
): ObservationView[] {
  return specs.map(([keyword, volume]) => ({
    metricKey: METRIC_CSV_KEYWORD_GAP,
    subjectType: "keyword_cluster",
    subjectRef: clusterKey,
    provider: "csv",
    availability: "available",
    valueJson: makeKw(clusterKey, keyword, volume),
    observedAt: OBSERVED_AT,
  }));
}

function buildContext(input: {
  readonly icp: EngineIcp;
  readonly observations: readonly ObservationView[];
  readonly coverage?: Partial<CoverageInput>;
}): DiagnosticContext {
  return DiagnosticContext.build({
    icp: input.icp,
    deliveryLocale: "en",
    observations: input.observations,
    coverage: {
      crawl: "available",
      gsc: "unavailable",
      ga4: "unavailable",
      csv: "available",
      ...input.coverage,
    },
    capturedAt: { crawl: OBSERVED_AT, csv: OBSERVED_AT },
  });
}

describe("contentGapRule (CONTENT-GAP-011)", () => {
  it("emits one candidate for a qualifying cluster with no related page", () => {
    const ctx = buildContext({
      icp: icpOf({}),
      observations: [
        ...clusterObs("project-management", QUALIFYING_CLUSTER),
        crawlObs(
          "https://example.com/pricing",
          makePage({ fetchUrl: "https://example.com/pricing", title: "Pricing", h1: ["Pricing"] }),
        ),
      ],
    });

    const result = contentGapRule.evaluate(ctx);
    if (result.status !== "candidate") throw new Error(`expected candidate, got ${result.status}`);
    expect(result.candidates).toHaveLength(1);

    const candidate = result.candidates[0]!;
    expect(candidate.subjectRefs).toEqual(["keyword_cluster:project-management"]);
    expect(candidate.severity).toBe("high");
    expect(candidate.metrics).toEqual({
      clusterKey: "project-management",
      keywordCount: 10,
      totalVolume: 1400,
    });
    // CSV (grade C, user_provided) + absent-page inference (crawl, derived).
    expect(candidate.evidence).toHaveLength(2);
    expect(candidate.evidence[0]).toMatchObject({
      sourceProvider: "csv",
      origin: "user_provided",
      method: "observed",
      grade: "C",
      observedAt: OBSERVED_AT,
    });
    expect(candidate.evidence[1]).toMatchObject({
      sourceProvider: "crawl",
      origin: "derived",
      method: "inferred",
      grade: "C",
    });
  });

  it("passes when an indexable page relates to the cluster", () => {
    const ctx = buildContext({
      icp: icpOf({}),
      observations: [
        ...clusterObs("project-management", QUALIFYING_CLUSTER),
        crawlObs(
          "https://example.com/project-management-software",
          makePage({
            fetchUrl: "https://example.com/project-management-software",
            title: "Project Management Software",
            h1: ["Project Management Software"],
          }),
        ),
      ],
    });

    const result = contentGapRule.evaluate(ctx);
    expect(result.status).toBe("pass");
    if (result.status !== "pass") throw new Error("unreachable");
    expect(result.metrics).toEqual({ qualifyingClusters: 1 });
  });

  it("uses a same-subject indexable exact variant when the ASCII-first variant redirects", () => {
    const subjectUrl = "https://example.com/pricing";
    const redirect = makePage({
      fetchUrl: subjectUrl,
      status: 301,
      finalStatus: 200,
      redirectChain: [`${subjectUrl}/`],
      title: "Pricing",
      h1: ["Pricing"],
    });
    const indexable = makePage({
      fetchUrl: `${subjectUrl}/`,
      title: "Project Management Software",
      h1: ["Project Management Software"],
    });
    const observations = [
      ...clusterObs("project-management", QUALIFYING_CLUSTER),
      crawlObs(subjectUrl, indexable),
      crawlObs(subjectUrl, redirect),
    ];

    for (const ordered of [observations, [...observations].reverse()]) {
      expect(
        contentGapRule.evaluate(
          buildContext({
            icp: icpOf({}),
            observations: ordered,
          }),
        ),
      ).toEqual({
        status: "pass",
        metrics: { qualifyingClusters: 1 },
      });
    }
  });

  it("does not fabricate a gap when healthy exact variants disagree on intent coverage", () => {
    const subjectUrl = "https://example.com/pricing";
    const observations = [
      ...clusterObs("project-management", QUALIFYING_CLUSTER),
      crawlObs(
        subjectUrl,
        makePage({
          fetchUrl: subjectUrl,
          title: "Project Pricing",
          h1: ["Project"],
        }),
      ),
      crawlObs(
        subjectUrl,
        makePage({
          fetchUrl: `${subjectUrl}/`,
          title: "Management Software",
          h1: ["Management"],
        }),
      ),
    ];

    const forward = contentGapRule.evaluate(
      buildContext({ icp: icpOf({}), observations }),
    );
    const reversed = contentGapRule.evaluate(
      buildContext({
        icp: icpOf({}),
        observations: [...observations].reverse(),
      }),
    );

    expect(forward).toEqual(reversed);
    expect(forward).toEqual({
      status: "pass",
      metrics: { qualifyingClusters: 1 },
    });
  });

  it("matches the frozen cluster key rather than the highest-volume keyword", () => {
    const ctx = buildContext({
      icp: icpOf({}),
      observations: [
        ...clusterObs("enterprise-seo-platform", DIVERGENT_CLUSTER),
        crawlObs(
          "https://example.com/cheap-seo-tool",
          makePage({
            fetchUrl: "https://example.com/cheap-seo-tool",
            title: "Cheap SEO Tool",
            h1: ["Cheap SEO Tool"],
          }),
        ),
      ],
    });

    const result = contentGapRule.evaluate(ctx);
    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]?.subjectRefs).toEqual([
      "keyword_cluster:enterprise-seo-platform",
    ]);
  });

  it("passes when the frozen cluster key is covered despite a divergent top keyword", () => {
    const ctx = buildContext({
      icp: icpOf({}),
      observations: [
        ...clusterObs("enterprise-seo-platform", DIVERGENT_CLUSTER),
        crawlObs(
          "https://example.com/enterprise-seo-platform",
          makePage({
            fetchUrl: "https://example.com/enterprise-seo-platform",
            title: "Enterprise SEO Platform",
            h1: ["Enterprise SEO Platform"],
          }),
        ),
      ],
    });

    expect(contentGapRule.evaluate(ctx)).toEqual({
      status: "pass",
      metrics: { qualifyingClusters: 1 },
    });
  });

  it("is inconclusive when no page has a title or H1", () => {
    const ctx = buildContext({
      icp: icpOf({}),
      observations: [
        ...clusterObs("project-management", QUALIFYING_CLUSTER),
        crawlObs(
          "https://example.com/pricing",
          makePage({
            fetchUrl: "https://example.com/pricing",
            title: null,
            h1: [],
          }),
        ),
      ],
    });

    expect(contentGapRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "intent_match_unavailable",
    });
  });

  it("marks partial CSV evidence partial and derives medium confidence", async () => {
    const ctx = buildContext({
      icp: icpOf({}),
      observations: [
        ...clusterObs("project-management", QUALIFYING_CLUSTER),
        crawlObs(
          "https://example.com/pricing",
          makePage({
            fetchUrl: "https://example.com/pricing",
            title: "Pricing",
            h1: ["Pricing"],
          }),
        ),
      ],
      coverage: { csv: "partial" },
    });

    const result = contentGapRule.evaluate(ctx);
    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]?.evidence[0]?.availability).toBe("partial");
    expect(result.candidates[0]?.evidence[0]?.limitation).toContain(
      "snapshot is partial",
    );

    const pipeline = await runPipeline({
      projectId: "00000000-0000-4000-8000-000000000001",
      ctx,
      rules: [contentGapRule],
      deliveryLocale: "en",
    });
    expect(pipeline.findings[0]?.confidence).toBe("medium");
  });

  it("does not report a clean pass from a partial CSV snapshot", () => {
    const ctx = buildContext({
      icp: icpOf({}),
      observations: [
        ...clusterObs("project-management", QUALIFYING_CLUSTER),
        crawlObs(
          "https://example.com/project-management",
          makePage({
            fetchUrl: "https://example.com/project-management",
            title: "Project Management",
            h1: ["Project Management"],
          }),
        ),
      ],
      coverage: { csv: "partial" },
    });

    expect(contentGapRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "partial_csv_snapshot",
    });
  });

  it("does not flag a cluster below the qualification thresholds", () => {
    // Only 5 keywords → fails the >= 10 keyword gate even at high volume.
    const smallCluster: readonly (readonly [string, number])[] = [
      ["seo audit", 1000],
      ["seo audit tool", 1000],
      ["seo audit checklist", 1000],
      ["seo audit service", 1000],
      ["seo audit report", 1000],
    ];
    const ctx = buildContext({
      icp: icpOf({}),
      observations: [
        ...clusterObs("seo-audit", smallCluster),
        crawlObs(
          "https://example.com/pricing",
          makePage({ fetchUrl: "https://example.com/pricing", title: "Pricing", h1: ["Pricing"] }),
        ),
      ],
    });

    const result = contentGapRule.evaluate(ctx);
    expect(result.status).toBe("pass");
    if (result.status !== "pass") throw new Error("unreachable");
    expect(result.metrics).toEqual({ qualifyingClusters: 0 });
  });

  it("is inconclusive for non-English projects", () => {
    const ctx = buildContext({
      icp: icpOf({ siteLanguageCodes: ["fr"] }),
      observations: [...clusterObs("project-management", QUALIFYING_CLUSTER)],
    });

    expect(contentGapRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "unsupported_language",
    });
  });

  it("skips with missing_dataset when CSV is unavailable", () => {
    const ctx = buildContext({
      icp: icpOf({}),
      observations: [
        crawlObs(
          "https://example.com/pricing",
          makePage({ fetchUrl: "https://example.com/pricing", title: "Pricing", h1: ["Pricing"] }),
        ),
      ],
      coverage: { csv: "unavailable" },
    });

    expect(contentGapRule.evaluate(ctx)).toEqual({
      status: "skipped",
      reason: "missing_dataset",
    });
  });

  it("skips with missing_dataset when crawl is unavailable", () => {
    const ctx = buildContext({
      icp: icpOf({}),
      observations: clusterObs("project-management", QUALIFYING_CLUSTER),
      coverage: { crawl: "unavailable" },
    });

    expect(contentGapRule.evaluate(ctx)).toEqual({
      status: "skipped",
      reason: "missing_dataset",
    });
  });

  it("is inconclusive when an indexable observation has an invalid subject URL", () => {
    const ctx = buildContext({
      icp: icpOf({}),
      observations: [
        ...clusterObs("project-management", QUALIFYING_CLUSTER),
        crawlObs(
          "not-a-url",
          makePage({
            fetchUrl: "https://example.com/pricing",
            title: "Pricing",
            h1: ["Pricing"],
          }),
        ),
      ],
    });

    expect(contentGapRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "intent_match_unavailable",
    });
  });
});
