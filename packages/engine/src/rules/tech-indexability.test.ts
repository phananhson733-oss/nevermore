import { METRIC_CRAWL_PAGE } from "@sf/sources";
import type { CrawlPageProjection } from "@sf/sources";
import { describe, expect, it } from "vitest";
import {
  DiagnosticContext,
  type CoverageInput,
  type ObservationView,
} from "../context.ts";
import { parseIcp } from "../icp.ts";
import { testObservationLineage } from "../test-observation-lineage.ts";
import { techHttpStatusRule } from "./tech-http-status.ts";
import { techIndexabilityRule } from "./tech-indexability.ts";

const OBSERVED_AT = "2026-07-18T00:00:00.000Z";
const URL = "https://x.com/noindex";

function makePage(
  overrides: Partial<CrawlPageProjection> = {},
): CrawlPageProjection {
  return {
    fetchUrl: URL,
    status: 200,
    finalStatus: 200,
    redirectChain: [],
    canonicalTarget: URL,
    robotsIndexable: false,
    robotsDirectives: ["noindex"],
    title: "Noindex page",
    metaDescription: null,
    h1: ["Noindex page"],
    headings: [],
    wordCount: 100,
    internalOutlinks: [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: true,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: 100,
    contentType: "text/html",
    ...overrides,
  };
}

function pageObservation(
  page: CrawlPageProjection,
  options: {
    readonly key?: string;
    readonly subjectRef?: string;
    readonly exactLineage?: boolean;
  } = {},
): ObservationView {
  const exactLineage = options.exactLineage ?? true;
  return {
    ...testObservationLineage(options.key ?? `crawl:${page.fetchUrl}`, {
      sitePageUrl: exactLineage ? page.fetchUrl : null,
      pageSnapshot: exactLineage,
    }),
    metricKey: METRIC_CRAWL_PAGE,
    subjectType: "url",
    subjectRef: options.subjectRef ?? page.fetchUrl,
    provider: "crawl",
    availability: "available",
    valueJson: page,
    observedAt: OBSERVED_AT,
  };
}

function buildContext(
  observations: readonly ObservationView[],
  crawl: CoverageInput["crawl"] = "available",
): DiagnosticContext {
  return DiagnosticContext.build({
    icp: parseIcp({
      productName: "Acme",
      priorityUrls: [URL],
    }),
    deliveryLocale: "en",
    observations,
    coverage: {
      crawl,
      gsc: "unavailable",
      ga4: "unavailable",
      csv: "unavailable",
    },
    capturedAt: { crawl: OBSERVED_AT },
  });
}

describe("TECH-INDEXABILITY-006@1", () => {
  it("emits one fixed-high direct-URL candidate for an exact 2xx sitemap/noindex contradiction", () => {
    const result = techIndexabilityRule.evaluate(
      buildContext([pageObservation(makePage())]),
    );

    expect(result).toEqual({
      status: "candidate",
      candidates: [
        {
          subjectRefs: [URL],
          severity: "high",
          titleArgs: { url: URL },
          metrics: { statusCode: 200 },
          evidence: [
            {
              sourceProvider: "crawl",
              origin: "direct_public",
              method: "observed",
              grade: "B",
              availability: "available",
              support: "supports",
              subjectRefs: [URL],
              claim:
                "https://x.com/noindex was observed as a sitemap member with a page-level non-indexable signal on an exact HTTP 200 response.",
              observedAt: OBSERVED_AT,
              limitation:
                "The finding proves the observed URL-level contradiction in the frozen crawl; it does not establish how a search engine will select or index the URL.",
            },
          ],
          target: {
            version: 1,
            relation: "direct_url",
            targetKind: "url",
            targetRef: URL,
            members: [
              expect.objectContaining({
                resolutionState: "resolved",
                basisKind: "crawl_exact_fetch",
                sitePageUrl: URL,
                memberRef: URL,
              }),
            ],
          },
        },
      ],
    });
  });

  it("keeps an observed contradiction under partial crawl with an honest coverage limitation", () => {
    const result = techIndexabilityRule.evaluate(
      buildContext([pageObservation(makePage())], "partial"),
    );

    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]?.evidence[0]).toMatchObject({
      availability: "partial",
      limitation:
        "The partial crawl proves only this observed URL-level contradiction; it does not establish complete sitemap coverage or site-wide prevalence.",
    });
  });

  it.each([
    {
      name: "not a sitemap member",
      page: makePage({ sitemapMember: false }),
    },
    {
      name: "indexable",
      page: makePage({ robotsIndexable: true, robotsDirectives: [] }),
    },
    {
      name: "redirect source with a terminal 2xx document",
      page: makePage({
        status: 301,
        finalStatus: 200,
        redirectChain: ["https://x.com/destination"],
      }),
    },
    {
      name: "404 owned by the HTTP rule",
      page: makePage({ status: 404, finalStatus: 404 }),
    },
    {
      name: "zero unavailable status",
      page: makePage({ status: 0, finalStatus: 200 }),
    },
    {
      name: "null unavailable status",
      page: makePage({ status: null, finalStatus: null }),
    },
  ])("passes for $name", ({ page }) => {
    expect(
      techIndexabilityRule.evaluate(buildContext([pageObservation(page)])),
    ).toEqual({
      status: "pass",
      metrics: { conflictCount: 0 },
    });
  });

  it("does not double-count a non-2xx URL handled by TECH-HTTP-001", () => {
    const context = buildContext([
      pageObservation(makePage({ status: 404, finalStatus: 404 })),
    ]);

    expect(techIndexabilityRule.evaluate(context).status).toBe("pass");
    expect(techHttpStatusRule.evaluate(context).status).toBe("candidate");
  });

  it("skips when the crawl dataset is unavailable", () => {
    expect(
      techIndexabilityRule.evaluate(buildContext([], "unavailable")),
    ).toEqual({
      status: "skipped",
      reason: "missing_dataset",
    });
  });

  it("is inconclusive when an eligible exact URL has missing crawl lineage", () => {
    const result = techIndexabilityRule.evaluate(
      buildContext([
        pageObservation(makePage(), {
          exactLineage: false,
        }),
      ]),
    );

    expect(result).toEqual({
      status: "inconclusive",
      reason: "missing_observation_lineage",
    });
  });

  it("is inconclusive when exact fetch lineage is ambiguous", () => {
    const page = makePage();
    const result = techIndexabilityRule.evaluate(
      buildContext([
        pageObservation(page, { key: "duplicate:a" }),
        pageObservation(page, { key: "duplicate:b" }),
      ]),
    );

    expect(result).toEqual({
      status: "inconclusive",
      reason: "missing_observation_lineage",
    });
  });

  it("emits one candidate for each exact affected fetch URL in deterministic order", () => {
    const slashUrl = `${URL}/`;
    const observations = [
      pageObservation(makePage({ fetchUrl: slashUrl }), {
        subjectRef: URL,
      }),
      pageObservation(makePage(), { subjectRef: URL }),
    ];

    const forward = techIndexabilityRule.evaluate(buildContext(observations));
    const reversed = techIndexabilityRule.evaluate(
      buildContext([...observations].reverse()),
    );

    expect(forward).toEqual(reversed);
    if (forward.status !== "candidate") throw new Error("expected candidate");
    expect(
      forward.candidates.map((candidate) => candidate.target),
    ).toMatchObject([
      {
        relation: "direct_url",
        targetKind: "url",
        targetRef: URL,
        members: [{ basisKind: "crawl_exact_fetch", memberRef: URL }],
      },
      {
        relation: "direct_url",
        targetKind: "url",
        targetRef: slashUrl,
        members: [{ basisKind: "crawl_exact_fetch", memberRef: slashUrl }],
      },
    ]);
    expect(
      forward.candidates.every((candidate) => candidate.severity === "high"),
    ).toBe(true);
  });
});
